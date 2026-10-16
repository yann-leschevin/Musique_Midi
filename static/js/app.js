/**
 * app.js — Interface de l'application : chargement des fichiers MIDI,
 * commandes de lecture, progression, messages d'erreur et liste serveur.
 *
 * Aucun framework : HTML/CSS/JavaScript natifs uniquement.
 */
(function () {
  "use strict";

  var GM_NAMES = [
    "Piano acoustique", "Piano électrique", "Piano électrique (grand)", "Honky-tonk",
    "EP type Rhodes", "EP avec chœur", "Clavecin", "Clavinet",
    "Célesta", "Glockenspiel", "Boîte à musique", "Vibraphone",
    "Marimba", "Xylophone", "Cloches tubulaires", "Dulcimer",
    "Orgue lampe", "Orgue percussif", "Orgue rock", "Orgue d'église",
    "Orgue à anches", "Accordéon", "Harmonica", "Accordéon tango",
    "Guitare nylon", "Guitare acoustique", "Guitare jazz", "Guitare claire",
    "Guitare étouffée", "Overdrive", "Distorsion", "Harmoniques",
    "Contrebasse", "Basse électrique", "Basse slap", "Basse slap (2)",
    "Basse fretless", "Basse synthétiseur", "Basse synthétiseur (2)", "Violoncelle électrique",
    "Violon", "Alto", "Violoncelle", "Contrebasse",
    "Cordes tremblées", "Cordes sourdes", "Pizzicato", "Harpe",
    "Timbales", "Cordes (1)", "Cordes (2)", "Cordes synthétiques",
    "Cordes synthétiques (2)", "Chœurs Aah", "Chœurs Ooh", "Chœur synthétique",
    "Trompette", "Trombone", "Tuba", "Trompette sourde",
    "Cor française", "Section de cuivres", "Cuivres synthétiques", "Cuivres synthétiques (2)",
    "Saxophone soprano", "Saxophone alto", "Saxophone ténor", "Saxophone baryton",
    "Hautbois", "Cor anglais", "Basson", "Clarinette",
    "Piccolo", "Flûte", "Flûte douce", "Flûte de Pan",
    "Bouteille", "Shakuhachi", "Sifflet", "Ocarina",
    "Lead carré", "Lead en dents de scie", "Lead calliope", "Lead chiffres",
    "Lead voix", "Lead quintes", "Lead basse + lead", "Pad nouvelle vague",
    "Pad chaud", "Pad polysynth", "Pad chœur", "Pad d'archet",
    "Pad métallique", "Pad halo", "Pad balayage", "Pad pluie",
    "FX cristal", "FX atmosphère", "FX luminosité", "FX nuages",
    "FX écho", "FX espace", "FX musique de film", "FX cristal (2)",
    "Sitar", "Banjo", "Shamisen", "Koto",
    "Kalimba", "Cornemuse", "Shanai", "Clochette",
    "Agogô", "Stèles", "Taiko", "Mélodie de tom",
    "Synth-drum", "Goblet drum", "Percussions inversées", "Omochis",
    "Guitare + cloches", "Bruitages", "Téléphone", "Hélicoptère",
    "Applaudissements", "Coup de feu", "Respiration", "Foule"
  ];

  var MAX_SIZE_DEFAULT = 5 * 1024 * 1024;
  var maxSize = MAX_SIZE_DEFAULT;

  /* ---------------------------------------------------------------------- */
  /* Raccourcis DOM                                                          */
  /* ---------------------------------------------------------------------- */
  function $(id) {
    return document.getElementById(id);
  }

  var els = {
    backendBadge: $("backendBadge"),
    healthBadge: $("healthBadge"),
    dropzone: $("dropzone"),
    fileInput: $("fileInput"),
    btnChoose: $("btnChoose"),
    btnUpload: $("btnUpload"),
    maxSize: $("maxSize"),
    btnRefresh: $("btnRefresh"),
    midiTree: $("midiTree"),
    treeSearch: $("treeSearch"),
    btnExpandAll: $("btnExpandAll"),
    btnCollapseAll: $("btnCollapseAll"),
    midiList: $("midiList"),
    midiListEmpty: $("midiListEmpty"),
    midiListWarning: $("midiListWarning"),
    trackTitle: $("trackTitle"),
    playerState: $("playerState"),
    nowPlaying: $("nowPlaying"),
    dropHint: $("dropHint"),
    rollWrap: $("rollWrap"),
    roll: $("roll"),
    rollEmpty: $("rollEmpty"),
    rollTip: $("rollTip"),
    trackArtist: $("trackArtist"),
    cover: $("cover"),
    libraryBadge: $("libraryBadge"),
    timeCurrent: $("timeCurrent"),
    timeTotal: $("timeTotal"),
    btnPlay: $("btnPlay"),
    btnPause: $("btnPause"),
    btnResume: $("btnResume"),
    btnStop: $("btnStop"),
    volume: $("volume"),
    waveform: $("waveform"),
    sound: $("sound"),
    speed: $("speed"),
    speedValue: $("speedValue"),
    fileInfo: $("fileInfo"),
    fileMeta: $("fileMeta"),
    fileWarnings: $("fileWarnings"),
    messages: $("messages")
  };

  var state = {
    player: null,
    roll: null,
    parsed: null,
    currentName: null,
    localFile: null,
    localUploaded: true,
    scrubbing: false, // glisser du trait de lecture en cours
    scrubTime: 0,
    dragKind: null,   // "server" | "local"
    dragName: null,
    allFiles: [],
    treeFilter: "",
    collapsed: {}     // artistKey -> false si deplie (replie par defaut)
  };

  var DND_FILE = "application/x-midi-file";   // titre du dossier midis/
  var DND_LOCAL = "application/x-midi-local"; // fichier choisi sur le disque

  /* ---------------------------------------------------------------------- */
  /* Messages utilisateur                                                    */
  /* ---------------------------------------------------------------------- */
  function showMessage(type, text, autoHide) {
    var box = document.createElement("div");
    box.className = "msg msg-" + type;

    var body = document.createElement("span");
    body.textContent = text;
    box.appendChild(body);

    var close = document.createElement("button");
    close.className = "msg-close";
    close.type = "button";
    close.setAttribute("aria-label", "Fermer");
    close.textContent = "×";
    close.addEventListener("click", function () {
      if (box.parentNode) {
        box.parentNode.removeChild(box);
      }
    });
    box.appendChild(close);

    els.messages.appendChild(box);
    if (autoHide) {
      window.setTimeout(function () {
        if (box.parentNode) {
          box.parentNode.removeChild(box);
        }
      }, 5000);
    }
    return box;
  }

  function showError(text) {
    showMessage("error", text, false);
  }
  function showWarning(text) {
    showMessage("warning", text, true);
  }
  function showSuccess(text) {
    showMessage("success", text, true);
  }

  /* ---------------------------------------------------------------------- */
  /* Formats                                                                 */
  /* ---------------------------------------------------------------------- */
  function formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) {
      seconds = 0;
    }
    var total = Math.floor(seconds);
    var minutes = Math.floor(total / 60);
    var rest = total % 60;
    return minutes + ":" + (rest < 10 ? "0" : "") + rest;
  }

  function formatSize(bytes) {
    if (bytes < 1024) {
      return bytes + " o";
    }
    if (bytes < 1024 * 1024) {
      return (bytes / 1024).toFixed(1) + " Ko";
    }
    return (bytes / (1024 * 1024)).toFixed(2) + " Mo";
  }

  function baseName(filename) {
    return String(filename).replace(/\.(mid|midi)$/i, "");
  }

  function isAllowedFile(file) {
    return /\.(mid|midi)$/i.test(file.name);
  }

  /* ---------------------------------------------------------------------- */
  /* Sons (timbres) et vitesse                                               */
  /* ---------------------------------------------------------------------- */
  function soundLibrary() {
    var player = window.MidiPlayer;
    return player && player.SOUNDS ? player.SOUNDS : [];
  }

  function soundLabel(id) {
    if (id === "auto") {
      return "Auto (instrument du fichier)";
    }
    var sounds = soundLibrary();
    for (var i = 0; i < sounds.length; i++) {
      if (sounds[i].id === id) {
        return sounds[i].label;
      }
    }
    return id;
  }

  /* Petites icônes (SVG 24×24, trait) affichées à côté des sélecteurs. */
  var SOUND_ICONS = {
    auto:
      '<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
    piano:
      '<rect x="2.5" y="5" width="19" height="14" rx="1.5"/><path d="M7.25 19v-6M12 19v-6M16.75 19v-6"/>' +
      '<path d="M6.3 5.5h1.9v7H6.3zM11.05 5.5h1.9v7h-1.9zM15.8 5.5h1.9v7h-1.9z" fill="currentColor" stroke-width=".8"/>',
    "piano-electrique":
      '<rect x="2.5" y="4" width="19" height="15" rx="1.5"/><path d="M2.5 10h19"/>' +
      '<circle cx="6" cy="7" r=".9" fill="currentColor"/><circle cx="9.5" cy="7" r=".9" fill="currentColor"/>' +
      '<path d="M14 7h5"/><path d="M6.5 19v-9M10.5 19v-9M14.5 19v-9M18 19v-9"/>',
    orgue:
      '<path d="M3 20h18"/><path d="M4.5 20V11a1.25 1.25 0 0 1 2.5 0v9M8.5 20V7a1.25 1.25 0 0 1 2.5 0v13' +
      'M13 20V4a1.25 1.25 0 0 1 2.5 0v16M17 20V9a1.25 1.25 0 0 1 2.5 0v11"/>',
    guitare:
      '<path d="M13.2 10.8 20 4"/><path d="m18.5 2.5 3 3"/>' +
      '<path d="M10.5 9.5c-1.5-1.3-4-1-5.3.4-1 1-1 2.3-.6 3.2-1.6.4-2.6 1.8-2.1 3.6.6 2.4 3.4 4.1 5.6 3.4' +
      ' 1.6-.5 2.3-1.7 2.3-3.1.9.4 2.2.3 3.1-.6 1.4-1.3 1.6-3.8.3-5.3z"/><circle cx="9" cy="15" r="1.4"/>',
    basse:
      '<path d="M12.5 11.5 21 3"/><path d="M18 2.5h1.5M20.5 5v1.5"/>' +
      '<path d="M10 10c-1.3-1.6-3.7-1.4-4.8 0-.8 1-.7 2.1-.2 2.9-1.4.5-2.3 1.9-1.8 3.5.6 2.1 2.9 3.5 4.8 2.9' +
      ' 1.4-.5 2-1.6 2-2.8.8.3 1.9.2 2.6-.5 1.2-1.2 1.2-3.4-.1-4.6z"/><path d="M7 14.5l2 2"/>',
    harpe:
      '<path d="M5 21V4.5c4 .5 10 3 14 9.5l-1 1.5L5 21z"/><path d="M5 21h4"/>' +
      '<path d="M8.5 6v12.4M12 8v8.6M15.5 11v3.7"/>',
    cordes:
      '<path d="M12 3c-2.3 0-3.2 1.6-3 3.4.1 1-.7 1.6-1.4 2.2-1.2 1-1.1 2.6 0 3.5.9.7.9 1.4 0 2.2' +
      '-1.6 1.4-1 4.6 2 5.2.8.2 1.6.3 2.4.3s1.6-.1 2.4-.3c3-.6 3.6-3.8 2-5.2-.9-.8-.9-1.5 0-2.2' +
      ' 1.1-.9 1.2-2.5 0-3.5-.7-.6-1.5-1.2-1.4-2.2.2-1.8-.7-3.4-3-3.4z"/><path d="M12 5v11"/>' +
      '<path d="M10.2 13.2v1.6M13.8 13.2v1.6"/>',
    choeur:
      '<circle cx="8" cy="8" r="3"/><path d="M2.5 20c0-3.5 2.5-6 5.5-6s5.5 2.5 5.5 6"/>' +
      '<circle cx="16.5" cy="7" r="2.5"/><path d="M15.5 12.2c3.3-.6 6 1.8 6 5.3"/>' +
      '<path d="M7.2 9.3h1.6M15.8 8.1h1.4"/>',
    cuivres:
      '<path d="M2.5 12h12"/><path d="M14.5 12 21 7.5v9z"/><path d="M5 12v-1.5M3 12v3h9v-3"/>' +
      '<path d="M7 12V8.5M9.5 12V8.5M12 12V8.5"/><path d="M6.2 8.5h1.6M8.7 8.5h1.6M11.2 8.5h1.6"/>',
    saxophone:
      '<path d="M8 2.5 10 4v10.5a3.5 3.5 0 0 0 7 0V12l2.5-2"/><path d="M15.5 10.5 21 9.5 19.5 13z"/>' +
      '<path d="M6.5 3.5 10 2"/><circle cx="10" cy="8" r=".8" fill="currentColor"/>' +
      '<circle cx="10" cy="11" r=".8" fill="currentColor"/><circle cx="12.5" cy="17" r=".8" fill="currentColor"/>',
    flute:
      '<path d="m3.5 18 15-12a1.4 1.4 0 0 1 2 2l-15 12a1.4 1.4 0 0 1-2-2z"/>' +
      '<circle cx="8" cy="15.2" r=".8" fill="currentColor"/><circle cx="10.6" cy="13.1" r=".8" fill="currentColor"/>' +
      '<circle cx="13.2" cy="11" r=".8" fill="currentColor"/><circle cx="16.6" cy="8.3" r=".8" fill="currentColor"/>',
    lead:
      '<rect x="2.5" y="13" width="19" height="7" rx="1.5"/><path d="M7 20v-4M12 20v-4M17 20v-4"/>' +
      '<path d="M3 9.5 7 4v5.5l4-5.5v5.5l4-5.5v5.5l4-5.5v5.5"/>',
    pad:
      '<path d="M7 18.5a4 4 0 0 1-.6-8 5.5 5.5 0 0 1 10.6-1.3 4.6 4.6 0 0 1 .5 9.3z"/>' +
      '<path d="M9 14.5c1-1 2-1 3 0s2 1 3 0"/>',
    clochettes:
      '<path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 1.5h-15z"/><path d="M10 21a2 2 0 0 0 4 0"/>' +
      '<path d="M12 3v2"/><path d="M3 7.5 4.5 9M21 7.5 19.5 9"/>',
    marimba:
      '<rect x="3" y="5" width="3" height="14" rx="1"/><rect x="8" y="6.5" width="3" height="11" rx="1"/>' +
      '<rect x="13" y="8" width="3" height="8" rx="1"/><rect x="18" y="9.5" width="3" height="5" rx="1"/>' +
      '<path d="M14 2.5 20.5 4"/><circle cx="13" cy="2.5" r="1.3" fill="currentColor"/>'
  };

  function iconSvg(body) {
    return (
      '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" ' +
      'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + body + "</svg>"
    );
  }

  /** Valeur de l'onde `type` à la phase `t` (0 → 1 = une période). */
  function waveSample(type, t) {
    var x = 2 * Math.PI * t;
    switch (type) {
      case "sine":
        return Math.sin(x);
      case "square":
        return t < 0.5 ? 1 : -1;
      case "sawtooth":
        return t < 0.5 ? 2 * t : 2 * t - 2;
      case "triangle":
        return t < 0.25 ? 4 * t : (t < 0.75 ? 2 - 4 * t : 4 * t - 4);
    }
    var player = window.MidiPlayer;
    var coefs = player && player.waveCoefs ? player.waveCoefs(type) : null;
    if (!coefs) {
      return Math.sin(x);
    }
    /* Facteur sigma de Lanczos : gomme les ondulations de Gibbs à l'écran. */
    var count = coefs.real.length;
    var sum = 0;
    for (var n = 1; n < count; n++) {
      var u = (Math.PI * n) / count;
      var sigma = Math.sin(u) / u;
      sum += sigma * (coefs.real[n] * Math.cos(n * x) + coefs.imag[n] * Math.sin(n * x));
    }
    return sum;
  }

  /** Tracé de deux périodes de l'onde, normalisé dans la boîte 24×24. */
  function waveIconSvg(type, dashed) {
    var steps = 96;
    var values = [];
    var peak = 0;
    for (var i = 0; i <= steps; i++) {
      var v = waveSample(type, ((i / steps) * 2) % 1);
      values.push(v);
      peak = Math.max(peak, Math.abs(v));
    }
    peak = peak || 1;
    var d = "";
    for (var k = 0; k <= steps; k++) {
      var px = 2 + (k / steps) * 20;
      var py = 12 - (values[k] / peak) * 7.5;
      d += (k === 0 ? "M" : "L") + px.toFixed(2) + " " + py.toFixed(2);
    }
    return iconSvg(
      '<path d="M2 12h20" stroke-width="1" opacity=".25"/>' +
        '<path d="' + d + '"' + (dashed ? ' stroke-dasharray="2.5 2"' : "") + "/>"
    );
  }

  /** Met à jour les icônes à côté des sélecteurs « Son » et « Forme d'onde ». */
  function renderOptionIcons() {
    var soundId = els.sound ? els.sound.value : "auto";
    var soundIcon = $("soundIcon");
    if (soundIcon) {
      soundIcon.innerHTML = iconSvg(SOUND_ICONS[soundId] || SOUND_ICONS.auto);
      soundIcon.title = soundLabel(soundId);
    }
    var waveIcon = $("waveIcon");
    if (waveIcon && els.waveform) {
      var wave = els.waveform.value;
      if (wave === "auto") {
        /* « Auto » : l'onde du son choisi (piano si le son suit le fichier). */
        var sounds = soundLibrary();
        var base = "triangle";
        for (var i = 0; i < sounds.length; i++) {
          if (sounds[i].id === (soundId === "auto" ? "piano" : soundId)) {
            base = sounds[i].wave || base;
          }
        }
        waveIcon.innerHTML = waveIconSvg(base, true);
      } else {
        waveIcon.innerHTML = waveIconSvg(wave, false);
      }
      var selected = els.waveform.options[els.waveform.selectedIndex];
      waveIcon.title = selected ? selected.textContent : wave;
    }
  }

  /** Remplit le sélecteur de sons à partir des pré définis du lecteur. */
  function fillSoundSelect() {
    if (!els.sound) {
      return;
    }
    var sounds = soundLibrary();
    for (var i = 0; i < sounds.length; i++) {
      var option = document.createElement("option");
      option.value = sounds[i].id;
      option.textContent = sounds[i].label;
      els.sound.appendChild(option);
    }
    els.sound.value = state.player.getSound();
  }

  function renderSpeed(rate) {
    var text = Number(rate).toFixed(2).replace(".", ",") + "×";
    els.speedValue.textContent = text;
    els.speed.setAttribute("aria-valuetext", text);
  }

  /* ---------------------------------------------------------------------- */
  /* Sante du serveur                                                        */
  /* ---------------------------------------------------------------------- */
  function loadHealth() {
    fetch("/api/health")
      .then(function (response) {
        return response.json();
      })
      .then(function (data) {
        els.backendBadge.textContent = "backend : " + data.flask_backend;
        els.backendBadge.className =
          "badge " + (data.flask_backend === "flask" ? "badge-ok" : "");
        els.backendBadge.title =
          data.flask_backend === "flask"
            ? "Flask est installé et utilisé normalement."
            : "Flask absent : couche de compatibilité embarquée (aucune dépendance installée).";
        if (data.max_size) {
          maxSize = data.max_size;
          els.maxSize.textContent = formatSize(data.max_size);
        }
        els.healthBadge.textContent = "serveur : en ligne";
        els.healthBadge.className = "badge badge-ok";
      })
      .catch(function () {
        els.healthBadge.textContent = "serveur : injoignable";
        els.healthBadge.className = "badge badge-err";
        showError("Impossible de contacter le serveur (/api/health).");
      });
  }

  /* ---------------------------------------------------------------------- */
  /* Liste des fichiers serveur                                              */
  /* ---------------------------------------------------------------------- */
  function refreshList() {
    return fetch("/api/midis")
      .then(function (response) {
        if (!response.ok) {
          throw new Error("Réponse invalide du serveur (" + response.status + ").");
        }
        return response.json();
      })
      .then(function (data) {
        renderList(data.files || [], data.warning || null, data.groups || null);
      })
      .catch(function (error) {
        renderList([], "Lecture du dossier midis/ impossible : " + error.message, null);
      });
  }

  /* Fallback cote client si le serveur ne fournit pas artist/title. */
  function clientArtistOf(entry) {
    if (entry.artist) {
      return {
        artist: entry.artist,
        key: entry.artist_key || entry.artist.toLowerCase(),
        title: entry.title || entry.name
      };
    }
    var name = entry.name || "";
    if (name === "EMPEROR.mid") {
      return { artist: "Beethoven, Ludwig van", key: "beethoven, ludwig van", title: "Concerto Empereur" };
    }
    var parts = name.split(" - ");
    if (parts.length >= 2) {
      var pretty = parts[0].replace(/_/g, " ").trim();
      var title = parts.slice(1).join(" - ").replace(/\.(mid|midi)$/i, "").replace(/_/g, " ").trim();
      return { artist: pretty || "Divers / Inconnu", key: (pretty || "zzz").toLowerCase(), title: title || name };
    }
    if (/^demo_/i.test(name)) {
      return { artist: "Démos du projet", key: "zzz demos du projet", title: name.replace(/_/g, " ") };
    }
    return { artist: "Divers / Inconnu", key: "zzz divers / inconnu", title: name };
  }

  /** Minuscules sans accents : « Dvořák » est trouvé en tapant « dvorak ». */
  function plain(text) {
    var value = String(text || "").toLowerCase();
    return value.normalize ? value.normalize("NFD").replace(/[\u0300-\u036f]/g, "") : value;
  }

  /** Teinte stable par artiste (pastille d'initiale). */
  function hueOf(text) {
    var hash = 0;
    for (var i = 0; i < text.length; i++) {
      hash = (hash * 31 + text.charCodeAt(i)) % 360;
    }
    return hash;
  }

  function groupFiles(files) {
    var map = {};
    var order = [];
    files.forEach(function (entry) {
      var info = clientArtistOf(entry);
      var key = info.key;
      if (!map[key]) {
        map[key] = { artist: info.artist, key: key, files: [] };
        order.push(key);
      }
      map[key].files.push({ entry: entry, title: info.title });
    });
    order.sort(function (a, b) {
      return a < b ? -1 : a > b ? 1 : 0;
    });
    return order.map(function (key) {
      var group = map[key];
      group.files.sort(function (a, b) {
        var ta = a.title.toLowerCase();
        var tb = b.title.toLowerCase();
        if (ta !== tb) {
          return ta < tb ? -1 : 1;
        }
        var na = a.entry.name.toLowerCase();
        var nb = b.entry.name.toLowerCase();
        return na < nb ? -1 : na > nb ? 1 : 0;
      });
      return group;
    });
  }

  function makeFileItem(entry, title) {
    var item = document.createElement("li");
    item.className = "file-item";
    item.tabIndex = 0;
    item.setAttribute("role", "treeitem");
    if (entry.name === state.currentName) {
      item.classList.add("active");
    }
    item.dataset.name = entry.name;

    var icon = document.createElement("span");
    icon.className = "ico";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "♫";

    var name = document.createElement("span");
    name.className = "name";
    name.textContent = title || entry.name;
    name.title = entry.name;

    var size = document.createElement("span");
    size.className = "size";
    size.textContent = formatSize(entry.size);

    item.appendChild(icon);
    item.appendChild(name);
    item.appendChild(size);

    /* Glisser ce titre vers « Fichier chargé » le charge et le lit. */
    item.draggable = true;
    item.addEventListener("dragstart", function (event) {
      state.dragKind = "server";
      state.dragName = entry.name;
      item.classList.add("dragging");
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData("text/plain", entry.name);
        event.dataTransfer.setData(DND_FILE, entry.name);
      }
    });
    item.addEventListener("dragend", function () {
      item.classList.remove("dragging");
      state.dragKind = null;
      state.dragName = null;
    });

    function activate() {
      loadFromServer(entry.name);
    }
    item.addEventListener("click", activate);
    item.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        activate();
      }
    });
    return item;
  }

  function setGroupCollapsed(groupEl, childrenEl, toggleBtn, collapsed) {
    groupEl.classList.toggle("collapsed", collapsed);
    childrenEl.hidden = collapsed;
    toggleBtn.setAttribute("aria-expanded", collapsed ? "false" : "true");
  }

  function renderTree(groups, filterText) {
    var tree = els.midiTree;
    /* Compatibilite si vieux HTML en cache : repli sur l'ancienne liste. */
    if (!tree) {
      var legacy = els.midiList;
      if (legacy) {
        legacy.textContent = "";
        groups.forEach(function (group) {
          group.files.forEach(function (wrapper) {
            legacy.appendChild(makeFileItem(wrapper.entry, wrapper.entry.name));
          });
        });
      }
      return;
    }
    tree.textContent = "";
    var query = plain((filterText || "").trim());
    var visibleGroups = 0;
    var visibleFiles = 0;

    groups.forEach(function (group) {
      var matching = group.files.filter(function (wrapper) {
        if (!query) {
          return true;
        }
        return (
          plain(group.artist).indexOf(query) !== -1 ||
          plain(wrapper.title).indexOf(query) !== -1 ||
          plain(wrapper.entry.name).indexOf(query) !== -1
        );
      });
      if (matching.length === 0) {
        return;
      }
      visibleGroups += 1;
      visibleFiles += matching.length;

      var groupEl = document.createElement("div");
      groupEl.className = "tree-group";
      groupEl.dataset.key = group.key;
      groupEl.setAttribute("role", "treeitem");
      /* Replie par defaut (demarrage compris) ; deplie pendant une recherche. */
      var collapsed = query ? false : state.collapsed[group.key] !== false;

      var toggle = document.createElement("button");
      toggle.className = "tree-toggle";
      toggle.type = "button";
      toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");

      var chevron = document.createElement("span");
      chevron.className = "chevron";
      chevron.setAttribute("aria-hidden", "true");
      chevron.textContent = "▾";

      /* « Nom, Prénom » : nom de famille en avant (clé du tri). */
      var comma = group.artist.indexOf(", ");
      var surname = comma > 0 ? group.artist.slice(0, comma) : group.artist;
      var given = comma > 0 ? group.artist.slice(comma + 2) : "";

      var avatar = document.createElement("span");
      avatar.className = "tree-avatar";
      avatar.setAttribute("aria-hidden", "true");
      avatar.textContent = surname.charAt(0).toUpperCase();
      avatar.style.setProperty("--h", String(hueOf(surname)));

      var label = document.createElement("span");
      label.className = "tree-artist";
      label.title = group.artist;
      var strong = document.createElement("strong");
      strong.textContent = surname;
      label.appendChild(strong);
      if (given) {
        var small = document.createElement("span");
        small.className = "tree-given";
        small.textContent = given;
        label.appendChild(small);
      }

      var count = document.createElement("span");
      count.className = "tree-count";
      count.textContent = query
        ? matching.length + " / " + group.files.length
        : String(group.files.length);

      toggle.appendChild(chevron);
      toggle.appendChild(avatar);
      toggle.appendChild(label);
      toggle.appendChild(count);

      var children = document.createElement("ul");
      children.className = "tree-children";
      children.setAttribute("role", "group");
      matching.forEach(function (wrapper) {
        children.appendChild(makeFileItem(wrapper.entry, wrapper.title));
      });

      groupEl.appendChild(toggle);
      groupEl.appendChild(children);
      setGroupCollapsed(groupEl, children, toggle, collapsed);

      toggle.addEventListener("click", function () {
        var nowCollapsed = !groupEl.classList.contains("collapsed");
        state.collapsed[group.key] = nowCollapsed;
        setGroupCollapsed(groupEl, children, toggle, nowCollapsed);
      });
      toggle.addEventListener("keydown", function (event) {
        if (event.key === "ArrowRight") {
          event.preventDefault();
          state.collapsed[group.key] = false;
          setGroupCollapsed(groupEl, children, toggle, false);
        } else if (event.key === "ArrowLeft") {
          event.preventDefault();
          state.collapsed[group.key] = true;
          setGroupCollapsed(groupEl, children, toggle, true);
        }
      });

      tree.appendChild(groupEl);
    });

    if (visibleGroups === 0) {
      var empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = query
        ? "Aucun résultat pour « " + filterText.trim() + " »."
        : "Aucun fichier MIDI disponible pour le moment.";
      tree.appendChild(empty);
    }
    els.midiListEmpty.hidden = visibleFiles > 0;
    markActiveInTree();
  }

  function markActiveInTree() {
    var tree = els.midiTree;
    if (!tree || !tree.querySelectorAll) {
      return;
    }
    var items = tree.querySelectorAll(".file-item");
    for (var i = 0; i < items.length; i++) {
      items[i].classList.toggle("active", items[i].dataset.name === state.currentName);
    }
    var groupsEls = tree.querySelectorAll(".tree-group");
    for (var j = 0; j < groupsEls.length; j++) {
      groupsEls[j].classList.toggle(
        "has-active",
        !!groupsEls[j].querySelector(".file-item.active")
      );
    }
  }

  function renderList(files, warning, groups) {
    els.midiListWarning.hidden = !warning;
    if (warning) {
      els.midiListWarning.textContent = warning;
    }
    state.allFiles = files.slice();
    if (els.libraryBadge) {
      var artists = {};
      files.forEach(function (entry) {
        artists[clientArtistOf(entry).key] = true;
      });
      els.libraryBadge.textContent =
        files.length + " œuvres · " + Object.keys(artists).length + " artistes";
    }
    var treeGroups;
    if (groups && groups.length) {
      /* Groupes serveur deja tries par artiste puis titre. */
      treeGroups = groups.map(function (group) {
        return {
          artist: group.artist,
          key: group.artist_key || group.artist.toLowerCase(),
          files: (group.files || []).map(function (entry) {
            return { entry: entry, title: entry.title || entry.name };
          })
        };
      });
    } else {
      treeGroups = groupFiles(files);
    }
    renderTree(treeGroups, state.treeFilter);
  }

  function bindTreeToolbar() {
    if (els.treeSearch) {
      els.treeSearch.addEventListener("input", function () {
        state.treeFilter = els.treeSearch.value || "";
        renderTree(groupFiles(state.allFiles), state.treeFilter);
        /* Apres un filtre, on repart des groupes serveur au prochain refresh. */
        if (!state.allFiles.length) {
          return;
        }
      });
    }
    if (els.btnExpandAll) {
      els.btnExpandAll.addEventListener("click", function () {
        var groups = groupFiles(state.allFiles);
        groups.forEach(function (group) {
          state.collapsed[group.key] = false;
        });
        renderTree(groups, state.treeFilter);
      });
    }
    if (els.btnCollapseAll) {
      els.btnCollapseAll.addEventListener("click", function () {
        state.collapsed = {};
        renderTree(groupFiles(state.allFiles), state.treeFilter);
      });
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Chargement / parsing                                                    */
  /* ---------------------------------------------------------------------- */
  function parseBuffer(buffer, name) {
    var parsed;
    try {
      parsed = window.MidiFile.parse(buffer);
    } catch (error) {
      throw new Error(
        "Lecture impossible pour « " + name + " » : " + error.message
      );
    }
    if (!parsed || !parsed.notes) {
      throw new Error("Le fichier n'a produit aucune note jouable.");
    }
    return parsed;
  }

  function applyParsed(parsed, name, sourceLabel) {
    state.parsed = parsed;
    state.currentName = name;
    markActiveInTree();

    var entry = null;
    for (var i = 0; i < state.allFiles.length; i++) {
      if (state.allFiles[i].name === name) {
        entry = state.allFiles[i];
        break;
      }
    }
    var info = entry ? clientArtistOf(entry) : null;
    var title = info ? info.title : parsed.title || baseName(name);
    els.trackTitle.textContent = title;
    if (els.trackArtist) {
      els.trackArtist.textContent = info
        ? info.artist.replace(/^(.+), (.+)$/, "$2 $1")
        : sourceLabel || "Fichier local";
    }
    els.rollEmpty.hidden = true;

    renderInfo(parsed, name, sourceLabel);

    state.player.load(parsed);
    els.timeTotal.textContent = formatTime(parsed.duration);
    els.timeCurrent.textContent = "0:00";
    updateProgress(0, parsed.duration);

    if (state.roll) {
      state.roll.setMidi(parsed);
    }

    parsed.warnings.forEach(function (warning) {
      showWarning(warning);
    });

    if (parsed.format !== 0 && parsed.format !== 1) {
      showWarning("Format SMF " + parsed.format + " non standard.");
    }
  }

  function renderInfo(parsed, name, sourceLabel) {
    els.fileInfo.hidden = false;
    els.fileMeta.textContent = "";

    var rows = [
      ["Fichier", name],
      ["Source", sourceLabel],
      ["Format SMF", String(parsed.format)],
      ["Pistes", parsed.parsedTracks + " (déclarées : " + parsed.declaredTracks + ")"],
      ["Division", parsed.division.label],
      ["Durée", formatTime(parsed.duration)],
      ["Notes", String(parsed.totalNotes)],
      [
        "Tempo",
        parsed.tempos
          .map(function (tempo) {
            return tempo.bpm + " BPM";
          })
          .filter(function (value, index, array) {
            return array.indexOf(value) === index;
          })
          .slice(0, 4)
          .join(" → ") || "—",
      ],
      ["Canaux", parsed.channels.map(function (c) { return c + 1; }).join(", ") || "—"],
      ["Instruments", describePrograms(parsed.programs)]
    ];

    rows.forEach(function (row) {
      var line = document.createElement("div");
      var dt = document.createElement("dt");
      dt.textContent = row[0];
      var dd = document.createElement("dd");
      dd.textContent = row[1];
      line.appendChild(dt);
      line.appendChild(dd);
      els.fileMeta.appendChild(line);
    });

    els.fileWarnings.textContent = "";
    parsed.warnings.forEach(function (warning) {
      var item = document.createElement("li");
      item.textContent = warning;
      els.fileWarnings.appendChild(item);
    });
  }

  function describePrograms(programs) {
    if (!programs || programs.length === 0) {
      return "non renseigné";
    }
    var seen = {};
    var parts = [];
    programs.forEach(function (program) {
      var key = program.channel + ":" + program.program;
      if (seen[key]) {
        return;
      }
      seen[key] = true;
      var name = GM_NAMES[program.program] || ("programme " + program.program);
      var label = "canal " + (program.channel + 1) + " : " + name;
      if (parts.length < 4) {
        parts.push(label);
      }
    });
    return parts.join(" · ") || "non renseigné";
  }

  /** Démarre la lecture (utilisé après un dépôt sur « Fichier chargé »). */
  function startPlayback() {
    try {
      state.player.play();
    } catch (error) {
      showError("Lecture impossible : " + error.message);
      return;
    }
    showSuccess("Lecture automatique démarrée.");
    warnIfAudioSuspended();
  }

  /**
   * Un dépôt n'est pas toujours accepté comme « geste utilisateur » par le
   * navigateur : si l'AudioContext reste suspendu, on débloque au prochain clic.
   */
  function warnIfAudioSuspended() {
    var ctx = state.player && state.player.ctx;
    if (!ctx || ctx.state !== "suspended") {
      return;
    }
    showWarning(
      "Le navigateur attend un geste pour autoriser le son : cliquez une fois " +
        "(ou appuyez sur une touche) pour entendre la lecture."
    );
    var unlock = function () {
      var result = ctx.resume();
      if (result && typeof result.then === "function") {
        result.then(
          function () { showSuccess("Son autorisé : lecture en cours."); },
          function () {}
        );
      }
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("keydown", unlock);
    };
    document.addEventListener("pointerdown", unlock);
    document.addEventListener("keydown", unlock);
  }

  function handleLocalFile(file, autoplay) {
    if (!file) {
      return;
    }
    if (!isAllowedFile(file)) {
      showError(
        "« " + file.name + " » est ignoré : seuls les fichiers .mid ou .midi sont acceptés."
      );
      return;
    }
    if (file.size > maxSize) {
      showError(
        "Fichier trop volumineux (" +
          formatSize(file.size) +
          ") : maximum " +
          formatSize(maxSize) +
          "."
      );
      return;
    }

    var reader = new FileReader();
    reader.onerror = function () {
      showError("Impossible de lire le fichier « " + file.name + " ».");
    };
    reader.onload = function () {
      try {
        var parsed = parseBuffer(reader.result, file.name);
        state.localFile = file;
        state.localUploaded = false;
        els.btnUpload.disabled = false;
        syncDropzoneDraggability();
        applyParsed(parsed, file.name, "fichier local");
        showSuccess("« " + file.name + " » chargé depuis votre disque.");
        if (autoplay) {
          startPlayback();
        }
      } catch (error) {
        showError(error.message);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function loadFromServer(name, autoplay) {
    var url = "/api/midi/" + encodeURIComponent(name);
    fetch(url)
      .then(function (response) {
        if (!response.ok) {
          return response
            .json()
            .catch(function () {
              return null;
            })
            .then(function (payload) {
              throw new Error(
                (payload && payload.error) ||
                  "Téléchargement refusé (" + response.status + ")."
              );
            });
        }
        return response.arrayBuffer();
      })
      .then(function (buffer) {
        if (buffer.byteLength > maxSize) {
          throw new Error(
            "Fichier trop volumineux (" +
              formatSize(buffer.byteLength) +
              ") : maximum " +
              formatSize(maxSize) +
              "."
          );
        }
        var parsed = parseBuffer(buffer, name);
        applyParsed(parsed, name, "dossier midis/");
        refreshList();
        if (autoplay) {
          startPlayback();
        }
      })
      .catch(function (error) {
        showError(error.message);
        refreshList();
      });
  }

  function uploadLocalFile() {
    var file = state.localFile;
    if (!file || state.localUploaded) {
      return;
    }
    els.btnUpload.disabled = true;
    fetch("/api/upload", {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-File-Name": file.name
      },
      body: file
    })
      .then(function (response) {
        return response
          .json()
          .catch(function () {
            return null;
          })
          .then(function (payload) {
            if (!response.ok || !payload || payload.ok !== true) {
              throw new Error(
                (payload && payload.error) ||
                  "Envoi refusé par le serveur (" + response.status + ")."
              );
            }
            return payload;
          });
      })
      .then(function (payload) {
        state.localUploaded = true;
        els.btnUpload.disabled = true;
        showSuccess(
          "« " + payload.name + " » envoyé dans midis/ (" + formatSize(payload.size) + ")."
        );
        return refreshList();
      })
      .catch(function (error) {
        els.btnUpload.disabled = false;
        showError("Envoi impossible : " + error.message);
      });
  }

  /* ---------------------------------------------------------------------- */
  /* Transport / progression                                                 */
  /* ---------------------------------------------------------------------- */
  function updateButtons(playerState) {
    var loaded = !!state.parsed;
    els.btnPlay.disabled = !loaded || playerState === "playing";
    els.btnPause.disabled = playerState !== "playing";
    els.btnResume.disabled = playerState !== "paused";
    els.btnStop.disabled =
      loaded && (playerState === "playing" || playerState === "paused");

    var labels = {
      empty: "arrêt",
      stopped: "arrêt",
      playing: "lecture",
      paused: "en pause",
      ended: "terminé",
      error: "erreur"
    };
    els.playerState.textContent = labels[playerState] || playerState;
    if (els.cover) {
      els.cover.classList.toggle("playing", playerState === "playing");
    }
    els.playerState.className =
      "state" +
      (playerState === "playing" ? " playing" : "") +
      (playerState === "paused" ? " paused" : "");
  }

  function updateProgress(position, duration) {
    var ratio = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;
    if (state.scrubbing) {
      return; /* l'utilisateur tient le trait : on ne le lui reprend pas */
    }
    els.timeCurrent.textContent = formatTime(position);
    els.rollWrap.setAttribute("aria-valuenow", Math.round(ratio * 100));
    els.rollWrap.setAttribute(
      "aria-valuetext",
      formatTime(position) + " sur " + formatTime(duration)
    );
    if (state.roll) {
      state.roll.draw(position);
    }
  }

  function bindTransport() {
    els.btnPlay.addEventListener("click", function () {
      try {
        state.player.play();
      } catch (error) {
        showError(error.message);
      }
    });
    els.btnPause.addEventListener("click", function () {
      state.player.pause();
    });
    els.btnResume.addEventListener("click", function () {
      try {
        state.player.resume();
      } catch (error) {
        showError(error.message);
      }
    });
    els.btnStop.addEventListener("click", function () {
      state.player.stop();
    });

    /* ------------------------------------------------------------------ */
    /* Musicogramme = contrôle de position (plus de barre de progression)  */
    /* Clic : saute à l'instant visé. Glisser le trait : aperçu immédiat,  */
    /* le lecteur n'est repositionné qu'au relâchement (son non haché).    */
    /* ------------------------------------------------------------------ */
    var wrap = els.rollWrap;
    var canvas = els.roll;

    function showTip(time, clientX) {
      if (!els.rollTip) {
        return;
      }
      if (time === null) {
        els.rollTip.hidden = true;
        return;
      }
      var rect = wrap.getBoundingClientRect();
      var x = Math.max(28, Math.min(rect.width - 28, clientX - rect.left));
      els.rollTip.style.left = x + "px";
      els.rollTip.textContent = formatTime(time);
      els.rollTip.hidden = false;
    }

    function previewAt(time) {
      state.scrubTime = time;
      state.roll.draw(time);
      els.timeCurrent.textContent = formatTime(time);
    }

    canvas.addEventListener("pointerdown", function (event) {
      if (!state.parsed || event.button > 0) {
        return;
      }
      var time = state.roll.timeAt(event.clientX);
      if (time === null) {
        return;
      }
      event.preventDefault();
      wrap.focus({ preventScroll: true });
      state.scrubbing = true;
      wrap.classList.add("scrubbing");
      state.roll.setHover(null);
      previewAt(time);
      showTip(time, event.clientX);
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch (error) {
        /* capture non disponible */
      }
    });

    canvas.addEventListener("pointermove", function (event) {
      if (!state.parsed) {
        return;
      }
      var time = state.roll.timeAt(event.clientX);
      if (state.scrubbing) {
        previewAt(time);
        showTip(time, event.clientX);
        return;
      }
      wrap.classList.toggle("near-head", state.roll.isNearPlayhead(event.clientX));
      state.roll.setHover(time);
      showTip(time, event.clientX);
    });

    function endScrub(event, apply) {
      if (!state.scrubbing) {
        return;
      }
      state.scrubbing = false;
      wrap.classList.remove("scrubbing");
      if (event && canvas.hasPointerCapture && canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
      showTip(null);
      if (apply) {
        state.player.seek(state.scrubTime);
      } else {
        updateProgress(state.player.getPosition(), state.parsed.duration);
      }
    }

    canvas.addEventListener("pointerup", function (event) {
      endScrub(event, true);
    });
    canvas.addEventListener("pointercancel", function (event) {
      endScrub(event, false);
    });
    canvas.addEventListener("pointerleave", function () {
      if (!state.scrubbing && state.parsed) {
        state.roll.setHover(null);
        wrap.classList.remove("near-head");
        showTip(null);
      }
    });

    wrap.addEventListener("keydown", function (event) {
      if (!state.parsed) {
        return;
      }
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        var delta = event.key === "ArrowRight" ? 5 : -5;
        state.player.seek(state.player.getPosition() + delta);
      } else if (event.key === "Home") {
        event.preventDefault();
        state.player.seek(0);
      } else if (event.key === "End") {
        event.preventDefault();
        state.player.seek(state.parsed.duration);
      }
    });

    els.volume.addEventListener("input", function () {
      state.player.setVolume(Number(els.volume.value) / 100);
    });
    els.waveform.addEventListener("change", function () {
      state.player.setWaveform(els.waveform.value);
      renderOptionIcons();
    });
    els.sound.addEventListener("change", function () {
      var id = state.player.setSound(els.sound.value);
      els.sound.value = id;
      renderOptionIcons();
      showSuccess("Son : " + soundLabel(id) + ".");
    });
    els.speed.addEventListener("input", function () {
      var rate = Number(els.speed.value) / 100;
      state.player.setSpeed(rate);
      renderSpeed(state.player.getSpeed());
    });

    document.addEventListener("keydown", function (event) {
      var target = event.target;
      var tag = target && target.tagName ? target.tagName.toLowerCase() : "";
      if (tag === "input" || tag === "select" || tag === "textarea" || tag === "button") {
        return;
      }
      if (event.key === " " || event.code === "Space") {
        event.preventDefault();
        try {
          if (state.player.getState() === "playing") {
            state.player.pause();
          } else {
            state.player.play();
          }
        } catch (error) {
          showError(error.message);
        }
      } else if (event.key === "s" || event.key === "S") {
        event.preventDefault();
        state.player.stop();
      }
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Chargement de fichier / glisser-déposer                                 */
  /* ---------------------------------------------------------------------- */

  /** Ce glisser contient-il un fichier ou un titre du projet ? */
  function hasDragPayload(dt) {
    if (!dt) {
      return false;
    }
    if (dt.files && dt.files.length > 0) {
      return true;
    }
    var types = dt.types || [];
    for (var i = 0; i < types.length; i++) {
      if (types[i] === "Files" || types[i] === DND_FILE || types[i] === DND_LOCAL) {
        return true;
      }
    }
    return false;
  }

  /** Lit le contenu d'un glisser-déposer : fichier disque ou titre serveur. */
  function dropPayload(dt, autoplay) {
    var files = dt && dt.files;
    if (files && files.length > 0) {
      handleLocalFile(files[0], autoplay);
      return true;
    }
    var name = dt && dt.getData ? dt.getData(DND_FILE) : "";
    if (name) {
      loadFromServer(name, autoplay);
      return true;
    }
    if (dt && dt.getData && dt.getData(DND_LOCAL) && state.localFile) {
      handleLocalFile(state.localFile, autoplay);
      return true;
    }
    return false;
  }

  /** Rend le dépôt local glissable dès qu'un fichier est sélectionné. */
  function syncDropzoneDraggability() {
    var draggable = !!state.localFile;
    els.dropzone.draggable = draggable;
    els.dropzone.classList.toggle("draggable", draggable);
  }

  function bindFilePicker() {
    els.btnChoose.addEventListener("click", function () {
      els.fileInput.click();
    });
    els.dropzone.addEventListener("click", function () {
      els.fileInput.click();
    });
    els.dropzone.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        els.fileInput.click();
      }
    });
    els.fileInput.addEventListener("change", function () {
      if (els.fileInput.files && els.fileInput.files.length > 0) {
        handleLocalFile(els.fileInput.files[0]);
      }
      els.fileInput.value = "";
    });

    els.dropzone.addEventListener("dragstart", function (event) {
      if (!state.localFile) {
        event.preventDefault();
        return;
      }
      state.dragKind = "local";
      state.dragName = state.localFile.name;
      els.dropzone.classList.add("dragging");
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData("text/plain", state.localFile.name);
        event.dataTransfer.setData(DND_LOCAL, "1");
      }
    });
    els.dropzone.addEventListener("dragend", function () {
      els.dropzone.classList.remove("dragging");
      state.dragKind = null;
      state.dragName = null;
    });

    ["dragenter", "dragover"].forEach(function (name) {
      els.dropzone.addEventListener(name, function (event) {
        if (!hasDragPayload(event.dataTransfer)) {
          return;
        }
        event.preventDefault();
        els.dropzone.classList.add("dragover");
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = "copy";
        }
      });
    });
    ["dragleave", "drop"].forEach(function (name) {
      els.dropzone.addEventListener(name, function (event) {
        event.preventDefault();
        els.dropzone.classList.remove("dragover");
      });
    });
    els.dropzone.addEventListener("drop", function (event) {
      dropPayload(event.dataTransfer, false);
    });

    els.btnUpload.addEventListener("click", uploadLocalFile);
    els.btnRefresh.addEventListener("click", function () {
      refreshList();
    });
    bindTreeToolbar();
    bindDropTarget();
  }

  /* ---------------------------------------------------------------------- */
  /* Dépôt sur la scène (« En lecture » ou musicogramme) : charge + lecture   */
  /* automatique                                                             */
  /* ---------------------------------------------------------------------- */
  function bindDropTarget() {
    var target = els.nowPlaying && els.nowPlaying.closest(".stage");
    if (!target) {
      return;
    }

    /* Un fichier lâché à côté de la zone ne doit pas faire quitter la page. */
    ["dragover", "drop"].forEach(function (name) {
      window.addEventListener(name, function (event) {
        if (hasDragPayload(event.dataTransfer)) {
          event.preventDefault();
        }
      });
    });

    function over(on) {
      els.nowPlaying.classList.toggle("drop-hover", on);
      els.rollWrap.classList.toggle("drop-hover", on);
      if (els.dropHint) {
        els.dropHint.textContent = on
          ? "Relâchez pour charger et lancer la lecture"
          : "Glissez ici un titre ou un fichier pour le lancer";
      }
    }

    ["dragenter", "dragover"].forEach(function (name) {
      target.addEventListener(name, function (event) {
        if (!hasDragPayload(event.dataTransfer)) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = "copy";
        }
        over(true);
      });
    });

    target.addEventListener("dragleave", function (event) {
      var next = event.relatedTarget;
      if (next && target.contains(next)) {
        return;
      }
      over(false);
    });

    target.addEventListener("drop", function (event) {
      event.preventDefault();
      event.stopPropagation();
      over(false);
      /* Le chargement est asynchrone : on réveille l'audio tant que le geste
         de glisser est encore récent, sinon le navigateur bloque la lecture. */
      try {
        state.player._ensureContext();
      } catch (error) {
        /* signalé par startPlayback() */
      }
      if (!dropPayload(event.dataTransfer, true)) {
        showWarning("Ce dépôt ne contient pas de fichier MIDI lisible.");
      }
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Initialisation                                                          */
  /* ---------------------------------------------------------------------- */
  function init() {
    state.player = new window.MidiPlayer();
    state.roll = new window.PianoRoll(els.roll);

    state.player.onStateChange = function (playerState) {
      updateButtons(playerState);
      if (playerState === "ended") {
        showMessage("success", "Fin du fichier : lecture terminée.", true);
      }
    };
    state.player.onTick = function (position, duration) {
      updateProgress(position, duration);
    };

    bindTransport();
    bindFilePicker();
    fillSoundSelect();
    renderOptionIcons();
    renderSpeed(state.player.getSpeed());
    updateButtons("empty");
    updateProgress(0, 0);

    var resizeTimer = null;
    window.addEventListener("resize", function () {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(function () {
        state.roll.resize();
      }, 150);
    });

    loadHealth();
    refreshList();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
