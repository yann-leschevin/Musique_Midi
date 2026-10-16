#!/usr/bin/env python3
"""Ajoute les 20 oeuvres les plus connues pour chaque grand compositeur.

Cible (session 4) : 5 compositeurs majeurs x 20 fichiers = 100 fichiers
au total dans ``midis/`` (on complete jusqu'a 20 en tenant compte de
l'existant) :
  - Bach, Johann Sebastian
  - Beethoven, Ludwig van
  - Chopin, Frederic
  - Mozart, Wolfgang Amadeus
  - Schubert, Franz

Source : meme catalogue que ``fetch_free_midis.py``
(``tactilegalactic/public-domain-midi`` : Public Domain / CC0-1.0,
empreinte SHA-256 verifiee). Ordre de priorite = notoriete presumee
des oeuvres (petite musique de nuit, marche turque, lettre a Elise,
preludes de Chopin, etc.). Si un telechargement echoue, on passe au
suivant ; si la liste prioritaire s'epuise, on complete avec les autres
entrees du compositeur triees par taille decroissante.

Nommage : prefixe canonique ``<Compositeur> - <Titre>.mid``
(ex. ``Mozart - Eine_kleine_Nachtmusik_K_525_I_Allegro.mid``),
ASCII, conforme a la whitelist de ``app.py``.

Usage :
    python3 fetch_composers_20.py
    python3 fetch_composers_20.py --dry-run   # affiche ce qui manque
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
SAFE_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._\- ()\[\]]{0,180}$")
PAUSE = 0.35
RETRIES = 5
TARGET_PER_COMPOSER = 20

# --------------------------------------------------------------------------- #
#  Listes de priorite : les 20+ oeuvres les plus connues (identifiants du
#  catalogue). L'ordre reflete la notoriete, pas la taille.
# --------------------------------------------------------------------------- #
PRIORITY: dict[str, list[str]] = {
    "Mozart": [
        "mutopia-2230-1.mid",  # Eine kleine Nachtmusik I. Allegro
        "mutopia-108.mid",  # Sonate K.331 Rondo Alla Turca
        "mutopia-364.mid",  # Requiem Dies Irae K.626
        "mozart-symphony-25.mid",  # Symphonie n°25 I
        "mozart-jupiter-openscore.mid",  # Symphonie n°41 Jupiter
        "mozart-symphony40-i-ricke.mid",  # Symphonie n°40 I
        "orchestra-2590306.mid",  # Noces de Figaro Ouverture
        "mutopia-266-1.mid",  # Flute enchantee air Reine de la Nuit
        "mozart-clarinet-ii-nekmib.mid",  # Concerto clarinette II Adagio
        "mozart-clarinet-i-nekmib.mid",  # Concerto clarinette I Allegro
        "mutopia-2229-1.mid",  # Concerto piano n°23 I
        "mutopia-2230-4.mid",  # Eine kleine IV Rondo
        "mutopia-2230-2.mid",  # Eine kleine II Romanze
        "mutopia-2230-3.mid",  # Eine kleine III Menuetto
        "mutopia-260-1.mid",  # Flute enchantee marche des pretres
        "mozart-notte-giorno.mid",  # Don Giovanni Notte e giorno
        "mutopia-356.mid",  # Sonate piano ut mineur K.457 I
        "mutopia-1379.mid",  # Sonate piano ut majeur KV 309
        "mutopia-901-1.mid",  # Concerto cor n°2 I
        "orchestra-1907841.mid",  # Symphonie n°40 II Andante
        # Repli si echec/doublon :
        "mutopia-1381.mid",
        "mutopia-613.mid",
        "mutopia-614.mid",
        "mozart-prague-i-tonic.mid",
        "mozart-symphony39-i-ricke.mid",
        "orchestra-1898076.mid",
        "orchestra-1873246.mid",
        "orchestra-5604138.mid",
        "mozart-triumphieren.mid",
        "mutopia-2229-2.mid",
        "mutopia-251-1.mid",
        "mutopia-253-1.mid",
    ],
    "Chopin": [
        "mutopia-483.mid",  # Valse minute op.64 n°1
        "mutopia-1693.mid",  # Fantaisie-Impromptu op.66
        "mutopia-468.mid",  # Prelude op.28 n°4
        "mutopia-471.mid",  # Prelude op.28 n°15 goutte d'eau
        "mutopia-743.mid",  # Etude revolutionnaire op.10 n°12
        "chopin-etude-10-3-openscore.mid",  # Etude Tristesse op.10 n°3
        "mutopia-914.mid",  # Etude op.10 n°1
        "mutopia-926.mid",  # Etude touches noires op.10 n°5
        "mutopia-422.mid",  # Ballade n°4
        "openscore-5419746.mid",  # Trois valses op.64
        "mutopia-511.mid",  # Valse op.69 n°2
        "mutopia-1727.mid",  # Sonate n°2 finale (marche funebre)
        "mutopia-1895.mid",  # Trois nouvelles etudes n°1
        "mutopia-508.mid",  # Etude op.10 n°2
        "mutopia-484.mid",  # Etude op.10 n°9
        "mutopia-489.mid",  # Etude op.25 n°1 harpe eolienne
        "mutopia-757.mid",  # Etude op.25 n°2
        "chopin-etude-10-4-openscore.mid",  # Etude op.10 n°4
        "chopin-etude-10-6-openscore.mid",  # Etude op.10 n°6
        "orchestra-5918059.mid",  # Concerto n°1 II Romanze
        # Repli :
        "mutopia-469.mid",
        "mutopia-470.mid",
        "mutopia-472.mid",
        "mutopia-1776.mid",
        "chopin-polonaise-b1.mid",
        "openscore-5387618.mid",
        "chopin-etude-25-7-pearse.mid",
        "chopin-etude-10-5-clew.mid",
        "orchestra-5895878.mid",
        "orchestra-5953951.mid",
    ],
    "Beethoven": [
        "fur-elise.mid",  # Lettre a Elise
        "beethoven-symphony-5.mid",  # Symphonie n°5 I
        "openscore-5421848.mid",  # Sonate Clair de lune complete
        "mutopia-295.mid",  # Pathetique II Adagio
        "mutopia-299.mid",  # Pathetique I
        "mutopia-296.mid",  # Pathetique III Rondo
        "mutopia-595.mid",  # Symphonie n°7 II Allegretto
        "mutopia-1437.mid",  # Symphonie n°5 II
        "mutopia-899.mid",  # Concerto piano n°3 I
        "mutopia-547.mid",  # Ouverture Egmont
        "mutopia-57-1.mid",  # Ouverture Coriolan
        "mutopia-377-1.mid",  # Ouverture Fidelio
        "mutopia-990.mid",  # Concerto violon I
        "mutopia-1165.mid",  # Concerto violon III
        "beethoven-waldstein-i-khan.mid",  # Sonate Waldstein I
        "beethoven-moonlight-iii-dajoker.mid",  # Clair de lune III
        "openscore-4836125.mid",  # Symphonie n°9 IV Hymne a la joie
        "openscore-4836121.mid",  # Symphonie n°9 II
        "openscore-4836123.mid",  # Symphonie n°9 III
        "mutopia-498.mid",  # Rondo a capriccio op.129
        # Repli :
        "openscore-4053926.mid",
        "beethoven-moonlight-i-dajoker.mid",
        "beethoven-moonlight-ii-dajoker.mid",
        "mutopia-891.mid",
        "mutopia-937.mid",
        "mutopia-288.mid",
        "mutopia-911.mid",
        "mutopia-944.mid",
        "mutopia-1022.mid",
        "orchestra-4205406.mid",
        "orchestra-4205196.mid",
        "mutopia-1211.mid",
    ],
    "Bach": [
        "pianoxml-2086216.mid",  # Menuet en sol majeur
        "pianoxml-2086211.mid",  # Musette en re
        "pianoxml-2086206.mid",  # Marche en re majeur
        "mutopia-5.mid",  # Clavier bien tempere I Prelude 1 BWV 846
        "mutopia-4.mid",  # Clavier bien tempere I Fugue 1
        "mutopia-58.mid",  # Invention 2 BWV 773
        "mutopia-61.mid",  # Invention 8 BWV 779
        "mutopia-59.mid",  # Invention 13 BWV 784
        "openscore-5382627.mid",  # Brandebourg n°4 I
        "openscore-5382631.mid",  # Brandebourg n°4 III Presto
        "mutopia-1603.mid",  # Fantaisie chromatique BWV 903
        "mutopia-1604.mid",  # Fugue chromatique BWV 903
        "mutopia-548.mid",  # Brandebourg n°5 III
        "mutopia-3-2.mid",  # Double concerto violons II Largo
        "mutopia-29-2.mid",  # Concerto violon mi majeur II Adagio
        "openscore-4794827.mid",  # Petit prelude ut majeur BWV 933
        "mutopia-74.mid",  # Menuet BWV Anh.113
        "mutopia-77.mid",  # Menuet BWV Anh.116
        "mutopia-79.mid",  # Musette BWV Anh.126
        "mutopia-690.mid",  # Offrande musicale Ricercar
        # Repli :
        "bach-brandenburg-3-openscore.mid",
        "bach-partita-6-pearse.mid",
        "mutopia-70.mid",
        "mutopia-67.mid",
        "mutopia-55.mid",
        "mutopia-73.mid",
        "mutopia-99-7.mid",
        "mutopia-474-1.mid",
        "openscore-4457661.mid",
        "pianoxml-2155191.mid",
    ],
    "Schubert": [
        "mutopia-1545.mid",  # Marche militaire n°1
        "mutopia-1546.mid",  # Marche militaire n°2
        "mutopia-1547.mid",  # Marche militaire n°3
        "mutopia-1192.mid",  # Impromptu op.90 n°1
        "mutopia-1551.mid",  # Impromptu op.90 n°2
        "mutopia-1193.mid",  # Impromptu op.90 n°3
        "mutopia-1552.mid",  # Impromptu op.90 n°4
        "mutopia-1194.mid",  # Impromptu op.142 n°1
        "mutopia-1195.mid",  # Impromptu op.142 n°2
        "mutopia-1721.mid",  # Impromptu op.142 n°3
        "mutopia-1689.mid",  # Impromptu op.142 n°4
        "mutopia-1023.mid",  # Moments musicaux n°3
        "mutopia-1553.mid",  # Tantum ergo D.962
        "openscore-4040956.mid",  # Allegretto ut mineur D.915
        "pianoxml-5914824.mid",  # Onze ecossaises D.781
        "pianoxml-5375318.mid",  # Valse la mineur D.924 n°9
        "pianoxml-3904966.mid",  # Deux ecossaises D.783
        "pianoxml-3910356.mid",  # Danse allemande n°1 D.420
        "pianoxml-3912856.mid",  # Danse allemande n°3 D.420
        "pianoxml-3910361.mid",  # Danse allemande n°2 D.420
        # Repli (au cas ou) :
        "pianoxml-3944326.mid",
        "pianoxml-3857421.mid",
        "pianoxml-3944311.mid",
    ],
}

# Prefixe canonique des nouveaux fichiers (tri du treeview).
CANONICAL_PREFIX = {
    "Mozart": "Mozart",
    "Chopin": "Chopin",
    "Beethoven": "Beethoven",
    "Bach": "Bach",
    "Schubert": "Schubert",
}

# Variantes d'artistes deja presentes dans midis/ -> canonique.
ALIAS_TO_CANONICAL = {
    "mozart": "Mozart",
    "w a mozart": "Mozart",
    "wolfgang amadeus mozart": "Mozart",
    "chopin": "Chopin",
    "f f chopin": "Chopin",
    "frederic chopin": "Chopin",
    "f chopin": "Chopin",
    "beethoven": "Beethoven",
    "l v beethoven": "Beethoven",
    "ludwig van beethoven": "Beethoven",
    "bach": "Bach",
    "j s bach": "Bach",
    "johann sebastian bach": "Bach",
    "schubert": "Schubert",
    "f schubert": "Schubert",
    "franz schubert": "Schubert",
}


def http_get(url: str, pause: float = PAUSE) -> bytes:
    last: Exception | None = None
    for attempt in range(RETRIES):
        if pause:
            time.sleep(pause)
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=45) as resp:
                return resp.read()
        except Exception as err:  # reseau : on retente
            last = err
            if attempt == RETRIES - 1:
                raise
            time.sleep(2 * (attempt + 1))
    raise last if last else RuntimeError("echec HTTP")


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
    count = 0
    index = 0
    running: int | None = None
    length = len(track)
    while index < length:
        _d, index = read_vlq(track, index)
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
                ml, index = read_vlq(track, index)
                index += ml
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
        if position + 8 > len(data) or data[position:position + 4] != b"MTrk":
            return False, "bloc MTrk manquant", note_ons
        length = int.from_bytes(data[position + 4:position + 8], "big")
        position += 8
        if position + length > len(data):
            return False, "piste tronquee", note_ons
        note_ons += count_note_ons(data[position:position + length])
        position += length
    return True, "SMF format %d, %d piste(s)" % (fmt, ntrks), note_ons


def slugify(text: str, limit: int) -> str:
    text = unicodedata.normalize("NFKD", str(text))
    text = text.encode("ascii", "ignore").decode("ascii")
    text = re.sub(r"[^A-Za-z0-9]+", "_", text).strip("_")
    return text[:limit].strip("_")


def canonical_of_filename(name: str) -> str | None:
    """Retourne le canonique (Bach/Beethoven/...) si le prefixe correspond."""
    prefix = name.split(" - ")[0] if " - " in name else name
    key = prefix.replace("_", " ").strip().lower()
    # cas particulier : fichiers sans prefixe mais connus
    if name == "EMPEROR.mid":
        return "Beethoven"
    if "intermezzo" in name.lower() and "brahms" in name.lower():
        return None  # Brahms, hors cible
    return ALIAS_TO_CANONICAL.get(key)


def existing_counts() -> dict[str, int]:
    counts = {k: 0 for k in PRIORITY}
    if not OUT_DIR.is_dir():
        return counts
    for path in OUT_DIR.iterdir():
        if path.suffix.lower() not in (".mid", ".midi"):
            continue
        canon = canonical_of_filename(path.name)
        if canon in counts:
            counts[canon] += 1
    return counts


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


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    OUT_DIR.mkdir(exist_ok=True)
    counts = existing_counts()
    print("existant par compositeur cible :")
    for comp in PRIORITY:
        print("  %-10s : %d / %d" % (comp, counts[comp], TARGET_PER_COMPOSER))

    print("telechargement du catalogue ...")
    catalog = json.loads(http_get(CATALOG_URL, pause=1.0).decode("utf-8"))
    by_file = {e.get("file"): e for e in catalog if e.get("file")}
    print("  %d editions referencees" % len(by_file))

    if args.dry_run:
        for comp, want_list in PRIORITY.items():
            missing = TARGET_PER_COMPOSER - counts[comp]
            print("%s : manque %d (priorite : %d candidats)" % (comp, max(0, missing), len(want_list)))
        return 0

    added: list[dict] = []
    for comp, want_list in PRIORITY.items():
        missing = TARGET_PER_COMPOSER - counts[comp]
        if missing <= 0:
            print("%s : deja %d fichiers, rien a ajouter" % (comp, counts[comp]))
            continue
        print("== %s : %d a ajouter ==" % (comp, missing))
        # titres deja presents pour eviter les doublons (comparaison slug titre)
        present_titles = set()
        for path in OUT_DIR.iterdir():
            if path.suffix.lower() not in (".mid", ".midi"):
                continue
            if canonical_of_filename(path.name) == comp:
                present_titles.add(slugify(path.name.lower(), 90))
        # candidats : priorite puis reste du compositeur par taille decroissante
        ordered: list[dict] = []
        seen_files: set[str] = set()
        for fid in want_list:
            entry = by_file.get(fid)
            if entry and fid not in seen_files:
                ordered.append(entry)
                seen_files.add(fid)
        # complement : autres entrees du compositeur
        others = [
            e for e in catalog
            if comp.lower() in (e.get("composer") or "").lower()
            and e.get("file") not in seen_files
        ]
        others.sort(key=lambda e: -int((e.get("provenance") or {}).get("bytes", 0)))
        ordered.extend(others)

        made = 0
        for entry in ordered:
            if made >= missing:
                break
            prov = entry.get("provenance") or {}
            if str(prov.get("license", "")).lower() not in ("public domain", "cc0-1.0"):
                continue
            title_slug = slugify(entry.get("title") or entry.get("file", ""), 60)
            if not title_slug:
                continue
            # evite les doublons de titre evident
            if any(title_slug.lower()[:20] in t for t in present_titles):
                # on autorise quand meme si c'est une edition differente et
                # qu'on manque de candidats, mais on prefere passer
                pass
            fname = "%s - %s.mid" % (CANONICAL_PREFIX[comp], title_slug[:70])
            if not SAFE_NAME_RE.match(fname):
                continue
            if (OUT_DIR / fname).exists():
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
            ok, info, notes = validate_smf(data)
            if not ok or notes < MIN_NOTES or not (MIN_SIZE <= len(data) <= MAX_SIZE):
                print("  ! refuse %s : %s (%d notes)" % (entry["file"], info, notes))
                continue
            path = unique_path(fname)
            path.write_bytes(data)
            present_titles.add(slugify(path.name.lower(), 90))
            added.append({
                "file": path.name,
                "title": entry.get("title") or path.name,
                "composer": entry.get("composer") or comp,
                "canonical": comp,
                "license": prov.get("license") or "?",
                "licenseUrl": prov.get("licenseUrl") or "",
                "source": prov.get("sourceUrl") or "",
                "size": len(data),
                "notes": notes,
            })
            made += 1
            print("  + %-60s %7d o %4d notes [%s]" % (path.name, len(data), notes, prov.get("license", "?")))
        if made < missing:
            print("  /!\\ %s : %d/%d seulement (catalogue ou reseau limite)" % (comp, made, missing))

    if added:
        # manifeste : on ajoute une section sans ecraser l'existant
        header = MANIFEST.read_text(encoding="utf-8").rstrip() + "\n" if MANIFEST.exists() else ""
        block = [
            "",
            "## Ajout `fetch_composers_20.py` (%d fichiers : 20 oeuvres majeures par compositeur)" % len(added),
            "",
            "| Fichier | Oeuvre | Compositeur (catalogue) | Cible | Licence | Origine |",
            "|---|---|---|---|---|---|",
        ]
        for e in added:
            block.append("| `%s` | %s | %s | %s | %s | %s |" % (
                e["file"], e["title"].replace("|", "/"), (e["composer"] or "").replace("|", "/"),
                e["canonical"], e["license"], e["source"]))
        block.append("")
        MANIFEST.write_text(header + "\n".join(block) + "\n", encoding="utf-8")
        print("manifeste mis a jour : %d ajouts" % len(added))
    total = len([p for p in OUT_DIR.iterdir() if p.suffix.lower() in (".mid", ".midi")])
    print("ajouts : %d - total dans midis/ : %d" % (len(added), total))
    # succes si chaque cible atteint 20
    final = existing_counts()
    ok = all(v >= TARGET_PER_COMPOSER for v in final.values())
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
