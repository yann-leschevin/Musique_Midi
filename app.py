#!/usr/bin/env python3
"""Lecteur de fichiers MIDI — serveur Flask.

L'application est ecrite pour Flask. Si Flask n'est pas installe sur le
systeme (installation interdite dans ce projet), elle bascule automatiquement
sur ``flask_fallback``, une couche de compatibilite fournie ici et basee sur
la seule bibliotheque standard Python (``wsgiref``).

Routes :
    GET  /                     page d'interface
    GET  /api/health           etat du serveur
    GET  /api/midis            liste des fichiers du dossier ``midis/``
    GET  /api/midi/<nom>       envoi (sobre) d'un fichier MIDI
    POST /api/upload           envoi d'un fichier MIDI (corps brut)
"""

from __future__ import annotations

import html
import os
import re
import unicodedata
from pathlib import Path

try:  # Flask si disponible (usage normal)
    from flask import (  # type: ignore
        Flask,
        Response,
        abort,
        jsonify,
        render_template,
        request,
    )

    FLASK_BACKEND = "flask"
except ModuleNotFoundError:  # sinon : couche de compatibilite fournie
    from flask_fallback import (  # type: ignore
        Flask,
        Response,
        abort,
        jsonify,
        render_template,
        request,
    )

    FLASK_BACKEND = "flask_fallback"

BASE_DIR = Path(__file__).resolve().parent
MIDI_DIR = BASE_DIR / "midis"

MAX_MIDI_SIZE = 5 * 1024 * 1024  # 5 Mo par fichier
ALLOWED_EXTENSIONS = (".mid", ".midi")
SAFE_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._\- ()\[\]]{0,180}$")

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_MIDI_SIZE  # garde-fou Flask

MIDI_DIR.mkdir(exist_ok=True)  # cree le dossier de stockage s'il manque


# --------------------------------------------------------------------------- #
#  Securite des noms de fichiers
# --------------------------------------------------------------------------- #
def sanitize_filename(raw_name: object) -> str | None:
    """Retourne un nom de fichier sur, ou ``None`` si le nom est rejete.

    Rejette : vide, chemin (``/`` ``\\``), ``..``, octet nul, longueur
    excessive, caractere hors whitelist, extension non autorisee.
    """
    if not isinstance(raw_name, str):
        return None
    name = raw_name.strip()
    if not name or len(name) > 200:
        return None
    if "\x00" in name or "/" in name or "\\" in name:
        return None
    if name in (".", "..") or ".." in name:
        return None
    if not SAFE_NAME_RE.match(name):
        return None
    if not name.lower().endswith(ALLOWED_EXTENSIONS):
        return None
    return name


def midi_path_for(name: str) -> Path | None:
    """Resout un nom de fichier dans ``midis/`` en interdisant la traversal."""
    safe = sanitize_filename(name)
    if safe is None:
        return None
    base = MIDI_DIR.resolve()
    target = (base / safe).resolve()  # suit les liens symboliques
    if target.parent != base:  # fuite hors du dossier interdite
        return None
    return target


def validate_midi_bytes(data: bytes) -> tuple[bool, str]:
    """Validation structurelle minimale d'un fichier MIDI Standard (SMF).

    Verifie l'en-tete ``MThd``, le format (0 ou 1 uniquement), le nombre de
    pistes, la division temporelle et la presence des blocs ``MTrk``.
    """
    if len(data) < 14:
        return False, "fichier trop court pour être un MIDI"
    if data[:4] != b"MThd":
        return False, "en-tête MThd absent (ce n'est pas un fichier MIDI)"
    header_len = int.from_bytes(data[4:8], "big")
    if header_len < 6 or 8 + header_len > len(data):
        return False, "longueur d'en-tête MThd invalide"
    fmt = int.from_bytes(data[8:10], "big")
    ntrks = int.from_bytes(data[10:12], "big")
    division = int.from_bytes(data[12:14], "big")
    if fmt not in (0, 1):
        return False, "format MIDI %d non pris en charge (formats 0 et 1 uniquement)" % fmt
    if ntrks < 1:
        return False, "aucune piste déclarée"
    if division == 0:
        return False, "division temporelle nulle"
    position = 8 + header_len
    seen = 0
    while seen < ntrks:
        if position + 8 > len(data):
            return False, "bloc de piste MTrk manquant"
        if data[position:position + 4] != b"MTrk":
            return False, "bloc de piste MTrk manquant (chunk inconnu)"
        length = int.from_bytes(data[position + 4:position + 8], "big")
        position += 8
        if position + length > len(data):
            return False, "longueur de piste dépassée (fichier tronqué ?)"
        position += length
        seen += 1
    return True, "SMF format %d, %d piste(s)" % (fmt, ntrks)


# --------------------------------------------------------------------------- #
#  Classement par artiste (treeview de la colonne de gauche)
# --------------------------------------------------------------------------- #
# Nom canonique d'affichage ("Nom, Prenom") -> variantes rencontrees dans
# ``midis/`` (prefixe avant " - ", underscores remplaces par des espaces,
# minuscules). Le tri se fait sur le NOM DE FAMILLE (Bach, Beethoven,
# Chopin, Mozart...), sans accents.
ARTIST_CANONICAL = {
    "Bach, Johann Sebastian": ["bach", "j s bach", "johann sebastian bach"],
    "Bach, Johann Michael": ["j m bach", "johann michael bach"],
    "Beethoven, Ludwig van": ["beethoven", "l v beethoven", "ludwig van beethoven"],
    "Brahms, Johannes": ["brahms", "j brahms", "johannes brahms"],
    "Burgmüller, Friedrich": ["burgmuller", "j f f burgmuller", "friedrich burgmuller"],
    "Chopin, Frédéric": ["chopin", "f f chopin", "f chopin", "frederic chopin"],
    "Clementi, Muzio": ["clementi", "m clementi", "muzio clementi"],
    "Czerny, Carl": ["czerny", "c czerny", "carl czerny"],
    "Debussy, Claude": ["debussy", "claude debussy"],
    "Dvořák, Antonín": ["dvorak", "antonin dvorak"],
    "Grieg, Edvard": ["grieg", "e grieg", "edvard grieg"],
    "Haendel, Georg Friedrich": ["handel", "haendel", "g f handel", "george frideric handel"],
    "Haydn, Joseph": ["haydn", "f j haydn", "joseph haydn"],
    "Joplin, Scott": ["joplin", "s joplin", "scott joplin"],
    "Lefébure-Wély, Louis James Alfred": ["louis james alfred lefebure wely", "lefebure wely"],
    "Liszt, Franz": ["liszt", "f liszt", "franz liszt", "franz liszt after the traditiona"],
    "Mendelssohn, Felix": ["mendelssohn", "f mendelssohn bartholdy", "felix mendelssohn"],
    "Mozart, Wolfgang Amadeus": ["mozart", "w a mozart", "wolfgang amadeus mozart"],
    "Pezold, Christian": ["pezold", "petzold", "christian pezold", "christian petzold"],
    "Satie, Erik": ["satie", "e satie", "erik satie"],
    "Schubert, Franz": ["schubert", "f schubert", "franz schubert"],
    "Schumann, Robert": ["schumann", "r schumann", "robert schumann"],
    "Sousa, John Philip": ["sousa", "j p sousa", "john philip sousa"],
    "Tchaïkovski, Piotr Ilitch": ["tchaikovsky", "p i tchaikovsky", "pyotr ilyich tchaikovsky"],
    "Verdi, Giuseppe": ["verdi", "g verdi", "giuseppe verdi"],
    "Vivaldi, Antonio": ["vivaldi", "antonio vivaldi"],
}

# Noms traditionnels : "Traditional_French" -> "Traditionnel (français)".
TRADITIONAL_ORIGINS = {
    "brazilian": "brésilien",
    "english": "anglais",
    "french": "français",
    "german": "allemand",
    "jamaican": "jamaïcain",
    "polish": "polonais",
}

NAME_PARTICLES = {"van", "von", "de", "da", "di", "du", "le", "la"}


def _plain(text: str) -> str:
    """Minuscules sans accents (cle de tri / de recherche)."""
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    return " ".join(text.replace("_", " ").replace("-", " ").lower().split())


ARTIST_ALIASES = {}
for _display, _variants in ARTIST_CANONICAL.items():
    for _variant in _variants:
        ARTIST_ALIASES[_plain(_variant)] = (_display, _plain(_display))


def canonical_artist(raw_artist: str) -> tuple[str, str]:
    """Retourne (affichage "Nom, Prenom", cle de tri) pour un prefixe brut."""
    key = _plain(raw_artist)
    if key in ARTIST_ALIASES:
        return ARTIST_ALIASES[key]
    words = raw_artist.replace("_", " ").split()
    if words and words[0].lower() == "traditional":
        origin = " ".join(words[1:])
        origin = TRADITIONAL_ORIGINS.get(origin.lower(), origin)
        display = "Traditionnel (%s)" % origin if origin else "Traditionnel"
        return (display, _plain(display))
    if len(words) <= 1:
        display = words[0] if words else "Divers / Inconnu"
        return (display, _plain(display))
    # "Prenom [particule] Nom" -> "Nom, Prenom [particule]"
    surname_start = len(words) - 1
    while surname_start > 1 and words[surname_start - 1].lower() in NAME_PARTICLES:
        surname_start -= 1
    surname = " ".join(words[surname_start:])
    given = " ".join(words[:surname_start])
    display = "%s, %s" % (surname, given)
    return (display, _plain(display))


def _strip_ext(name: str) -> str:
    for ext in (".midi", ".mid"):
        if name.lower().endswith(ext):
            return name[: -len(ext)]
    return name


def artist_info(filename: str) -> tuple[str, str, str]:
    """Decompose ``<Artiste> - <Titre>.mid`` en (artiste, cle_tri, titre).

    - Variantes (``F_F_Chopin``, ``Ludwig_van_Beethoven``...) normalisees
      via ``ARTIST_CANONICAL`` ; autres noms -> "Nom, Prenom".
    - Fichiers historiques sans prefixe : ``EMPEROR.mid`` -> Beethoven,
      ``Johannes Brahms Op...`` -> Brahms, ``J_M_Bach_...`` -> J. M. Bach.
    - Sinon : ``Démos du projet`` / ``Divers / Inconnu`` (en fin d'arbre).
    """
    stem = _strip_ext(filename)
    if filename == "EMPEROR.mid":
        display, key = ARTIST_ALIASES["beethoven"]
        return (display, key, "Concerto pour piano n° 5 « L'Empereur »")
    if " - " in filename:
        raw_artist, raw_title = stem.split(" - ", 1)
        display, key = canonical_artist(raw_artist)
        title = raw_title.replace("_", " ").strip() or stem
        return (display, key, title)
    lowered = filename.lower()
    if lowered.startswith("johannes brahms"):
        display, key = ARTIST_ALIASES["brahms"]
        return (display, key, stem[len("johannes brahms"):].replace("_", " ").strip() or stem)
    if lowered.startswith("j_m_bach_"):
        display, key = ARTIST_ALIASES["j m bach"]
        return (display, key, stem[len("j_m_bach_"):].replace("_", " ").strip() or stem)
    title = stem.replace("_", " ").strip() or filename
    if filename.startswith("demo_") or filename.startswith("demo "):
        return ("Démos du projet", "zzz demos du projet", title)
    return ("Divers / Inconnu", "zzz divers / inconnu", title)


def list_midi_files() -> list[dict]:
    """Liste blanche des fichiers MIDI, enrichie et triee par artiste.

    Chaque entree contient ``name``/``size``/``modified`` (compatibilite)
    plus ``artist`` (affichage), ``artist_key`` (tri) et ``title``.
    Tri : artiste (A-Z, canoniques d'abord) puis titre (A-Z).
    """
    if not MIDI_DIR.is_dir():
        return []
    entries = []
    try:
        candidates = list(MIDI_DIR.iterdir())
    except OSError:
        return []
    for entry in candidates:
        try:
            if not entry.is_file():
                continue
        except OSError:
            continue
        if sanitize_filename(entry.name) is None:
            continue
        try:
            stat = entry.stat()
        except OSError:
            continue
        artist, artist_key, title = artist_info(entry.name)
        entries.append(
            {
                "name": entry.name,
                "size": stat.st_size,
                "modified": int(stat.st_mtime),
                "artist": artist,
                "artist_key": artist_key,
                "title": title,
            }
        )
    entries.sort(key=lambda e: (e["artist_key"], e["title"].lower(), e["name"].lower()))
    return entries


def group_midi_files(files: list[dict]) -> list[dict]:
    """Regroupe une liste (deja triee) par artiste pour le treeview."""
    groups: list[dict] = []
    current_key: str | None = None
    current: dict | None = None
    for item in files:
        if current is None or item["artist_key"] != current_key:
            current = {"artist": item["artist"], "artist_key": item["artist_key"], "count": 0, "files": []}
            groups.append(current)
            current_key = item["artist_key"]
        current["files"].append(item)
        current["count"] += 1
    return groups


# --------------------------------------------------------------------------- #
#  Gestion des erreurs (JSON pour l'API, page HTML sinon)
# --------------------------------------------------------------------------- #
def _error_response(code: int, description: str | None) -> Response:
    message = description or "Erreur."
    if request.path.startswith("/api/"):
        response = jsonify({"ok": False, "code": code, "error": message})
    else:
        page = (
            "<!doctype html><html lang='fr'><meta charset='utf-8'>"
            "<title>%(code)d</title>"
            "<body style='font-family:system-ui;margin:3rem'>"
            "<h1>%(code)d</h1><p>%(msg)s</p>"
            "<p><a href='/'>Retour a l'application</a></p></body></html>"
        ) % {"code": code, "msg": html.escape(message)}
        response = Response(page, mimetype="text/html; charset=utf-8")
    response.status_code = code
    return response


def _register_error_handlers(flask_app: Flask) -> None:
    for code in (400, 403, 404, 405, 413, 415, 500):
        def factory(status_code: int):
            def handler(exc):
                return _error_response(status_code, getattr(exc, "description", None))

            return handler

        flask_app.errorhandler(code)(factory(code))


_register_error_handlers(app)


# --------------------------------------------------------------------------- #
#  Routes
# --------------------------------------------------------------------------- #
@app.route("/")
def index():
    """Page d'accueil de l'application."""
    return render_template("index.html")


@app.route("/api/health")
def health():
    """Etat du serveur (utilise par l'interface pour afficher le backend)."""
    return jsonify(
        {
            "ok": True,
            "flask_backend": FLASK_BACKEND,
            "max_size": MAX_MIDI_SIZE,
            "allowed_extensions": list(ALLOWED_EXTENSIONS),
            "midi_dir": MIDI_DIR.name,
            "midi_dir_exists": MIDI_DIR.is_dir(),
        }
    )


@app.route("/api/midis")
def api_midis():
    """Liste des fichiers MIDI disponibles dans ``midis/`` (treeview)."""
    if not MIDI_DIR.is_dir():
        return jsonify(
            {
                "ok": True,
                "files": [],
                "groups": [],
                "max_size": MAX_MIDI_SIZE,
                "warning": "Le dossier 'midis/' est introuvable.",
            }
        )
    files = list_midi_files()
    return jsonify(
        {
            "ok": True,
            "files": files,
            "groups": group_midi_files(files),
            "max_size": MAX_MIDI_SIZE,
        }
    )


@app.route("/api/midi/<path:name>")
def api_midi_file(name: str):
    """Envoie un fichier MIDI du dossier ``midis/`` (noms verifies)."""
    path = midi_path_for(name)
    if path is None:
        abort(400, description="Nom de fichier invalide.")
    if not path.is_file():
        abort(404, description="Fichier MIDI introuvable.")
    try:
        size = path.stat().st_size
        if size > MAX_MIDI_SIZE:
            abort(413, description="Fichier trop volumineux (max 5 Mo).")
        data = path.read_bytes()
    except OSError:
        abort(500, description="Lecture du fichier impossible.")
    response = Response(data, mimetype="audio/midi")
    response.headers["Content-Disposition"] = 'inline; filename="%s"' % path.name
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Cache-Control"] = "no-store"
    return response


@app.route("/api/upload", methods=["POST"])
def api_upload():
    """Recoit un fichier MIDI (corps brut + entete ``X-File-Name``).

    L'interface web utilise ``fetch`` avec le ``File`` directement comme corps,
    ce qui evite tout televersement multipart et garde le meme comportement
    avec ou sans Flask installe.
    """
    raw_name = request.headers.get("X-File-Name") or request.args.get("name") or ""
    base_name = str(raw_name).strip()
    if (
        not base_name
        or "/" in base_name
        or "\\" in base_name
        or ".." in base_name
        or "\x00" in base_name
    ):
        abort(
            400,
            description="Nom de fichier dangereux ou vide (chemin interdit).",
        )
    safe = sanitize_filename(base_name)
    if safe is None:
        abort(
            400,
            description="Nom de fichier invalide (extension .mid ou .midi attendue).",
        )

    data = request.get_data()
    if not data:
        abort(400, description="Fichier vide.")
    if len(data) > MAX_MIDI_SIZE:
        abort(413, description="Fichier trop volumineux (max 5 Mo).")

    ok, info = validate_midi_bytes(data)
    if not ok:
        abort(400, description="Fichier MIDI invalide : %s" % info)

    destination = MIDI_DIR / safe
    tmp = MIDI_DIR / (safe + ".part")
    try:
        MIDI_DIR.mkdir(exist_ok=True)
        tmp.write_bytes(data)
        os.replace(tmp, destination)
    except OSError:
        try:
            tmp.unlink()
        except OSError:
            pass
        abort(500, description="Eciture du fichier impossible.")

    return jsonify(
        {
            "ok": True,
            "name": safe,
            "size": len(data),
            "info": info,
            "files": list_midi_files(),
        }
    )


if __name__ == "__main__":
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "5002"))
    print("Lecteur MIDI web — backend : %s" % FLASK_BACKEND)
    if FLASK_BACKEND == "flask_fallback":
        print(
            "Flask non installe : compatibilite embarquee activee "
            "(aucune dependance ajoutee)."
        )
    app.run(host=host, port=port)
