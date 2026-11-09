/**
 * midi-parser.js — Analyseur de fichiers MIDI Standard (SMF) écrit à la main.
 *
 * Sous-ensemble pris en charge (documenté dans l'interface) :
 *   - SMF format 0 et format 1 (le format 2 est rejeté avec un message clair)
 *   - en-tête MThd, pistes MTrk, temps variables (VLQ), statut courant
 *   - méta-événements : tempo (0x51), signature de mesure (0x58), nom de piste
 *     (0x03), fin de piste (0x2F), texte / copyright / marqueurs
 *   - événements de canal : note on/off (vitesse 0 = note off), contrôle,
 *     programme, pression, courbe de pitch
 *   - division temporelle en pulses par quart de temps OU en SMPTE
 *   - carte de tempo complète → conversion ticks → secondes
 *
 * Non pris en charge : format 2, sysex (ignorés), événements système /
 * temps réel (ignorés), instrumentation réaliste.
 */
(function (global) {
  "use strict";

  var DEFAULT_TEMPO = 500000; // µs par quart de temps (120 BPM)

  function MidiError(message) {
    var error = new Error(message);
    error.name = "MidiError";
    return error;
  }

  /* ---------------------------------------------------------------------- */
  /* Lecteur binaire                                                         */
  /* ---------------------------------------------------------------------- */
  function Reader(buffer, pos, limit) {
    if (!(buffer instanceof ArrayBuffer)) {
      throw MidiError("Données invalides : un tableau d'octets est attendu.");
    }
    this.buffer = buffer;
    this.view = new DataView(buffer);
    this.bytes = new Uint8Array(buffer);
    this.pos = pos || 0;
    this.limit = typeof limit === "number" ? limit : buffer.byteLength;
  }

  Reader.prototype.remaining = function () {
    return this.limit - this.pos;
  };

  Reader.prototype.need = function (n) {
    if (this.pos + n > this.limit) {
      throw MidiError("Fichier tronqué ou corrompu (données manquantes).");
    }
  };

  Reader.prototype.u8 = function () {
    this.need(1);
    return this.view.getUint8(this.pos++);
  };

  Reader.prototype.u16 = function () {
    this.need(2);
    var value = this.view.getUint16(this.pos);
    this.pos += 2;
    return value;
  };

  Reader.prototype.u32 = function () {
    this.need(4);
    var value = this.view.getUint32(this.pos);
    this.pos += 4;
    return value;
  };

  Reader.prototype.ascii = function (count) {
    this.need(count);
    var out = "";
    for (var i = 0; i < count; i++) {
      out += String.fromCharCode(this.bytes[this.pos++]);
    }
    return out;
  };

  Reader.prototype.bytesOf = function (count) {
    this.need(count);
    var slice = this.bytes.subarray(this.pos, this.pos + count);
    this.pos += count;
    return slice;
  };

  Reader.prototype.skip = function (count) {
    this.need(count);
    this.pos += count;
  };

  /** Quantification de temps variable (0 à 4 octets). */
  Reader.prototype.vlq = function () {
    var value = 0;
    for (var i = 0; i < 4; i++) {
      var byte = this.u8();
      value = value * 128 + (byte & 0x7f);
      if ((byte & 0x80) === 0) {
        return value;
      }
    }
    throw MidiError("Temps variable invalide (plus de 4 octets).");
  };

  /* ---------------------------------------------------------------------- */
  /* Utilitaires                                                             */
  /* ---------------------------------------------------------------------- */
  function decodeText(bytes) {
    var out = "";
    for (var i = 0; i < bytes.length; i++) {
      var code = bytes[i];
      if (code === 0) {
        continue;
      }
      out += String.fromCharCode(code);
    }
    return out;
  }

  function dataByte(reader, first) {
    var value = typeof first === "number" ? first : reader.u8();
    if (value >= 0x80) {
      throw MidiError("Octet de données hors limite (fichier MIDI invalide).");
    }
    return value;
  }

  /* ---------------------------------------------------------------------- */
  /* Analyse d'une piste                                                     */
  /* ---------------------------------------------------------------------- */
  function parseTrack(reader, trackIndex, trackLength) {
    var end = reader.pos + trackLength;
    var sub = new Reader(reader.buffer, reader.pos, end);

    var tick = 0;
    var maxTick = 0;
    var running = null;
    var notes = [];
    var openNotes = [];
    var tempoEvents = [];
    var trackName = null;
    var instrumentName = null;
    var timeSignatures = [];
    var programs = [];
    var warnings = [];
    var openCount = 0;
    var endOfTrack = false;
    var ignoreFirst = null; // octet déjà lu lors d'un statut courant

    function closeNote(key, offTick) {
      for (var i = 0; i < openNotes.length; i++) {
        if (openNotes[i].key === key) {
          var opened = openNotes.splice(i, 1)[0];
          if (offTick > opened.tick) {
            notes.push({
              tick: opened.tick,
              end: offTick,
              note: opened.note,
              vel: opened.vel,
              channel: opened.channel,
              track: trackIndex
            });
          }
          return;
        }
      }
      // Note off sans note on correspondante : ignorée (non bloquante).
    }

    while (sub.pos < sub.limit) {
      tick += sub.vlq();
      if (tick > maxTick) {
        maxTick = tick;
      }

      var status;
      if (ignoreFirst !== null) {
        status = running;
        if (status === null) {
          throw MidiError("Statut courant absent (fichier MIDI invalide).");
        }
      } else {
        var peek = sub.u8();
        if (peek < 0x80) {
          if (running === null) {
            throw MidiError("Octet de statut manquant (fichier MIDI invalide).");
          }
          status = running;
          ignoreFirst = peek;
        } else {
          status = peek;
          if (status < 0xf0) {
            running = status;
          } else if (status === 0xff || status === 0xf0 || status === 0xf7) {
            running = null; // méta et sysex effacent le statut courant
          }
        }
      }

      if (status === 0xff) {
        // ---- méta-événement -------------------------------------------
        var metaType = sub.u8();
        var metaLen = sub.vlq();
        var metaEnd = sub.pos + metaLen;
        if (metaEnd > end) {
          throw MidiError("Méta-événement trop long (fichier corrompu).");
        }

        if (metaType === 0x2f) {
          endOfTrack = true;
          if (metaLen !== 0) {
            warnings.push("Méta fin de piste de longueur inattendue.");
          }
          sub.pos = metaEnd;
          break;
        } else if (metaType === 0x51) {
          if (metaLen !== 3) {
            throw MidiError("Événement de tempo invalide (3 octets attendus).");
          }
          var tempo =
            (sub.u8() << 16) | (sub.u8() << 8) | sub.u8();
          if (tempo > 0) {
            tempoEvents.push({ tick: tick, tempo: tempo });
          } else {
            warnings.push("Tempo nul ignoré.");
          }
          sub.pos = metaEnd;
        } else if (metaType === 0x58) {
          if (metaLen >= 2) {
            var numerator = sub.u8();
            var denominator = 1 << sub.u8();
            timeSignatures.push({ tick: tick, numerator: numerator, denominator: denominator });
          }
          sub.pos = metaEnd;
        } else if (metaType === 0x03) {
          trackName = decodeText(sub.bytesOf(metaLen)).trim();
          sub.pos = metaEnd;
        } else if (metaType === 0x04) {
          instrumentName = decodeText(sub.bytesOf(metaLen)).trim();
          sub.pos = metaEnd;
        } else {
          // Texte, copyright, paroles, marqueurs, curseur, copie système… : conservés à part.
          if (metaLen > 0 && metaType <= 0x07) {
            var textValue = decodeText(sub.bytesOf(metaLen)).trim();
            if (textValue && !trackName && metaType === 0x01) {
              trackName = textValue;
            }
          } else if (metaType === 0x59 || metaType === 0x54 || metaType === 0x55) {
            sub.skip(metaLen); // tonalité, offset SMPTE, tempo nommé : ignorés
          } else {
            sub.skip(metaLen);
          }
          sub.pos = metaEnd;
        }
        ignoreFirst = null;
        continue;
      }

      if (status === 0xf0 || status === 0xf7) {
        // ---- sysex : ignoré (limitation documentée) ---------------------
        var sysLen = sub.vlq();
        sub.skip(sysLen);
        ignoreFirst = null;
        continue;
      }

      if (status >= 0xf1 && status <= 0xfe) {
        // ---- messages système dans une piste SMF : rares, ignorés --------
        var systemSizes = { 0xf1: 1, 0xf2: 2, 0xf3: 1, 0xf6: 0, 0xf8: 0, 0xf9: 0, 0xfa: 0, 0xfb: 0, 0xfc: 0, 0xfd: 0, 0xfe: 0 };
        var size = systemSizes[status];
        if (size === undefined) {
          throw MidiError("Message système inconnu 0x" + status.toString(16) + ".");
        }
        sub.skip(size);
        ignoreFirst = null;
        continue;
      }

      // ---- message de canal ---------------------------------------------
      var kind = status & 0xf0;
      var channel = status & 0x0f;
      var firstData = ignoreFirst;
      ignoreFirst = null;

      if (kind === 0xc0) {
        var program = dataByte(sub, firstData);
        programs.push({ channel: channel, program: program, tick: tick, track: trackIndex });
        continue;
      }
      if (kind === 0xd0) {
        dataByte(sub, firstData); // pression de canal : ignorée
        continue;
      }

      var noteOrControl = dataByte(sub, firstData);
      var value = dataByte(sub, null);

      if (kind === 0x90) {
        if (value > 0) {
          openCount++;
          openNotes.push({
            tick: tick,
            key: channel * 128 + noteOrControl,
            note: noteOrControl,
            vel: value,
            channel: channel
          });
        } else {
          closeNote(channel * 128 + noteOrControl, tick);
        }
      } else if (kind === 0x80) {
        closeNote(channel * 128 + noteOrControl, tick);
      }
      // 0xA0 (pression poly), 0xB0 (contrôle), 0xE0 (courbe de pitch) :
      // lus et ignorés (le contrôle 64 (pédale) n'est pas géré : limite).
    }

    // Fermeture des notes encore ouvertes à la fin de la piste.
    if (openNotes.length > 0) {
      warnings.push(
        openNotes.length +
          " note(s) non refermée(s) dans la piste " +
          (trackIndex + 1) +
          " : durée limitée à la fin de la piste."
      );
      for (var i = 0; i < openNotes.length; i++) {
        var opened = openNotes[i];
        notes.push({
          tick: opened.tick,
          end: Math.max(opened.tick, maxTick),
          note: opened.note,
          vel: opened.vel,
          channel: opened.channel,
          track: trackIndex
        });
      }
      openNotes = [];
    }

    if (!endOfTrack) {
      warnings.push("Piste " + (trackIndex + 1) + " sans événement de fin de piste (0x2F).");
    }

    reader.pos = end; // on se replace exactement à la fin du chunk

    return {
      notes: notes,
      tempoEvents: tempoEvents,
      trackName: trackName,
      instrumentName: instrumentName,
      timeSignatures: timeSignatures,
      programs: programs,
      maxTick: maxTick,
      warnings: warnings,
      openCount: openCount
    };
  }

  /* ---------------------------------------------------------------------- */
  /* Carte de tempo : ticks → secondes                                       */
  /* ---------------------------------------------------------------------- */
  function buildTickToSeconds(tempoEvents, division) {
    if (division.type === "smpte") {
      var ticksPerSecond = division.ticksPerSecond;
      return function (tick) {
        return tick / ticksPerSecond;
      };
    }

    var ppq = division.ppq;
    var sorted = tempoEvents.slice().sort(function (a, b) {
      return a.tick - b.tick;
    });

    var segments = [{ tick: 0, sec: 0, tempo: DEFAULT_TEMPO }];
    var curTick = 0;
    var curSec = 0;
    var curTempo = DEFAULT_TEMPO;

    for (var i = 0; i < sorted.length; i++) {
      var event = sorted[i];
      if (event.tick > curTick) {
        curSec += ((event.tick - curTick) * curTempo) / (ppq * 1e6);
        curTick = event.tick;
        segments.push({ tick: curTick, sec: curSec, tempo: event.tempo });
        curTempo = event.tempo;
      } else if (event.tick === curTick) {
        segments[segments.length - 1].tempo = event.tempo;
        curTempo = event.tempo;
      }
      // tick déjà passé : ignoré
    }

    return function tickToSec(tick) {
      if (tick <= 0) {
        return 0;
      }
      var low = 0;
      var high = segments.length - 1;
      var index = 0;
      while (low <= high) {
        var mid = (low + high) >> 1;
        if (segments[mid].tick <= tick) {
          index = mid;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }
      var segment = segments[index];
      return segment.sec + ((tick - segment.tick) * segment.tempo) / (ppq * 1e6);
    };
  }

  /* ---------------------------------------------------------------------- */
  /* Analyse du fichier complet                                              */
  /* ---------------------------------------------------------------------- */
  function parseMidiFile(arrayBuffer) {
    var reader = new Reader(arrayBuffer);

    if (reader.remaining() < 14) {
      throw MidiError("Fichier trop court pour être un fichier MIDI.");
    }

    var magic = reader.ascii(4);
    if (magic !== "MThd") {
      throw MidiError(
        "En-tête MThd absent : ce n'est pas un fichier MIDI Standard valide."
      );
    }

    var headerLength = reader.u32();
    if (headerLength < 6) {
      throw MidiError("Longueur d'en-tête MThd invalide.");
    }

    var format = reader.u16();
    var declaredTracks = reader.u16();
    var divisionRaw = reader.u16();

    if (headerLength > 6) {
      reader.skip(headerLength - 6);
    }

    if (format > 2) {
      throw MidiError("Format MIDI " + format + " inconnu ou non standard.");
    }
    if (format === 2) {
      throw MidiError(
        "Format MIDI 2 non pris en charge : seule la lecture des formats 0 et 1 est implémentée."
      );
    }
    if (declaredTracks < 1) {
      throw MidiError("Aucune piste déclarée dans l'en-tête.");
    }
    if (divisionRaw === 0) {
      throw MidiError("Division temporelle nulle (fichier invalide).");
    }

    var division;
    if (divisionRaw & 0x8000) {
      var fpsByte = (divisionRaw >> 8) & 0xff;
      var signed = fpsByte > 127 ? fpsByte - 256 : fpsByte;
      var framesPerSecond = -signed;
      var ticksPerFrame = divisionRaw & 0xff;
      if (framesPerSecond <= 0 || ticksPerFrame <= 0) {
        throw MidiError("Division SMPTE invalide.");
      }
      division = {
        type: "smpte",
        fps: framesPerSecond,
        ticksPerFrame: ticksPerFrame,
        ticksPerSecond: framesPerSecond * ticksPerFrame,
        label:
          "SMPTE " + framesPerSecond + " i/s, " + ticksPerFrame + " ticks/image"
      };
    } else {
      division = { type: "ppq", ppq: divisionRaw, label: divisionRaw + " ticks / quart de temps" };
    }

    var notes = [];
    var tempoEvents = [];
    var timeSignatures = [];
    var programs = [];
    var warnings = [];
    var tracksMeta = [];
    var maxTick = 0;
    var trackCount = 0;

    while (trackCount < declaredTracks) {
      if (reader.remaining() < 8) {
        warnings.push(
          "Le fichier contient moins de pistes que déclaré dans l'en-tête."
        );
        break;
      }
      var tag = reader.ascii(4);
      var chunkLength = reader.u32();

      if (tag !== "MTrk") {
        warnings.push("Chunk inconnu « " + tag + " » ignoré (attendu : MTrk).");
        if (chunkLength > reader.remaining()) {
          throw MidiError("Longueur de chunk invalide (fichier corrompu).");
        }
        reader.skip(chunkLength);
        continue;
      }
      if (chunkLength > reader.remaining()) {
        throw MidiError("Piste MTrk tronquée (fichier incomplet ou corrompu).");
      }

      var result = parseTrack(reader, trackCount, chunkLength);
      trackCount++;

      for (var n = 0; n < result.notes.length; n++) {
        notes.push(result.notes[n]);
      }
      for (var t = 0; t < result.tempoEvents.length; t++) {
        tempoEvents.push(result.tempoEvents[t]);
      }
      for (var ts = 0; ts < result.timeSignatures.length; ts++) {
        timeSignatures.push(result.timeSignatures[ts]);
      }
      for (var p = 0; p < result.programs.length; p++) {
        programs.push(result.programs[p]);
      }
      for (var w = 0; w < result.warnings.length; w++) {
        warnings.push(result.warnings[w]);
      }
      if (result.maxTick > maxTick) {
        maxTick = result.maxTick;
      }

      var noteCount = result.notes.length;
      var name = result.trackName || result.instrumentName || null;
      tracksMeta.push({
        index: trackCount,
        name: name,
        noteCount: noteCount,
        hasTempo: result.tempoEvents.length > 0
      });
      if (!name && noteCount === 0 && tempoEvents.length > 0 && trackCount === 1) {
        // piste technique (tempo uniquement) : rien à afficher de plus
      }
    }

    if (trackCount === 0) {
      throw MidiError("Aucune piste MTrk trouvée dans le fichier.");
    }

    var tickToSec = buildTickToSeconds(tempoEvents, division);

    var timedNotes = [];
    for (var i = 0; i < notes.length; i++) {
      var note = notes[i];
      var start = tickToSec(note.tick);
      var stop = tickToSec(note.end);
      if (stop < start) {
        stop = start;
      }
      timedNotes.push({
        t: start,
        d: stop - start,
        n: note.note,
        v: note.vel,
        c: note.channel,
        k: note.track
      });
    }
    timedNotes.sort(function (a, b) {
      return a.t - b.t || a.n - b.n;
    });

    var duration = tickToSec(maxTick);
    if (timedNotes.length > 0) {
      var last = timedNotes[timedNotes.length - 1];
      duration = Math.max(duration, last.t + last.d);
    }
    if (duration <= 0) {
      throw MidiError(
        "Durée nulle : le fichier ne contient aucune note jouable (ou uniquement des métadonnées)."
      );
    }

    if (timedNotes.length === 0) {
      warnings.push("Aucune note détectée : rien ne sera joué.");
    }
    if (timedNotes.length > 30000) {
      warnings.push(
        "Nombre de notes très élevé (" +
          timedNotes.length +
          ") : la synthèse Web Audio peut être bridée par le navigateur."
      );
    }
    if (duration > 3600) {
      warnings.push("Fichier d'une durée supérieure à une heure.");
    }
    if (division.type === "smpte") {
      warnings.push(
        "Division SMPTE : les changements de tempo sont ignorés (durée en temps réel)."
      );
    }

    var tempos = [];
    var sortedTempos = tempoEvents.slice().sort(function (a, b) {
      return a.tick - b.tick;
    });
    for (var e = 0; e < sortedTempos.length && e < 24; e++) {
      tempos.push({
        t: tickToSec(sortedTempos[e].tick),
        bpm: Math.round(60000000 / sortedTempos[e].tempo)
      });
    }
    if (tempos.length === 0) {
      tempos.push({ t: 0, bpm: 120 });
    }

    var channels = {};
    for (var c = 0; c < timedNotes.length; c++) {
      channels[timedNotes[c].c] = true;
    }
    var channelList = Object.keys(channels).map(Number).sort(function (a, b) {
      return a - b;
    });

    var title = null;
    for (var tr = 0; tr < tracksMeta.length; tr++) {
      if (tracksMeta[tr].name) {
        title = tracksMeta[tr].name;
        break;
      }
    }

    return {
      format: format,
      declaredTracks: declaredTracks,
      parsedTracks: trackCount,
      division: division,
      duration: duration,
      notes: timedNotes,
      totalNotes: timedNotes.length,
      tracks: tracksMeta,
      tempos: tempos,
      tempoEvents: tempoEvents.length,
      timeSignatures: timeSignatures,
      programs: programs,
      channels: channelList,
      warnings: warnings,
      title: title
    };
  }

  global.MidiFile = {
    parse: parseMidiFile,
    MidiError: MidiError
  };
})(typeof window !== "undefined" ? window : this);
