#!/usr/bin/env python3
"""Genere deux fichiers MIDI de demonstration dans ``midis/``.

Aucune dependance externe : ecriture baire des octets SMF (format 0).

Usage :
    python3 make_demo_midi.py
"""

from __future__ import annotations

import struct
from pathlib import Path

PPQ = 480
OUT_DIR = Path(__file__).resolve().parent / "midis"


def vlq(value: int) -> bytes:
    """Quantification de temps variable."""
    if value < 0:
        raise ValueError("delta negatif")
    buffer = [value & 0x7F]
    value >>= 7
    while value:
        buffer.append((value & 0x7F) | 0x80)
        value >>= 7
    return bytes(reversed(buffer))


def meta(kind: int, payload: bytes) -> bytes:
    return bytes([0xFF, kind]) + vlq(len(payload)) + payload


def chunk(tag: bytes, data: bytes) -> bytes:
    return tag + struct.pack(">I", len(data)) + data


def build_track(notes, name, program=0, tempo=None, timesig=(4, 4)) -> bytes:
    """notes : sequence (depart_tick, duree_tick, hauteur, velo)."""
    events = []
    events.append((0, 1, meta(0x03, name.encode("latin-1", "replace"))))
    events.append(
        (0, 1, meta(0x58, bytes([timesig[0], (timesig[1].bit_length() - 1), 24, 8])))
    )
    if tempo:
        events.append((0, 1, meta(0x51, int(tempo).to_bytes(3, "big"))))
    events.append((0, 1, bytes([0xC0, program])))

    for start, duration, pitch, velocity in notes:
        start = int(start)
        duration = max(1, int(duration))
        events.append((start, 1, bytes([0x90, pitch, velocity])))
        events.append((start + duration, 0, bytes([0x80, pitch, 64])))

    # les relachements sont prioritaires sur les nouvelles attaques
    events.sort(key=lambda item: (item[0], item[1]))

    data = bytearray()
    previous = 0
    for tick, _order, payload in events:
        data += vlq(tick - previous) + payload
        previous = tick
    data += vlq(0) + meta(0x2F, b"")
    return chunk(b"MTrk", bytes(data))


def build_smf0(track: bytes, ppq=PPQ) -> bytes:
    header = chunk(b"MThd", struct.pack(">HHH", 0, 1, ppq))
    return header + track


def demo_gamme() -> bytes:
    """Gammes de do majeur montantes / descendantes (piano)."""
    scale = [60, 62, 64, 65, 67, 69, 71, 72]
    pitches = scale + scale[-2::-1] + [60]
    notes = []
    step = PPQ // 2
    for index, pitch in enumerate(pitches):
        notes.append((index * step, step, pitch, 92 if index % 2 == 0 else 78))
    notes.append((len(pitches) * step, PPQ * 2, 60, 100))
    notes.append((len(pitches) * step, PPQ * 2, 64, 96))
    notes.append((len(pitches) * step, PPQ * 2, 67, 96))
    notes.append((len(pitches) * step, PPQ * 2, 72, 96))
    return build_smf0(
        build_track(notes, "Demo gamme de Do", program=0, tempo=60000000 // 104)
    )


def demo_accords() -> bytes:
    """Progression I - vi - IV - V avec une melodie simple (20 secondes)."""
    progression = [
        (0x3C, [60, 64, 67], 48),   # Do majeur
        (0x39, [57, 60, 64], 45),   # La mineur
        (0x41, [53, 57, 60], 41),   # Fa majeur
        (0x43, [55, 59, 62], 43),   # Sol majeur
    ]
    melody = [72, 71, 69, 67, 69, 71, 72, 74, 76, 74, 72, 71, 72, 74, 76, 79]
    notes = []
    bar = PPQ * 4
    for bar_index, (_program, chord, bass) in enumerate(progression):
        start = bar_index * bar
        for offset, pitch in enumerate(chord):
            notes.append((start, bar - 10, pitch, 70 + offset * 6))
        notes.append((start, bar // 2 - 10, bass, 88))
        notes.append((start + bar // 2, bar // 2 - 10, bass, 84))

    beat = PPQ
    for index, pitch in enumerate(melody):
        start = bar * 4 + index * beat
        notes.append((start, beat - 30, pitch, 96 if index % 4 == 0 else 84))
    notes.append((bar * 4 + len(melody) * beat, PPQ * 2, 72, 100))
    notes.append((bar * 4 + len(melody) * beat, PPQ * 2, 76, 100))

    return build_smf0(
        build_track(notes, "Demo accords", program=0, tempo=60000000 // 96)
    )


def main() -> None:
    OUT_DIR.mkdir(exist_ok=True)
    targets = {
        "demo_gamme.mid": demo_gamme(),
        "demo_accords.mid": demo_accords(),
    }
    for name, payload in targets.items():
        path = OUT_DIR / name
        path.write_bytes(payload)
        print("ecrit : %s (%d octets)" % (path, len(payload)))


if __name__ == "__main__":
    main()
