#!/usr/bin/env python3
"""Complete le dossier ``midis/`` avec des fichiers MIDI libres de droits.

Toutes les operations se font avec la seule bibliotheque standard Python
(``urllib``, ``json``, ``hashlib``) : aucune dependance n'est installee.

Source : le depot public ``tactilegalactic/public-domain-midi`` (GitHub), qui
publie des editions MIDI inchangees accompagnées, fichier par fichier, d'une
declaration explicite **Public Domain** ou **CC0 1.0**, d'une URL d'origine et
d'une empreinte SHA-256. Chaque telechargement est verifie :

  1. empreinte SHA-256 identique a celle du catalogue (octets d'origine) ;
  2. structure SMF valide (format 0 ou 1, blocs ``MTrk``) ;
  3. au moins 20 notes jouables ;
  4. taille comprise entre 800 octets et 5 Mo.

Les licences et les URLs de provenance sont ecrites dans
``midis/SOURCES_MIDI.md``.

Usage :
    python3 fetch_free_midis.py                 # ajoute 50 fichiers
    python3 fetch_free_midis.py --target 10
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

RAW_BASE = "https://raw.githubusercontent.com/tactilegalactic/public-domain-midi/main"
CATALOG_URL = RAW_BASE + "/catalog.json"
USER_AGENT = "MusiqueMidi-projet/1.0 (script Python educatif, contact local)"

OUT_DIR = Path(__file__).resolve().parent / "midis"
MANIFEST = OUT_DIR / "SOURCES_MIDI.md"

MAX_SIZE = 5 * 1024 * 1024
MIN_SIZE = 800
MIN_NOTES = 20
MAX_PICK_SIZE = 500_000  # on evite les tres gros fichiers de plusieurs Mo
SAFE_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._\- ()\[\]]{0,180}$")
PAUSE = 0.35
RETRIES = 5

# categories voulues et nombre de fichiers par categorie (somme = 50)
SELECTION = [
    ("classical piano", 20),
    ("classical orchestra", 16),
    ("nursery rhyme", 7),
    ("national anthem", 5),
    ("fight song", 2),
]


def http_get(url: str, pause: float = PAUSE) -> bytes:
    """GET avec nouvelle tentative en cas d'erreur transitoire."""
    last: Exception | None = None
    for attempt in range(RETRIES):
        if pause:
            time.sleep(pause)
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=45) as response:
                return response.read()
        except Exception as error:  # noqa: BLE001 - reseau : on retente
            last = error
            if attempt == RETRIES - 1:
                raise
            time.sleep(2 * (attempt + 1))
    raise last if last else RuntimeError("echec HTTP")


# --------------------------------------------------------------------------- #
#  Validation SMF
# --------------------------------------------------------------------------- #
def read_vlq(data: bytes, index: int) -> tuple[int, int]:
    value = 0
    for _ in range(4):
        if index >= len(data):
            return value, index
        byte = data[index]
        index += 1
        value = (value << 7) | (byte & 0x7F)
        if not byte & 0x80:
            break
    return value, index


def count_note_ons(track: bytes) -> int:
    """Compte les ``note on`` valides, statut courant (running status) compris."""
    count = 0
    index = 0
    running: int | None = None
    length = len(track)
    while index < length:
        _delta, index = read_vlq(track, index)
        if index >= length:
            break
        status = track[index]
        if status & 0x80:
            index += 1
            if status in (0xF0, 0xF7):
                skip, index = read_vlq(track, index)
                index += skip
                continue
            if status == 0xFF:
                index += 1
                meta_len, index = read_vlq(track, index)
                index += meta_len
                continue
            if 0xF8 <= status <= 0xFE:
                continue
            running = status
        elif running is None:
            break
        else:
            status = running

        kind = status & 0xF0
        if status >= 0xF0:
            break
        if kind in (0x80, 0x90, 0xA0, 0xB0, 0xE0):
            if index + 1 >= length:
                break
            if kind == 0x90 and track[index + 1] > 0:
                count += 1
            index += 2
        elif kind in (0xC0, 0xD0):
            index += 1
        else:
            break
    return count


def validate_smf(data: bytes) -> tuple[bool, str, int]:
    if len(data) < 14 or data[:4] != b"MThd":
        return False, "en-tete MThd absente", 0
    header_len = int.from_bytes(data[4:8], "big")
    if header_len < 6 or 8 + header_len > len(data):
        return False, "en-tete MThd invalide", 0
    fmt = int.from_bytes(data[8:10], "big")
    ntrks = int.from_bytes(data[10:12], "big")
    division = int.from_bytes(data[12:14], "big")
    if fmt not in (0, 1):
        return False, "format %d (0 ou 1 uniquement)" % fmt, 0
    if ntrks < 1 or division == 0:
        return False, "piste ou division absente", 0
    position = 8 + header_len
    note_ons = 0
    for _ in range(ntrks):
        if position + 8 > len(data) or data[position : position + 4] != b"MTrk":
            return False, "bloc MTrk manquant", note_ons
        length = int.from_bytes(data[position + 4 : position + 8], "big")
        position += 8
        if position + length > len(data):
            return False, "piste tronquee", note_ons
        note_ons += count_note_ons(data[position : position + length])
        position += length
    return True, "SMF format %d, %d piste(s)" % (fmt, ntrks), note_ons


# --------------------------------------------------------------------------- #
#  Noms de fichiers
# --------------------------------------------------------------------------- #
def slugify(text: str, limit: int) -> str:
    text = unicodedata.normalize("NFKD", str(text))
    text = text.encode("ascii", "ignore").decode("ascii")
    text = re.sub(r"[^A-Za-z0-9]+", "_", text).strip("_")
    return text[:limit].strip("_")


def safe_name(entry: dict) -> str:
    """Nom de fichier descriptif, ASCII, conforme a la whitelist de l'app."""
    title = slugify(entry.get("title") or "", 60)
    composer = slugify(entry.get("composer") or "", 32)
    if title and composer and title.lower() != composer.lower():
        base = "%s - %s" % (composer, title)
    else:
        base = title or composer or slugify(entry.get("file", ""), 60)
    base = base[:90]
    return base + ".mid"


def unique_path(name: str) -> Path:
    candidate = OUT_DIR / name
    if not candidate.exists():
        return candidate
    stem = name[:-4]
    for index in range(2, 500):
        candidate = OUT_DIR / ("%s_%d.mid" % (stem, index))
        if not candidate.exists():
            return candidate
    raise RuntimeError("trop de doublons pour %s" % name)


# --------------------------------------------------------------------------- #
#  Selection + telechargement
# --------------------------------------------------------------------------- #
def load_catalog() -> list[dict]:
    data = json.loads(http_get(CATALOG_URL, pause=1.0).decode("utf-8"))
    if not isinstance(data, list):
        raise RuntimeError("catalog.json inattendu")
    return data


def choose(catalog: list[dict], quota: dict, taken: set[str]) -> list[dict]:
    """Un fichier par categorie, du plus grand au plus petit (oeuvres completes)."""
    picked: list[dict] = []
    seen: set[str] = set(taken)
    for category, want in quota.items():
        candidates = [
            entry
            for entry in catalog
            if category in (entry.get("categories") or [])
            and entry.get("file") not in seen
            and (entry.get("provenance") or {}).get("bytes", 0) >= MIN_SIZE
            and (entry.get("provenance") or {}).get("bytes", 0) <= MAX_PICK_SIZE
            and str((entry.get("provenance") or {}).get("license", "")).lower()
            in ("public domain", "cc0-1.0")
        ]
        candidates.sort(
            key=lambda e: -int((e.get("provenance") or {}).get("bytes", 0))
        )
        for entry in candidates[:want]:
            picked.append(entry)
            seen.add(entry.get("file"))
    return picked


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--target", type=int, default=50, help="nombre de fichiers a ajouter"
    )
    args = parser.parse_args()

    OUT_DIR.mkdir(exist_ok=True)
    existing = {
        path.name
        for path in OUT_DIR.iterdir()
        if path.suffix.lower() in (".mid", ".midi")
    }
    print("fichiers deja presents : %d" % len(existing))

    quota: dict[str, int] = {}
    remaining = args.target
    for category, want in SELECTION:
        take = min(want, remaining)
        quota[category] = take
        remaining -= take
    if remaining > 0:
        quota["classical piano"] = quota.get("classical piano", 0) + remaining

    print("telechargement du catalogue ...")
    catalog = load_catalog()
    print("  %d editions referencees" % len(catalog))

    taken: set[str] = set()
    picks = choose(catalog, quota, taken)
    print("  %d candidates retenues" % len(picks))

    added: list[dict] = []
    for entry in picks:
        if len(added) >= args.target:
            break
        prov = entry.get("provenance") or {}
        name = safe_name(entry)
        if not SAFE_NAME_RE.match(name):
            print("  ! nom non sur : %s" % name)
            continue
        url = RAW_BASE + "/midi/" + urllib.parse.quote(entry["file"])
        try:
            data = http_get(url)
        except (urllib.error.HTTPError, urllib.error.URLError, OSError) as error:
            print("  ! echec %s : %s" % (entry["file"], error))
            continue

        digest = hashlib.sha256(data).hexdigest()
        if prov.get("sha256") and digest != prov["sha256"]:
            print("  ! empreinte differente, fichier ignore : %s" % entry["file"])
            continue

        ok, info, notes = validate_smf(data)
        if not ok:
            print("  ! refuse (%s) : %s" % (entry["file"], info))
            continue
        if notes < MIN_NOTES:
            print("  ! refuse (%s) : %d notes" % (entry["file"], notes))
            continue

        path = unique_path(name)
        path.write_bytes(data)
        added.append(
            {
                "file": path.name,
                "title": entry.get("title") or path.name,
                "composer": entry.get("composer") or "",
                "license": prov.get("license") or "inconnue",
                "licenseUrl": prov.get("licenseUrl") or "",
                "source": prov.get("sourceUrl") or "",
                "provider": prov.get("provider") or "",
                "sha256": digest,
                "size": len(data),
                "notes": notes,
                "info": info,
            }
        )
        print(
            "  + %-58s %7d o  %4d notes  [%s]"
            % (path.name, len(data), notes, prov.get("license", "?"))
        )

    if added:
        write_manifest(added)
    print("ajouts : %d — total dans midis/ : %d" % (len(added), len(existing) + len(added)))
    return 0 if len(added) >= args.target else 1


def write_manifest(entries: list[dict]) -> None:
    header = ""
    if MANIFEST.exists():
        header = MANIFEST.read_text(encoding="utf-8").rstrip() + "\n"
    if not header:
        header = (
            "# Provenance des fichiers MIDI de `midis/`\n\n"
            "Chaque fichier de ce dossier est libre de droits : domaine public "
            "ou CC0 1.0, declaration enregistree fichier par fichier.\n"
        )
    block = [
        "",
        "## Ajout `fetch_free_midis.py` (%d fichiers)" % len(entries),
        "",
        "| Fichier | Œuvre | Compositeur | Licence | Origine |",
        "|---|---|---|---|---|",
    ]
    for entry in entries:
        block.append(
            "| `%s` | %s | %s | [%s](%s) | %s |"
            % (
                entry["file"],
                entry["title"].replace("|", "/"),
                entry["composer"].replace("|", "/") or "—",
                entry["license"],
                entry["licenseUrl"] or "#",
                entry["source"] or entry["provider"],
            )
        )
    block.append("")
    block.append(
        "Empreintes SHA-256 et preuves de licence : voir le catalogue d'origine "
        "(`catalog.json` du depot `tactilegalactic/public-domain-midi`)."
    )
    block.append("")
    MANIFEST.write_text(header + "\n".join(block) + "\n", encoding="utf-8")
    print("manifeste mis a jour : %s" % MANIFEST.name)


if __name__ == "__main__":
    sys.exit(main())
