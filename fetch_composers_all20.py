#!/usr/bin/env python3
"""Complete ``midis/`` jusqu'a 20 oeuvres connues pour CHAQUE musicien.

Session 5 : prolonge ``fetch_composers_20.py`` (qui ne couvrait que Bach,
Beethoven, Chopin, Mozart et Schubert) a tous les compositeurs deja
presents dans le treeview, plus quelques grands noms absents (Schumann,
Joplin, Grieg, Mendelssohn, Debussy, Satie, Vivaldi, Haendel, Burgmuller).

Source : meme catalogue Public Domain / CC0
(``tactilegalactic/public-domain-midi``), empreinte SHA-256 verifiee,
SMF format 0/1 avec au moins 20 notes. Les fichiers deja presents (meme
empreinte) ne sont jamais telecharges deux fois.

Ordre : liste de priorite (notoriete presumee), puis le reste du
compositeur dans le catalogue par taille decroissante. Le catalogue ne
contient pas toujours 20 oeuvres : on prend alors tout ce qui existe.

Le comptage de l'existant utilise ``app.artist_info`` : un compositeur
ecrit ``Joseph_Haydn``, ``F_J_Haydn`` ou ``Haydn`` compte pour le meme.

Usage :
    python3 fetch_composers_all20.py --dry-run
    python3 fetch_composers_all20.py
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import urllib.error
import urllib.parse
from pathlib import Path

from app import artist_info
from fetch_composers_20 import (
    CATALOG_URL,
    MAX_SIZE,
    MIN_NOTES,
    MIN_SIZE,
    RAW_BASE,
    SAFE_NAME_RE,
    http_get,
    slugify,
    validate_smf,
)

OUT_DIR = Path(__file__).resolve().parent / "midis"
MANIFEST = OUT_DIR / "SOURCES_MIDI.md"
TARGET = 20

# prefixe de fichier -> (regex sur le champ "composer" du catalogue,
#                         liste de priorite : oeuvres les plus connues d'abord)
TARGETS: dict[str, tuple[str, list[str]]] = {
    "Brahms": (r"brahms", [
        "brahms-lullaby.mid", "mutopia-794.mid", "orchestra-82207.mid",
        "orchestra-113895.mid", "orchestra-91079.mid", "orchestra-81435.mid",
        "mutopia-2164.mid", "mutopia-535.mid",
    ]),
    "Burgmuller": (r"burgm", [
        "mutopia-220.mid", "mutopia-227.mid", "mutopia-202.mid", "mutopia-203.mid",
        "mutopia-218.mid", "mutopia-219.mid", "mutopia-214.mid", "mutopia-215.mid",
        "mutopia-216.mid", "mutopia-217.mid", "mutopia-221.mid", "mutopia-222.mid",
        "mutopia-223.mid", "mutopia-224.mid", "mutopia-225.mid", "mutopia-228.mid",
        "mutopia-229.mid", "mutopia-230.mid", "pianoxml-5502983.mid", "mutopia-972.mid",
    ]),
    "Clementi": (r"clementi", [
        "mutopia-804-1.mid", "mutopia-804-2.mid", "mutopia-804-3.mid",
        "clementi-sonatina-36-1-pianoxml.mid", "clementi-sonatina-36-2-pianoxml.mid",
        "clementi-sonatina-36-3-pianoxml.mid",
    ]),
    "Czerny": (r"czerny", [
        "mutopia-2146.mid", "mutopia-2147.mid", "mutopia-2148.mid", "mutopia-2149.mid",
        "mutopia-2150.mid", "mutopia-2151.mid", "mutopia-2152.mid", "mutopia-2153.mid",
        "mutopia-2154.mid", "mutopia-2177.mid",
    ]),
    "Debussy": (r"debussy", [
        "clair-de-lune.mid", "mutopia-1777.mid", "debussy-bergamasque-1.mid",
        "debussy-bergamasque-2.mid", "debussy-bergamasque-3.mid", "debussy-bergamasque-4.mid",
    ]),
    "Dvorak": (r"dvo", [
        "openscore-5695988.mid", "openscore-5696000.mid",
        "openscore-5651914.mid", "openscore-5651916.mid",
    ]),
    "Grieg": (r"grieg", [
        "mutopia-1888.mid", "mutopia-281.mid", "mutopia-247.mid", "orchestra-5910402.mid",
        "mutopia-781.mid", "mutopia-2014.mid", "orchestra-5344995.mid", "mutopia-246.mid",
        "grieg-puck-71-3-pianoxml.mid", "grieg-elfin-dance-pianoxml.mid",
        "grieg-waltz-12-2-pianoxml.mid", "mutopia-1628.mid", "grieg-larvikspolka.mid",
        "grieg-sailors-song-pianoxml.mid",
    ]),
    "Haendel": (r"handel|h.ndel", [
        "mutopia-459-1.mid", "orchestra-5490700.mid", "orchestra-5477975.mid", "mutopia-98.mid",
    ]),
    "Haydn": (r"haydn", [
        "german-anthem.mid", "mutopia-185.mid", "mutopia-186.mid", "mutopia-187.mid",
        "openscore-5442877.mid", "mutopia-210.mid", "mutopia-211.mid", "mutopia-212.mid",
        "pianoxml-4867475.mid", "pianoxml-4867936.mid",
        "german-anthem-cceh.mid", "german-anthem-bloom.mid",
    ]),
    "Joplin": (r"joplin", [
        "mutopia-263.mid", "mutopia-23.mid", "mutopia-482.mid", "mutopia-463.mid",
        "mutopia-352.mid", "mutopia-1540.mid", "mutopia-1899.mid", "mutopia-275.mid",
        "mutopia-345.mid", "mutopia-335.mid", "mutopia-465.mid", "mutopia-467.mid",
        "mutopia-441.mid", "mutopia-485.mid", "mutopia-496.mid", "mutopia-1541.mid",
        "mutopia-1542.mid", "mutopia-1543.mid", "entertainer-live.mid",
    ]),
    "Liszt": (r"liszt", ["liszt-recueillement.mid", "liszt-weihnachtsbaum-1.mid"]),
    "Mendelssohn": (r"mendelssohn", [
        "mutopia-80-1.mid", "mutopia-1741.mid", "mutopia-592.mid", "mutopia-989.mid",
        "mutopia-1653.mid", "mutopia-1744.mid", "mutopia-589.mid",
        "mutopia-1947-1.mid", "mutopia-1947-2.mid", "mutopia-1947-4.mid",
        "mutopia-1947-5.mid", "mutopia-1947-7.mid", "mutopia-1947-8.mid",
        "mutopia-1947-6.mid", "mutopia-1947-3.mid",
    ]),
    "Pezold": (r"pe[t]?zold", [
        "mutopia-75.mid", "mutopia-76.mid", "pianoxml-2086106.mid", "pianoxml-2086136.mid",
        "pezold-concerto-9.mid", "pezold-suite-g.mid",
    ]),
    "Satie": (r"satie", ["mutopia-37.mid", "mutopia-38.mid", "mutopia-39.mid"]),
    "Schumann": (r"schumann", [
        "mutopia-504.mid", "mutopia-354.mid", "mutopia-372.mid", "schumann-horseman-pianoxml.mid",
        "schumann-farmer-pianoxml.mid", "schumann-soldier-pianoxml.mid", "mutopia-314.mid",
        "schumann-choral-pianoxml.mid",
    ]),
    "Sousa": (r"sousa", [
        "mutopia-626.mid", "mutopia-625.mid", "mutopia-600.mid", "mutopia-634.mid",
        "mutopia-623.mid", "mutopia-624.mid", "mutopia-609.mid", "mutopia-608.mid",
        "mutopia-1410.mid",
    ]),
    "Tchaikovsky": (r"tchaikovsky", [
        "orchestra-5871238.mid", "mutopia-466-1.mid", "mutopia-1806.mid",
        "orchestra-5895897.mid", "mutopia-466-2.mid", "mutopia-466-3.mid",
        "mutopia-1171.mid", "mutopia-1398.mid", "mutopia-803.mid", "mutopia-2032.mid",
        "mutopia-2080.mid", "mutopia-341.mid", "pianoxml-5400397.mid",
    ]),
    "Verdi": (r"verdi", [
        "verdi-donna-mobile.mid", "mutopia-1215.mid", "verdi-aida-triumphal.mid",
        "mutopia-1213.mid", "verdi-sanctus.mid", "verdi-si-la-stanchezza.mid",
        "mutopia-1216.mid", "mutopia-1214.mid", "mutopia-1512.mid", "mutopia-1517.mid",
        "mutopia-1218.mid", "mutopia-1511.mid", "mutopia-1399.mid", "mutopia-1402.mid",
        "mutopia-1513.mid", "mutopia-1514.mid", "mutopia-1515.mid", "mutopia-1516.mid",
        "mutopia-1518.mid", "mutopia-1519.mid", "mutopia-1401.mid", "mutopia-1217.mid",
    ]),
    "Vivaldi": (r"vivaldi", []),
}


def artist_key_of(prefix: str) -> str:
    """Cle canonique (celle du treeview) d'un prefixe de fichier."""
    return artist_info(prefix + " - x.mid")[1]


def existing_state() -> tuple[dict[str, int], set[str]]:
    """Nombre de fichiers par cle d'artiste + empreintes deja presentes."""
    counts: dict[str, int] = {}
    hashes: set[str] = set()
    for path in OUT_DIR.iterdir():
        if path.suffix.lower() not in (".mid", ".midi") or not path.is_file():
            continue
        key = artist_info(path.name)[1]
        counts[key] = counts.get(key, 0) + 1
        hashes.add(hashlib.sha256(path.read_bytes()).hexdigest())
    return counts, hashes


def candidates(catalog: list[dict], pattern: str, priority: list[str]) -> list[dict]:
    by_file = {e.get("file"): e for e in catalog if e.get("file")}
    ordered = [by_file[f] for f in priority if f in by_file]
    seen = {e["file"] for e in ordered}
    rx = re.compile(pattern, re.I)
    others = [
        e for e in catalog
        if e.get("file") not in seen and rx.search(e.get("composer") or "")
    ]
    others.sort(key=lambda e: -int((e.get("provenance") or {}).get("bytes", 0)))
    return ordered + others


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    counts, hashes = existing_state()
    catalog = json.loads(http_get(CATALOG_URL, pause=0.5).decode("utf-8"))
    print("catalogue : %d editions" % len(catalog))

    added: list[dict] = []
    summary: list[tuple[str, int, int, int]] = []
    for prefix, (pattern, priority) in TARGETS.items():
        key = artist_key_of(prefix)
        have = counts.get(key, 0)
        pool = candidates(catalog, pattern, priority)
        missing = max(0, TARGET - have)
        print("== %-12s present %2d, catalogue %2d, manque %2d" % (prefix, have, len(pool), missing))
        if args.dry_run or missing == 0:
            summary.append((prefix, have, have, len(pool)))
            continue
        made = 0
        for entry in pool:
            if made >= missing:
                break
            prov = entry.get("provenance") or {}
            if str(prov.get("license", "")).lower() not in ("public domain", "cc0-1.0"):
                continue
            if prov.get("sha256") in hashes:
                continue  # deja dans midis/ (autre nom)
            title_slug = slugify(entry.get("title") or entry["file"], 70)
            fname = "%s - %s.mid" % (prefix, title_slug)
            if not title_slug or not SAFE_NAME_RE.match(fname) or (OUT_DIR / fname).exists():
                continue
            url = RAW_BASE + "/midi/" + urllib.parse.quote(entry["file"])
            try:
                data = http_get(url)
            except (urllib.error.HTTPError, urllib.error.URLError, OSError) as err:
                print("  ! echec %s : %s" % (entry["file"], err))
                continue
            digest = hashlib.sha256(data).hexdigest()
            if prov.get("sha256") and digest != prov["sha256"]:
                print("  ! empreinte differente : %s" % entry["file"])
                continue
            if digest in hashes:
                continue
            ok, info, notes = validate_smf(data)
            if not ok or notes < MIN_NOTES or not (MIN_SIZE <= len(data) <= MAX_SIZE):
                print("  ! refuse %s : %s (%d notes, %d o)" % (entry["file"], info, notes, len(data)))
                continue
            (OUT_DIR / fname).write_bytes(data)
            hashes.add(digest)
            made += 1
            added.append({
                "file": fname,
                "title": entry.get("title") or fname,
                "composer": entry.get("composer") or prefix,
                "license": prov.get("license") or "?",
                "source": prov.get("sourceUrl") or "",
            })
            print("  + %-70s %7d o %5d notes" % (fname, len(data), notes))
        summary.append((prefix, have, have + made, len(pool)))

    print("\nbilan (avant -> apres / disponibles au catalogue) :")
    for prefix, before, after, pool in summary:
        flag = "" if after >= TARGET else "  (catalogue insuffisant)"
        print("  %-12s %2d -> %2d / %2d%s" % (prefix, before, after, pool, flag))

    if added:
        lines = [
            "",
            "## Ajout `fetch_composers_all20.py` (%d fichiers : jusqu'a 20 oeuvres par musicien)" % len(added),
            "",
            "| Fichier | Oeuvre | Compositeur (catalogue) | Licence | Origine |",
            "|---|---|---|---|---|",
        ]
        for e in added:
            lines.append("| `%s` | %s | %s | %s | %s |" % (
                e["file"], e["title"].replace("|", "/"), e["composer"], e["license"], e["source"]))
        old = MANIFEST.read_text(encoding="utf-8").rstrip() + "\n" if MANIFEST.exists() else ""
        MANIFEST.write_text(old + "\n".join(lines) + "\n", encoding="utf-8")
        print("manifeste mis a jour : %s" % MANIFEST.name)
    return 0


if __name__ == "__main__":
    sys.exit(main())
