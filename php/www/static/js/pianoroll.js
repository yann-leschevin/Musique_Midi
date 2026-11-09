/**
 * pianoroll.js — Musicogramme (piano roll) sur canvas.
 *
 * Une couche statique (fond, grille, notes) est dessinée une seule fois puis
 * réutilisée à chaque image ; seuls la zone jouée, les notes en cours, le
 * trait de lecture et l'indicateur de survol sont redessinés.
 *
 * Le trait de lecture sert aussi de contrôle de position : `timeAt(clientX)`
 * convertit une abscisse écran en temps (secondes) et `isNearPlayhead()`
 * indique si le pointeur est sur le trait (pour le glisser).
 */
(function (global) {
  "use strict";

  /* Teintes par canal : palette harmonisée avec l'accent violet / turquoise. */
  var CHANNEL_HUES = [258, 188, 320, 38, 150, 210, 345, 90, 280, 168, 12, 230];
  var LABEL_CSS = 38;      // largeur (px CSS) de la colonne des octaves
  var GRAB_CSS = 9;        // tolérance (px CSS) pour attraper le trait

  function PianoRoll(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.layer = document.createElement("canvas");
    this.layerCtx = this.layer.getContext("2d");
    this.midi = null;
    this.minNote = 0;
    this.maxNote = 127;
    this.duration = 0;
    this.maxNoteDur = 0;
    this.lastPosition = 0;
    this.hoverTime = null;
    this.width = 0;
    this.height = 0;
    this.ratio = 1;
  }

  PianoRoll.prototype._resize = function () {
    var ratio = global.devicePixelRatio || 1;
    var width = Math.max(320, this.canvas.clientWidth || this.canvas.width);
    var height = Math.max(160, this.canvas.clientHeight || this.canvas.height);
    this.canvas.width = Math.round(width * ratio);
    this.canvas.height = Math.round(height * ratio);
    this.layer.width = this.canvas.width;
    this.layer.height = this.canvas.height;
    this.ratio = ratio;
    this.width = this.canvas.width;
    this.height = this.canvas.height;
  };

  PianoRoll.prototype._labelWidth = function () {
    return Math.round(LABEL_CSS * this.ratio);
  };

  PianoRoll.prototype._xOf = function (time) {
    var labelWidth = this._labelWidth();
    var duration = this.duration || 1;
    var clamped = Math.max(0, Math.min(time, duration));
    return labelWidth + (clamped / duration) * (this.width - labelWidth);
  };

  PianoRoll.prototype.setMidi = function (midi) {
    this._resize();
    this.midi = midi;
    this.duration = midi ? midi.duration : 0;
    this.maxNoteDur = 0;
    this.hoverTime = null;
    if (midi && midi.notes.length > 0) {
      var min = 127;
      var max = 0;
      for (var i = 0; i < midi.notes.length; i++) {
        var note = midi.notes[i];
        if (note.n < min) {
          min = note.n;
        }
        if (note.n > max) {
          max = note.n;
        }
        if (note.d > this.maxNoteDur) {
          this.maxNoteDur = note.d;
        }
      }
      this.minNote = Math.max(0, min - 2);
      this.maxNote = Math.min(127, max + 2);
    } else {
      this.minNote = 36;
      this.maxNote = 96;
    }
    this.renderLayer();
    this.draw(0);
  };

  /** Redimensionne la zone de dessin (fenêtre redimensionnable). */
  PianoRoll.prototype.resize = function () {
    this._resize();
    if (this.midi) {
      this.renderLayer();
    }
    this.draw(this.lastPosition || 0);
  };

  /** Temps (s) correspondant à une abscisse écran, ou null sans fichier. */
  PianoRoll.prototype.timeAt = function (clientX) {
    if (!this.midi || !this.duration) {
      return null;
    }
    var rect = this.canvas.getBoundingClientRect();
    var plot = rect.width - LABEL_CSS;
    if (plot <= 0) {
      return 0;
    }
    var ratio = (clientX - rect.left - LABEL_CSS) / plot;
    return Math.max(0, Math.min(1, ratio)) * this.duration;
  };

  /** Le pointeur est-il sur le trait de lecture ? */
  PianoRoll.prototype.isNearPlayhead = function (clientX) {
    if (!this.midi) {
      return false;
    }
    var rect = this.canvas.getBoundingClientRect();
    var x = rect.left + this._xOf(this.lastPosition) / this.ratio;
    return Math.abs(clientX - x) <= GRAB_CSS;
  };

  /** Indicateur de survol (null pour l'effacer). */
  PianoRoll.prototype.setHover = function (time) {
    this.hoverTime = time;
    this.draw(this.lastPosition);
  };

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  PianoRoll.prototype.renderLayer = function () {
    var ctx = this.layerCtx;
    var width = this.width;
    var height = this.height;
    var ratio = this.ratio;
    ctx.clearRect(0, 0, width, height);

    var bg = ctx.createLinearGradient(0, 0, 0, height);
    bg.addColorStop(0, "#0e1020");
    bg.addColorStop(1, "#07080f");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    if (!this.midi) {
      return;
    }

    var labelWidth = this._labelWidth();
    var plotWidth = width - labelWidth;
    var pitchSpan = this.maxNote - this.minNote + 1;
    var laneHeight = height / pitchSpan;
    var noteHeight = Math.max(2 * ratio, laneHeight - Math.max(1, ratio * 0.6));
    var duration = this.duration || 1;

    // --- bandes des touches noires (repères de lecture) -------------------
    ctx.fillStyle = "rgba(255,255,255,.018)";
    for (var k = this.minNote; k <= this.maxNote; k++) {
      var pc = k % 12;
      if (pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10) {
        ctx.fillRect(labelWidth, (this.maxNote - k) * laneHeight, plotWidth, laneHeight);
      }
    }

    // --- grille temporelle ----------------------------------------------
    var step = duration > 600 ? 60 : duration > 120 ? 30 : duration > 45 ? 10 : 5;
    if (duration <= 20) {
      step = 2;
    }
    ctx.strokeStyle = "rgba(255,255,255,.05)";
    ctx.lineWidth = Math.max(1, ratio);
    ctx.beginPath();
    for (var time = step; time < duration; time += step) {
      var gx = Math.round(labelWidth + (time / duration) * plotWidth) + 0.5;
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, height);
    }
    ctx.stroke();

    // --- lignes d'octave -------------------------------------------------
    ctx.strokeStyle = "rgba(255,255,255,.08)";
    ctx.beginPath();
    for (var o = this.minNote; o <= this.maxNote + 1; o++) {
      if (o % 12 !== 0) {
        continue;
      }
      var ly = Math.round((this.maxNote - o + 1) * laneHeight) + 0.5;
      ctx.moveTo(labelWidth, ly);
      ctx.lineTo(width, ly);
    }
    ctx.stroke();

    // --- notes -----------------------------------------------------------
    var notes = this.midi.notes;
    var stride = notes.length > 20000 ? Math.ceil(notes.length / 20000) : 1;
    var radius = Math.min(2.5 * ratio, noteHeight / 2);
    for (var i = 0; i < notes.length; i += stride) {
      var note = notes[i];
      var x = labelWidth + (note.t / duration) * plotWidth;
      var w = Math.max(2 * ratio, (note.d / duration) * plotWidth);
      var y = (this.maxNote - note.n) * laneHeight;
      var hue = CHANNEL_HUES[note.c % CHANNEL_HUES.length];
      var light = 52 + ((note.v || 64) / 127) * 18;
      ctx.fillStyle = "hsla(" + hue + ", 85%, " + light + "%, .78)";
      if (w > 4 * ratio && noteHeight > 3 * ratio) {
        roundRect(ctx, x, y, w, noteHeight, radius);
        ctx.fill();
      } else {
        ctx.fillRect(x, y, w, noteHeight);
      }
    }
    if (stride > 1) {
      ctx.fillStyle = "rgba(200,190,255,.7)";
      ctx.font = 12 * ratio + "px system-ui, sans-serif";
      ctx.fillText(
        notes.length + " notes : aperçu allégé",
        labelWidth + 10 * ratio,
        18 * ratio
      );
    }

    // --- colonne des octaves --------------------------------------------
    ctx.fillStyle = "rgba(7,8,15,.92)";
    ctx.fillRect(0, 0, labelWidth, height);
    ctx.fillStyle = "rgba(255,255,255,.08)";
    ctx.fillRect(labelWidth - Math.max(1, ratio), 0, Math.max(1, ratio), height);
    ctx.fillStyle = "#7d84a6";
    ctx.font = "600 " + 10 * ratio + "px ui-monospace, monospace";
    ctx.textBaseline = "middle";
    for (var m = this.minNote; m <= this.maxNote; m++) {
      if (m % 12 !== 0) {
        continue;
      }
      var ty = (this.maxNote - m) * laneHeight + laneHeight / 2;
      if (laneHeight * 12 >= 14 * ratio) {
        ctx.fillText("C" + (Math.floor(m / 12) - 1), 8 * ratio, ty);
      }
    }
  };

  /* Notes en cours de lecture : recherche dichotomique sur les débuts. */
  PianoRoll.prototype._activeNotes = function (position) {
    var notes = this.midi.notes;
    var lo = 0;
    var hi = notes.length;
    var from = position - this.maxNoteDur;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (notes[mid].t < from) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    var active = [];
    for (var i = lo; i < notes.length && notes[i].t <= position; i++) {
      if (notes[i].t + notes[i].d >= position) {
        active.push(notes[i]);
        if (active.length > 256) {
          break;
        }
      }
    }
    return active;
  };

  PianoRoll.prototype.draw = function (position) {
    this.lastPosition = position;
    if (!this.width || !this.height) {
      this._resize();
    }
    var ctx = this.ctx;
    var ratio = this.ratio;
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.drawImage(this.layer, 0, 0);
    if (!this.midi) {
      return;
    }

    var labelWidth = this._labelWidth();
    var plotWidth = this.width - labelWidth;
    var duration = this.duration || 1;
    var x = this._xOf(position);
    var laneHeight = this.height / (this.maxNote - this.minNote + 1);

    // zone déjà jouée : légère teinte
    var played = ctx.createLinearGradient(labelWidth, 0, x, 0);
    played.addColorStop(0, "rgba(124,108,255,0.02)");
    played.addColorStop(1, "rgba(124,108,255,0.14)");
    ctx.fillStyle = played;
    ctx.fillRect(labelWidth, 0, Math.max(0, x - labelWidth), this.height);

    // notes en cours : surbrillance lumineuse
    if (position > 0) {
      var active = this._activeNotes(position);
      ctx.save();
      ctx.shadowColor = "rgba(190,180,255,.9)";
      ctx.shadowBlur = 12 * ratio;
      ctx.fillStyle = "rgba(255,255,255,.92)";
      for (var i = 0; i < active.length; i++) {
        var n = active[i];
        var nx = labelWidth + (n.t / duration) * plotWidth;
        var nw = Math.max(2 * ratio, (n.d / duration) * plotWidth);
        var ny = (this.maxNote - n.n) * laneHeight;
        ctx.fillRect(nx, ny, nw, Math.max(2 * ratio, laneHeight - ratio));
      }
      ctx.restore();
    }

    // indicateur de survol (position visée)
    if (this.hoverTime !== null && this.hoverTime !== undefined) {
      var hx = Math.round(this._xOf(this.hoverTime)) + 0.5;
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,.35)";
      ctx.setLineDash([4 * ratio, 4 * ratio]);
      ctx.lineWidth = Math.max(1, ratio);
      ctx.beginPath();
      ctx.moveTo(hx, 0);
      ctx.lineTo(hx, this.height);
      ctx.stroke();
      ctx.restore();
    }

    // trait de lecture + poignées (haut et bas) : c'est le contrôle de position
    ctx.save();
    ctx.shadowColor = "rgba(45,212,191,.85)";
    ctx.shadowBlur = 14 * ratio;
    ctx.strokeStyle = "#e9fffb";
    ctx.lineWidth = 2 * ratio;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, this.height);
    ctx.stroke();
    ctx.restore();

    var hw = 7 * ratio;
    var hh = 9 * ratio;
    ctx.fillStyle = "#2dd4bf";
    ctx.beginPath();
    ctx.moveTo(x - hw, 0);
    ctx.lineTo(x + hw, 0);
    ctx.lineTo(x, hh);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - hw, this.height);
    ctx.lineTo(x + hw, this.height);
    ctx.lineTo(x, this.height - hh);
    ctx.closePath();
    ctx.fill();
  };

  global.PianoRoll = PianoRoll;
})(typeof window !== "undefined" ? window : this);
