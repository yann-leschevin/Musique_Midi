/**
 * player.js — Lecteur audio MIDI basé exclusivement sur l'API Web Audio.
 *
 * Principe : chaque note du fichier analysé par midi-parser.js est convertie
 * en un OscillatorNode + enveloppe de gain (GainNode) planifié sur l'horloge
 * de l'AudioContext. Une fenêtre de planification (« lookahead ») évite de
 * créer des milliers de nœuds d'un coup.
 *
 * États : empty | stopped | playing | paused | ended
 */
(function (global) {
  "use strict";

  var LOOKAHEAD = 1.5; // secondes planifiées à l'avance
  var TICK_MS = 60; // fréquence de rafraîchissement de l'interface
  var MAX_NODES = 40000; // garde-fou de nœuds audio
  var EPS = 0.0001; // gain minimal (les rampes exponentielles doivent être > 0)

  var MIN_SPEED = 0.25;
  var MAX_SPEED = 4;

  /**
   * Les 15 sons (timbres) proposés à l'utilisateur.
   *
   * Chaque son décrit un oscillateur principal, un éventuel oscillateur
   * secondaire (renforcement harmonique), un filtre, une enveloppe ADSR et un
   * éventuel vibrato. `gain` pondère le niveau, `programmes` sert au mode
   * « auto » (suivre les instruments du fichier MIDI).
   */
  var SOUNDS = [
    {
      id: "piano",
      label: "Piano",
      wave: "triangle",
      wave2: null,
      gain: 1,
      attack: 0.005,
      decay: 0.5,
      sustain: 0.16,
      release: 0.35,
      filter: null,
      vibrato: null,
      programmes: [[0, 7], [96, 96]]
    },
    {
      id: "piano-electrique",
      label: "Piano électrique",
      wave: "sine",
      wave2: { wave: "triangle", gain: 0.5, detune: 7 },
      gain: 1.05,
      attack: 0.005,
      decay: 0.6,
      sustain: 0.2,
      release: 0.5,
      filter: { type: "lowpass", freq: 3200, q: 0.7, env: 2.4, sweep: 0.25 },
      vibrato: null,
      programmes: [[8, 15]]
    },
    {
      id: "orgue",
      label: "Orgue",
      wave: "square",
      wave2: { wave: "sine", gain: 0.6, detune: 0 },
      gain: 0.55,
      attack: 0.035,
      decay: 0.12,
      sustain: 0.9,
      release: 0.3,
      filter: { type: "lowpass", freq: 3600, q: 0.6, env: 1.4, sweep: 0.12 },
      vibrato: null,
      programmes: [[16, 23]]
    },
    {
      id: "guitare",
      label: "Guitare acoustique",
      wave: "triangle",
      wave2: { wave: "sawtooth", gain: 0.3, detune: 0 },
      gain: 0.95,
      attack: 0.004,
      decay: 0.35,
      sustain: 0.12,
      release: 0.3,
      filter: { type: "lowpass", freq: 2600, q: 0.8, env: 3.4, sweep: 0.16 },
      vibrato: null,
      programmes: [[24, 31], [104, 111]]
    },
    {
      id: "basse",
      label: "Basse",
      wave: "sawtooth",
      wave2: { wave: "sine", gain: 0.7, detune: -1200 },
      gain: 0.9,
      attack: 0.006,
      decay: 0.3,
      sustain: 0.5,
      release: 0.2,
      filter: { type: "lowpass", freq: 620, q: 1.1, env: 3.6, sweep: 0.2 },
      vibrato: null,
      programmes: [[32, 39]]
    },
    {
      id: "harpe",
      label: "Harpe",
      wave: "sine",
      wave2: { wave: "triangle", gain: 0.35, detune: 0 },
      gain: 1.1,
      attack: 0.003,
      decay: 0.8,
      sustain: 0.08,
      release: 0.6,
      filter: null,
      vibrato: null,
      programmes: [[46, 46]]
    },
    {
      id: "cordes",
      label: "Cordes / Violon",
      wave: "sawtooth",
      wave2: { wave: "sawtooth", gain: 0.5, detune: 9 },
      gain: 0.6,
      attack: 0.12,
      decay: 0.3,
      sustain: 0.75,
      release: 0.45,
      filter: { type: "lowpass", freq: 2800, q: 0.7, env: 1.6, sweep: 0.3 },
      vibrato: { rate: 5.2, depth: 11, delay: 0.45 },
      programmes: [[40, 47], [48, 51]]
    },
    {
      id: "choeur",
      label: "Chœurs",
      wave: "triangle",
      wave2: { wave: "triangle", gain: 0.6, detune: 8 },
      gain: 0.8,
      attack: 0.3,
      decay: 0.4,
      sustain: 0.8,
      release: 0.7,
      filter: { type: "lowpass", freq: 2400, q: 0.5, env: 1.3, sweep: 0.3 },
      vibrato: { rate: 4.4, depth: 9, delay: 0.7 },
      programmes: [[52, 55]]
    },
    {
      id: "cuivres",
      label: "Cuivres / Trompette",
      wave: "sawtooth",
      wave2: { wave: "square", gain: 0.25, detune: 5 },
      gain: 0.62,
      attack: 0.045,
      decay: 0.2,
      sustain: 0.7,
      release: 0.28,
      filter: { type: "lowpass", freq: 3000, q: 0.9, env: 2.6, sweep: 0.14 },
      vibrato: { rate: 5.6, depth: 7, delay: 0.5 },
      programmes: [[56, 63]]
    },
    {
      id: "saxophone",
      label: "Saxophone",
      wave: "sawtooth",
      wave2: { wave: "square", gain: 0.3, detune: -6 },
      gain: 0.7,
      attack: 0.05,
      decay: 0.25,
      sustain: 0.7,
      release: 0.3,
      filter: { type: "lowpass", freq: 2100, q: 1.3, env: 2.2, sweep: 0.18 },
      vibrato: { rate: 5, depth: 8, delay: 0.4 },
      programmes: [[64, 71]]
    },
    {
      id: "flute",
      label: "Flûte",
      wave: "sine",
      wave2: { wave: "triangle", gain: 0.18, detune: 6 },
      gain: 1.15,
      attack: 0.08,
      decay: 0.12,
      sustain: 0.85,
      release: 0.25,
      filter: { type: "lowpass", freq: 4200, q: 0.5, env: 1.4, sweep: 0.2 },
      vibrato: { rate: 5.4, depth: 10, delay: 0.35 },
      programmes: [[72, 79]]
    },
    {
      id: "lead",
      label: "Synthé lead",
      wave: "square",
      wave2: { wave: "sawtooth", gain: 0.4, detune: 4 },
      gain: 0.55,
      attack: 0.006,
      decay: 0.2,
      sustain: 0.7,
      release: 0.18,
      filter: { type: "lowpass", freq: 4600, q: 1.1, env: 2, sweep: 0.16 },
      vibrato: null,
      programmes: [[80, 87]]
    },
    {
      id: "pad",
      label: "Pad / Nuage",
      wave: "sawtooth",
      wave2: { wave: "sawtooth", gain: 0.6, detune: 11 },
      gain: 0.5,
      attack: 0.5,
      decay: 0.6,
      sustain: 0.7,
      release: 1.2,
      filter: { type: "lowpass", freq: 1700, q: 0.6, env: 1.5, sweep: 0.6 },
      vibrato: { rate: 3.8, depth: 6, delay: 1 },
      programmes: [[88, 103]]
    },
    {
      id: "clochettes",
      label: "Clochettes / Glockenspiel",
      wave: "sine",
      wave2: { wave: "sine", gain: 0.45, detune: 2400 },
      gain: 1.05,
      attack: 0.002,
      decay: 0.7,
      sustain: 0.05,
      release: 0.7,
      filter: null,
      vibrato: null,
      programmes: [[9, 11], [112, 115]]
    },
    {
      id: "marimba",
      label: "Marimba / Xylophone",
      wave: "triangle",
      wave2: { wave: "sine", gain: 0.35, detune: 1200 },
      gain: 1.05,
      attack: 0.002,
      decay: 0.35,
      sustain: 0.05,
      release: 0.3,
      filter: null,
      vibrato: null,
      programmes: [[12, 17], [116, 119]]
    }
  ];

  var SOUNDS_BY_ID = {};
  var SOUND_IDS = ["auto"];
  SOUNDS_BY_ID.auto = null;
  for (var soundIndex = 0; soundIndex < SOUNDS.length; soundIndex++) {
    SOUNDS_BY_ID[SOUNDS[soundIndex].id] = SOUNDS[soundIndex];
    SOUND_IDS.push(SOUNDS[soundIndex].id);
  }

  /* ---------------------------------------------------------------------- */
  /* Formes d'onde                                                           */
  /* ---------------------------------------------------------------------- */
  var STANDARD_WAVES = {
    sine: { label: "Sinus (doux)" },
    triangle: { label: "Triangle (clé)" },
    square: { label: "Carré (orgue)" },
    sawtooth: { label: "Dent de scie (acide)" }
  };

  var HARMONICS = 32;

  /**
   * Construit les séries de Fourier d'une onde personnalisée.
   * `realFn(n)` / `imagFn(n)` donnent le cosinus / sinus de l'harmonique n.
   */
  function periodic(realFn, imagFn) {
    var real = new Float32Array(HARMONICS + 1);
    var imag = new Float32Array(HARMONICS + 1);
    for (var n = 1; n <= HARMONICS; n++) {
      real[n] = realFn ? realFn(n) : 0;
      imag[n] = imagFn ? imagFn(n) : 0;
    }
    return { real: real, imag: imag };
  }

  /* Jeux d'orgue (8', 4', 2⅔', 2', 1⅓', 1'…) : harmoniques discrètes. */
  var ORGAN_BARS = {
    1: 1, 2: 0.5, 3: 0.7, 4: 0.35, 5: 0.45, 6: 0.2, 8: 0.3,
    10: 0.18, 12: 0.14, 16: 0.1, 20: 0.07, 24: 0.05
  };

  /* 5 ondes supplémentaires au-delà des 4 types natifs de Web Audio. */
  var CUSTOM_WAVES = {
    "saw-inv": {
      label: "Dent de scie inversée",
      coefs: periodic(null, function (n) {
        return Math.pow(-1, n) * 2 / (Math.PI * n);
      })
    },
    pulse: {
      label: "Impulsion 25 % (nasillard)",
      coefs: periodic(function (n) {
        return 2 * Math.sin(Math.PI * n * 0.25) / (Math.PI * n);
      }, null)
    },
    organ: {
      label: "Orgue (jeux d'harmoniques)",
      coefs: periodic(null, function (n) {
        return ORGAN_BARS[n] || 0;
      })
    },
    hollow: {
      label: "Creuse (harmoniques impaires)",
      coefs: periodic(null, function (n) {
        return n % 2 === 1 ? 1.5 * Math.pow(n, -1.25) : 0;
      })
    },
    metallic: {
      label: "Métallique (brillante)",
      coefs: periodic(null, function (n) {
        return 1.8 * Math.pow(n, -0.65);
      })
    }
  };

  var WAVES = [];
  for (var waveKey in STANDARD_WAVES) {
    if (Object.prototype.hasOwnProperty.call(STANDARD_WAVES, waveKey)) {
      WAVES.push({ id: waveKey, label: STANDARD_WAVES[waveKey].label, custom: false });
    }
  }
  for (var customKey in CUSTOM_WAVES) {
    if (Object.prototype.hasOwnProperty.call(CUSTOM_WAVES, customKey)) {
      WAVES.push({ id: customKey, label: CUSTOM_WAVES[customKey].label, custom: true });
    }
  }

  function isKnownWave(type) {
    return (
      type === "auto" ||
      Object.prototype.hasOwnProperty.call(STANDARD_WAVES, type) ||
      Object.prototype.hasOwnProperty.call(CUSTOM_WAVES, type)
    );
  }

  /** Applique une forme d'onde à un oscillateur (natif ou PeriodicWave). */
  function applyWave(player, osc, type) {
    if (Object.prototype.hasOwnProperty.call(CUSTOM_WAVES, type)) {
      var wave = player._periodicWave(type);
      if (wave) {
        osc.setPeriodicWave(wave);
        return;
      }
      type = "sine";
    }
    osc.type = Object.prototype.hasOwnProperty.call(STANDARD_WAVES, type) ? type : "sine";
  }

  function soundForProgram(program) {
    var value = program | 0;
    if (value < 0) {
      value = 0;
    }
    for (var i = 0; i < SOUNDS.length; i++) {
      var ranges = SOUNDS[i].programmes || [];
      for (var r = 0; r < ranges.length; r++) {
        if (value >= ranges[r][0] && value <= ranges[r][1]) {
          return SOUNDS[i];
        }
      }
    }
    return SOUNDS_BY_ID.piano;
  }

  function clamp(value, min, max) {
    return value < min ? min : (value > max ? max : value);
  }

  function noteToFrequency(note) {
    return 440 * Math.pow(2, (note - 69) / 12);
  }

  function MidiPlayer() {
    this.ctx = null;
    this.master = null;
    this.midi = null;
    this.state = "empty";
    this.cursor = 0;
    this.startedAt = 0;
    this.volume = 0.8;
    this.waveform = "auto";
    this.sound = "auto";
    this.speed = 1;
    this.programByChannel = {};
    this.sources = [];
    this._nextIndex = 0;
    this._timer = null;
    this._rescheduleOnResume = false;
    this._waves = {};
    this.droppedNotes = 0;

    this.onStateChange = null;
    this.onTick = null;
  }

  MidiPlayer.prototype._emitState = function () {
    if (typeof this.onStateChange === "function") {
      this.onStateChange(this.state);
    }
  };

  MidiPlayer.prototype._emitTick = function (position) {
    if (typeof this.onTick === "function") {
      this.onTick(position, this.getDuration());
    }
  };

  MidiPlayer.prototype._ensureContext = function () {
    var Ctor = global.AudioContext || global.webkitAudioContext;
    if (!Ctor) {
      throw new Error(
        "L'API Web Audio n'est pas disponible dans ce navigateur (AudioContext introuvable)."
      );
    }
    if (!this.ctx) {
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") {
      var resumed = this.ctx.resume();
      if (resumed && typeof resumed.catch === "function") {
        resumed.catch(function () {});
      }
    }
    return this.ctx;
  };

  MidiPlayer.prototype.getDuration = function () {
    return this.midi ? this.midi.duration : 0;
  };

  MidiPlayer.prototype.getPosition = function () {
    if (this.state === "playing" && this.ctx) {
      return clamp(
        (this.ctx.currentTime - this.startedAt) * this.speed,
        0,
        this.getDuration()
      );
    }
    return clamp(this.cursor, 0, this.getDuration());
  };

  MidiPlayer.prototype.getState = function () {
    return this.state;
  };

  /* ---------------------------------------------------------------------- */
  /* Chargement                                                              */
  /* ---------------------------------------------------------------------- */
  MidiPlayer.prototype.load = function (midi) {
    this.stop();
    this.midi = midi;
    this.cursor = 0;
    this._nextIndex = 0;
    this.state = "stopped";
    this.droppedNotes = 0;
    this.programByChannel = buildProgramMap(midi);
    this._emitState();
    this._emitTick(0);
  };

  /** Dernier changement de programme par canal (pour le mode « auto »). */
  function buildProgramMap(midi) {
    var map = {};
    var programs = (midi && midi.programs) || [];
    for (var i = 0; i < programs.length; i++) {
      var entry = programs[i];
      if (typeof entry.channel === "number" && typeof entry.program === "number") {
        map[entry.channel] = entry.program;
      }
    }
    return map;
  }

  /* ---------------------------------------------------------------------- */
  /* Transport                                                               */
  /* ---------------------------------------------------------------------- */
  MidiPlayer.prototype.play = function () {
    if (!this.midi) {
      return false;
    }
    if (this.state === "playing") {
      return true;
    }
    if (this.state === "paused") {
      return this.resume();
    }
    var position = this.cursor;
    if (position >= this.getDuration() - 0.05) {
      position = 0;
    }
    return this._startAt(position);
  };

  MidiPlayer.prototype._startAt = function (position) {
    var ctx;
    try {
      ctx = this._ensureContext();
    } catch (error) {
      this.state = "error";
      this._emitState();
      throw error;
    }

    this._cancelSources();
    this._stopTimer();

    this.cursor = clamp(position, 0, this.getDuration());
    this.startedAt = ctx.currentTime - this.cursor / this.speed;
    this.state = "playing";
    this._rescheduleOnResume = false;

    var notes = this.midi.notes;
    var index = 0;
    while (index < notes.length && notes[index].t + notes[index].d <= this.cursor) {
      index++;
    }
    this._nextIndex = index;

    this._emitState();
    this._scheduleWindow();
    this._startTimer();
    return true;
  };

  MidiPlayer.prototype.pause = function () {
    if (this.state !== "playing" || !this.ctx) {
      return false;
    }
    this.cursor = this.getPosition();
    var suspended = this.ctx.suspend();
    if (suspended && typeof suspended.catch === "function") {
      suspended.catch(function () {});
    }
    this._stopTimer();
    this.state = "paused";
    this._emitState();
    this._emitTick(this.cursor);
    return true;
  };

  MidiPlayer.prototype.resume = function () {
    if (this.state !== "paused" || !this.ctx) {
      return false;
    }
    if (this._rescheduleOnResume) {
      return this._startAt(this.cursor);
    }
    var resumed = this.ctx.resume();
    if (resumed && typeof resumed.catch === "function") {
      resumed.catch(function () {});
    }
    this.state = "playing";
    this.startedAt = this.ctx.currentTime - this.cursor / this.speed;
    this._emitState();
    this._startTimer();
    return true;
  };

  MidiPlayer.prototype.stop = function () {
    this._cancelSources();
    this._stopTimer();
    if (this.ctx && this.ctx.state === "suspended") {
      var resumed = this.ctx.resume();
      if (resumed && typeof resumed.catch === "function") {
        resumed.catch(function () {});
      }
    }
    this.cursor = 0;
    this._nextIndex = 0;
    if (this.midi) {
      this.state = "stopped";
    } else {
      this.state = "empty";
    }
    this._emitState();
    this._emitTick(0);
    return true;
  };

  MidiPlayer.prototype.seek = function (position) {
    if (!this.midi) {
      return false;
    }
    var target = clamp(position, 0, this.getDuration());
    this.cursor = target;
    if (this.state === "playing") {
      return this._startAt(target);
    }
    if (this.state === "paused") {
      this._cancelSources();
      this._rescheduleOnResume = true;
    }
    this._emitTick(target);
    return true;
  };

  /* ---------------------------------------------------------------------- */
  /* Réglages                                                                */
  /* ---------------------------------------------------------------------- */
  MidiPlayer.prototype.setVolume = function (value) {
    this.volume = clamp(value, 0, 1);
    if (this.master) {
      this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02);
    }
  };

  MidiPlayer.prototype.setWaveform = function (type) {
    this.waveform = isKnownWave(type) ? type : "auto";
    return this.waveform;
  };

  /**
   * PeriodicWave d'une forme d'onde personnalisée, fabriqué une seule fois
   * puis mis en cache pour l'AudioContext courant.
   */
  MidiPlayer.prototype._periodicWave = function (type) {
    if (!this.ctx || !Object.prototype.hasOwnProperty.call(CUSTOM_WAVES, type)) {
      return null;
    }
    if (!this._waves[type]) {
      var coefs = CUSTOM_WAVES[type].coefs;
      this._waves[type] = this.ctx.createPeriodicWave(coefs.real, coefs.imag);
    }
    return this._waves[type];
  };

  /**
   * Choix du son (timbre).
   *
   * ``id`` vaut ``"auto"`` (suivre l'instrument déclaré par le fichier MIDI)
   * ou l'identifiant de l'un des 15 sons de ``MidiPlayer.SOUNDS``.
   * Le changement s'applique aux notes suivantes, sans interrompre la lecture.
   */
  MidiPlayer.prototype.setSound = function (id) {
    if (id === "auto") {
      this.sound = "auto";
      return this.sound;
    }
    this.sound = SOUNDS_BY_ID[id] ? id : "auto";
    return this.sound;
  };

  MidiPlayer.prototype.getSound = function () {
    return this.sound;
  };

  /** Son effectivement utilisé pour une note donnée (mode « auto » résolu). */
  MidiPlayer.prototype.resolveSound = function (note) {
    if (this.sound !== "auto" && SOUNDS_BY_ID[this.sound]) {
      return SOUNDS_BY_ID[this.sound];
    }
    var channel = note && typeof note.c === "number" ? note.c : -1;
    var program = typeof this.programByChannel[channel] === "number"
      ? this.programByChannel[channel]
      : 0;
    if (channel === 9) {
      return SOUNDS_BY_ID.marimba; // canal percussions : timbre frappé
    }
    return soundForProgram(program);
  };

  /**
   * Vitesse de lecture (1 = vitesse d'origine).
   *
   * La position (en secondes du fichier) est conservée : seule l'horloge de
   * l'AudioContext est contractée ou étirée. En lecture, les notes déjà
   * planifiées sont annulées et replanifiées au nouveau rythme.
   */
  MidiPlayer.prototype.setSpeed = function (rate) {
    var value = Number(rate);
    if (!isFinite(value)) {
      value = 1;
    }
    value = clamp(value, MIN_SPEED, MAX_SPEED);
    if (value === this.speed) {
      return this.speed;
    }
    var position = this.state === "playing" ? this.getPosition() : this.cursor;
    this.speed = value;
    if (this.state === "playing") {
      this._startAt(position);
    } else if (this.state === "paused") {
      this._cancelSources();
      this._rescheduleOnResume = true;
      this._emitTick(this.cursor);
    }
    return this.speed;
  };

  MidiPlayer.prototype.getSpeed = function () {
    return this.speed;
  };

  /* ---------------------------------------------------------------------- */
  /* Planification des notes                                                 */
  /* ---------------------------------------------------------------------- */
  MidiPlayer.prototype._scheduleWindow = function () {
    if (this.state !== "playing" || !this.midi) {
      return;
    }
    var ctx = this.ctx;
    var notes = this.midi.notes;
    var horizon = this.getPosition() + LOOKAHEAD;

    while (this._nextIndex < notes.length && notes[this._nextIndex].t < horizon) {
      var note = notes[this._nextIndex];
      this._nextIndex++;
      if (this.sources.length > MAX_NODES) {
        this.droppedNotes++;
        continue;
      }
      this._scheduleNote(note, ctx.currentTime);
    }
  };

  MidiPlayer.prototype._scheduleNote = function (note, referenceTime) {
    var ctx = this.ctx;
    var speed = this.speed;
    var start = this.startedAt + note.t / speed;
    if (start < referenceTime) {
      start = referenceTime;
    }
    var duration = Math.max(note.d / speed, 0.04);
    var end = start + duration;
    if (end <= referenceTime) {
      return;
    }

    var sound = this.resolveSound(note);
    var velocity = (note.v || 64) / 127;
    var peak = clamp((0.03 + 0.22 * velocity * velocity) * sound.gain, 0.02, 0.5);

    // enveloppe : l'attaque et la décroissance sont limitées à la note
    var attack = Math.min(sound.attack, duration * 0.5);
    var decay = Math.min(sound.decay, Math.max(duration - attack, 0.02));
    var release = Math.min(sound.release, 1.5);
    var stopAt = end + release + 0.02;

    var osc = ctx.createOscillator();
    osc.type = sound.wave;
    osc.frequency.setValueAtTime(noteToFrequency(note.n), start);

    var waveOverride = this.waveform !== "auto" ? this.waveform : null;
    if (waveOverride) {
      applyWave(this, osc, waveOverride);
    }

    var head = osc;
    var filter = null;
    if (sound.filter) {
      filter = ctx.createBiquadFilter();
      filter.type = sound.filter.type || "lowpass";
      filter.Q.value = sound.filter.q || 0.7;
      var baseFreq = clamp(sound.filter.freq, 60, 16000);
      var openFreq = clamp(baseFreq * (sound.filter.env || 1), 60, 18000);
      var sweep = Math.max(Math.min(sound.filter.sweep || 0.2, duration), 0.01);
      filter.frequency.setValueAtTime(openFreq, start);
      filter.frequency.exponentialRampToValueAtTime(baseFreq, start + sweep);
      osc.connect(filter);
      head = filter;
    }

    var osc2 = null;
    if (sound.wave2) {
      osc2 = ctx.createOscillator();
      osc2.type = sound.wave2.wave;
      if (waveOverride) {
        applyWave(this, osc2, waveOverride);
      }
      osc2.frequency.setValueAtTime(noteToFrequency(note.n), start);
      if (sound.wave2.detune) {
        osc2.detune.setValueAtTime(sound.wave2.detune, start);
      }
      osc2.connect(head);
    }

    var gain = ctx.createGain();
    gain.gain.setValueAtTime(EPS, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + attack);
    gain.gain.exponentialRampToValueAtTime(
      Math.max(peak * sound.sustain, EPS * 2),
      start + attack + decay
    );
    gain.gain.exponentialRampToValueAtTime(EPS, end + release);

    head.connect(gain);
    gain.connect(this.master);

    var lfo = null;
    var lfoGain = null;
    if (sound.vibrato && duration > 0.2) {
      lfo = ctx.createOscillator();
      lfo.type = "sine";
      lfo.frequency.setValueAtTime(sound.vibrato.rate, start);
      lfoGain = ctx.createGain();
      var depth = sound.vibrato.depth || 8;
      lfoGain.gain.setValueAtTime(0, start);
      lfoGain.gain.linearRampToValueAtTime(
        depth,
        start + Math.min(sound.vibrato.delay || 0.4, duration * 0.6)
      );
      lfo.connect(lfoGain);
      lfoGain.connect(osc.detune);
      if (osc2) {
        lfoGain.connect(osc2.detune);
      }
      lfo.start(start);
      lfo.stop(stopAt);
    }

    var entry = {
      osc: osc,
      osc2: osc2,
      filter: filter,
      lfo: lfo,
      lfoGain: lfoGain,
      gain: gain,
      ended: false
    };
    var self = this;
    osc.onended = function () {
      entry.ended = true;
      disconnectNodes(entry);
      self._purgeSources();
    };

    this.sources.push(entry);
    osc.start(start);
    osc.stop(stopAt);
    if (osc2) {
      osc2.start(start);
      osc2.stop(stopAt);
    }
  };

  function disconnectNodes(entry) {
    var keys = ["osc", "osc2", "filter", "lfo", "lfoGain", "gain"];
    for (var i = 0; i < keys.length; i++) {
      var node = entry[keys[i]];
      if (node) {
        try {
          node.disconnect();
        } catch (error) {
          /* déjà déconnecté */
        }
      }
    }
  }

  MidiPlayer.prototype._purgeSources = function () {
    if (this.sources.length === 0) {
      return;
    }
    var kept = [];
    for (var i = 0; i < this.sources.length; i++) {
      if (!this.sources[i].ended) {
        kept.push(this.sources[i]);
      }
    }
    this.sources = kept;
  };

  MidiPlayer.prototype._cancelSources = function () {
    var entries = this.sources;
    this.sources = [];
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      entry.ended = true;
      var voices = [entry.osc, entry.osc2, entry.lfo];
      for (var v = 0; v < voices.length; v++) {
        if (!voices[v]) {
          continue;
        }
        try {
          if (voices[v] === entry.osc) {
            entry.osc.onended = null;
          }
          voices[v].stop(0);
        } catch (error) {
          /* déjà démarré/arrêté */
        }
      }
      disconnectNodes(entry);
    }
  };

  /* ---------------------------------------------------------------------- */
  /* Boucle d'interface                                                      */
  /* ---------------------------------------------------------------------- */
  MidiPlayer.prototype._startTimer = function () {
    var self = this;
    if (this._timer !== null) {
      return;
    }
    this._timer = global.setInterval(function () {
      self._step();
    }, TICK_MS);
  };

  MidiPlayer.prototype._stopTimer = function () {
    if (this._timer !== null) {
      global.clearInterval(this._timer);
      this._timer = null;
    }
  };

  MidiPlayer.prototype._step = function () {
    if (this.state !== "playing") {
      this._stopTimer();
      return;
    }
    var position = this.getPosition();
    this._scheduleWindow();
    this._emitTick(position);

    if (position >= this.getDuration() - 0.01) {
      this._finish();
    }
  };

  MidiPlayer.prototype._finish = function () {
    this._cancelSources();
    this._stopTimer();
    this.cursor = this.getDuration();
    this.state = "ended";
    this._emitState();
    this._emitTick(this.cursor);
  };

  MidiPlayer.SOUNDS = SOUNDS;
  MidiPlayer.SOUND_IDS = SOUND_IDS;
  MidiPlayer.WAVES = WAVES;
  MidiPlayer.CUSTOM_WAVE_IDS = Object.keys(CUSTOM_WAVES);
  /** Coefficients de Fourier des ondes personnalisées (aperçus graphiques). */
  MidiPlayer.waveCoefs = function (type) {
    return Object.prototype.hasOwnProperty.call(CUSTOM_WAVES, type)
      ? CUSTOM_WAVES[type].coefs
      : null;
  };
  global.MidiPlayer = MidiPlayer;
})(typeof window !== "undefined" ? window : this);
