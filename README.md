# Lecteur MIDI — Flask + Web Audio

Application web de lecture de fichiers MIDI (`.mid` / `.midi`), écrite en
**Python/Flask** côté serveur et en **HTML/CSS/JavaScript natifs** côté client.
La lecture sonore utilise exclusivement l'**API Web Audio** du navigateur :
aucune dépendance externe n'est installée (pas de `pip install`, pas de Node.js,
pas de framework front-end).

## Installation et lancement

```bash
git clone git@github.com:yann-leschevin/Musique_Midi.git
cd Musique_Midi
```

**Option 1 — script `source.sh` (recommandé)** : crée/répare le `.venv`,
installe Flask si besoin, puis lance le serveur sur le port **5009**
(`HOST=0.0.0.0`, accessible depuis Windows / le réseau local sous WSL).

```bash
./source.sh
```

Puis ouvrir <http://localhost:5009/>.

**Option 2 — lancement direct** :

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt   # facultatif
python3 app.py
```

Puis ouvrir <http://127.0.0.1:5002/>.

Variables d'environnement optionnelles : `HOST` (défaut `127.0.0.1`), `PORT`
(défaut `5002`).

> **Note sur Flask** : le code est écrit pour Flask (`from flask import ...`,
> testé avec Flask 3.1.3). Si Flask n'est pas installé, `app.py` bascule
> automatiquement sur `flask_fallback.py`, une couche de compatibilité fournie
> dans le projet qui implémente le sous-ensemble d'API Flask utilisé (routes,
> `request`, `jsonify`, `render_template`, `send_from_directory`, `abort`,
> client de test) au-dessus de `wsgiref`, de la seule bibliothèque standard
> Python. L'application fonctionne donc **sans aucune dépendance**.
> Le badge « backend » en haut de la page indique le mode réellement utilisé.

## Fonctionnalités

- Interface « Maestro » (session 5) : thème sombre studio, bibliothèque à gauche,
  scène centrale (en lecture, musicogramme, transport à icônes, réglages).
- **Chargement local** : sélecteur de fichier + glisser-déposer (`File` →
  `FileReader`), sans passage par le serveur.
- **Bibliothèque `midis/`** : treeview par artiste, **replié au démarrage**,
  trié par **nom de famille** (« Bach, Johann Sebastian », « Chopin, Frédéric »…),
  recherche sans accents, Tout déplier / Tout replier. 342 œuvres, 40 artistes,
  jusqu'à 20 œuvres par compositeur (`fetch_composers_20.py`,
  `fetch_composers_all20.py`).
- **Glisser-déposer croisé** : un fichier du disque peut être déposé sur le
  dépôt local, mais aussi **un titre de la liste `midis/` ou le fichier local
  lui-même sur le bloc « Fichier chargé »** : le titre est alors chargé **et
  lu automatiquement** (la zone se met en surbrillance pendant le survol).
  Si le navigateur bloque encore le son, un message invite à cliquer une fois
  pour l'autoriser.
- **Envoi sur le serveur** : bouton « Envoyer sur le serveur » (POST en corps
  brut + entête `X-File-Name`), avec validation stricte côté Python.
- **Commandes** : Lecture, Pause, Reprendre, Arrêt (+ raccourcis `Espace` et
  `S`). *Pause* garde la position, *Arrêt* coupe le son **et revient au
  début** (utile pour relancer depuis zéro après la fin du fichier).
- **Position de lecture sur le musicogramme** (plus de barre de progression) :
  clic pour sauter, glisser du **trait lumineux** pour avancer / revenir
  (repositionnement au relâchement), survol = repère + heure visée, clavier
  `←` `→` (±5 s), `Début`, `Fin` ; temps écoulé / durée sous le musicogramme.
- **Sons (15 timbres)** : sélecteur « Son » avec 15 sons populaires (piano,
  piano électrique, orgue, guitare, basse, harpe, cordes, chœurs, cuivres,
  saxophone, flûte, synthé lead, pad, clochettes, marimba) plus le mode
  **Auto** qui suit l'instrument déclaré par le fichier MIDI. Chaque timbre
  combine oscillateur(s), filtre, enveloppe ADSR et vibrato ; il s'applique
  immédiatement, sans interrompre la lecture.
- **Vitesse** : curseur de 0,25× à 2× (pas de 0,05×), position et durée
  conservées, réglable pendant la lecture.
- **Réglages** : volume, forme d'onde, vitesse.
- **9 formes d'onde** : sinus, triangle, carré, dent de scie + 5 ondes
  fabriquées par `createPeriodicWave()` (dent de scie inversée, impulsion
  25 %, orgue, creuse, métallique) ; en mode **auto**, la forme dépend du son.
- **Mise en page souple** : les colonnes « Charger un fichier » et la scène
  (« Fichier chargé ») sont en flex — si l'une a besoin de grandir, l'autre se
  réduit (`min-width: 0`), et la barre latérale ne déborde plus sur la scène.
- **Erreurs explicites** : fichier invalide, format non supporté, trop
  volumineux, extension refusée, dossier absent, serveur injoignable —
  l'application ne plante jamais pour autant (messages affichés en français).

## Sous-ensemble MIDI pris en charge (honnêteté du lecteur)

Analyse écrite à la main dans `static/js/midi-parser.js` :

| Pris en charge | Non pris en charge |
| --- | --- |
| SMF **format 0** et **format 1** | **format 2** (rejeté avec un message clair) |
| En-tête `MThd`, pistes `MTrk`, chunks inconnus ignorés | Fichiers corrompus / tronqués (message d'erreur) |
| Temps variables (VLQ), **statut courant** | `sysex` (lus puis ignorés) |
| Méta tempo `0x51` (carte de tempo complète), signature de mesure, noms de pistes, fin de piste | Messages système / temps réel dans les pistes (ignorés) |
| Notes `note on/off`, vitesse 0 = note off, notes non refermées (avertissement) | Pédale de soutien (CC64), pitch bend, Aftertouch (lus, non joués) |
| Division en **ticks/quart de temps** et **SMPTE** | Percussions du canal 10 traitées comme des notes normales |
| Synthèse : oscillateurs + enveloppe en gain, planification « lookahead » | Timbres réels (pas de banque d'instruments) |

Le serveur applique la même limite à l'envoi : en-tête `MThd`, format 0/1,
présence des blocs `MTrk`, taille ≤ 5 Mo.

## Sécurité des routes de fichiers

- Extensions autorisées (whitelist) : `.mid`, `.midi` uniquement.
- Noms de fichiers : regex stricte, refus des chemins (`/`, `\`, `..`), octets
  nuls, noms vides et noms trop longs.
- Résolution par `realpath` + contrôle de appartenance au dossier `midis/`
  (impossible de lire `/etc/passwd` ou un lien symbolique sortant).
- Taille maximale : 5 Mo (`MAX_CONTENT_LENGTH` + vérification explicite → 413).
- Entête `X-Content-Type-Options: nosniff`, méthode `DELETE` refusée (405),
  erreurs API renvoyées en JSON avec le bon code HTTP.

## Arborescence

```
app.py                    Serveur Flask (routes, sécurité, validation MIDI, tri des artistes)
flask_fallback.py         Couche de compatibilité Flask (si absent) — wsgiref
source.sh                 Lanceur : venv + Flask + serveur sur le port 5009
requirements.txt          Dépendance facultative (Flask)
make_demo_midi.py         Générateur des fichiers de démonstration (pur Python)
fetch_free_midis.py       Ajoute des MIDI libres de droits (pur Python)
fetch_composers_20.py     20 œuvres pour Bach, Beethoven, Chopin, Mozart, Schubert
fetch_composers_all20.py  Jusqu'à 20 œuvres pour 19 autres musiciens
templates/index.html      Interface « Maestro »
static/css/style.css      Styles
static/js/midi-parser.js  Analyseur SMF (format 0/1, tempo, notes)
static/js/player.js       Lecteur Web Audio (timbres, ondes, vitesse, planification)
static/js/pianoroll.js    Musicogramme sur canvas (et contrôle de position)
static/js/app.js          Logique d'interface (bibliothèque, transport, glisser-déposer)
midis/                    342 fichiers MIDI (40 artistes) — domaine public / CC0
midis/SOURCES_MIDI.md     Provenance et licence de chaque fichier
README.md                 Ce fichier
ETAT_PROJET.md            Journal de travail (sessions 1 à 6)
```

## Bibliothèque MIDI (`midis/`) : d'où viennent les fichiers ?

Les fichiers du dossier `midis/` sont **libres de droits** : chacun est
accompagné, dans `midis/SOURCES_MIDI.md`, de son œuvre, de son compositeur, de
sa licence (**domaine public** ou **CC0 1.0**) et de son URL d'origine.

- 2 fichiers de démonstration générés par `make_demo_midi.py` (créations du
  projet, donc libres de droits) ;
- 2 fichiers récupérés sur Wikimedia Commons (domaine public) ;
- les autres (338) proviennent du catalogue `tactilegalactic/public-domain-midi`
  (GitHub), via `fetch_free_midis.py`, `fetch_composers_20.py` et
  `fetch_composers_all20.py`, qui vérifient l'**empreinte SHA-256**, la
  structure SMF (format 0/1, ≥ 20 notes, ≤ 5 Mo) et dédoublonnent avant écriture.

Réexécution possible (aucune dépendance, aucun fichier existant écrasé) :

```bash
python3 fetch_free_midis.py --target 50       # ajoute 50 MIDI libres de droits
python3 fetch_composers_20.py --dry-run       # affiche ce qui manque (5 grands compositeurs)
python3 fetch_composers_all20.py --dry-run    # idem pour les 19 autres musiciens
```

## Vérifications locales (sans laisser de serveur tourner)

```bash
# 1. syntaxe Python
python3 -m py_compile app.py flask_fallback.py make_demo_midi.py fetch_free_midis.py \
    fetch_composers_20.py fetch_composers_all20.py

# 2. routes et sécurité via le client de test WSGI (aucun serveur démarré)
python3 - <<'PY'
import app
c = app.app.test_client()
print(c.get("/").status_code, c.get("/api/health").get_json())
print(c.get("/api/midis").get_json())
print(c.get("/api/midi/../../etc/passwd").status_code)   # 400
print(c.post("/api/upload", data=b"xx", headers={"X-File-Name": "x.txt"}).status_code)  # 400
PY

# 3. syntaxe + comportement du parseur JavaScript (Node n'est PAS utilisé par l'app)
for f in static/js/*.js; do node --check "$f"; done
node -e 'const fs=require("fs");const {MidiFile}=require("./static/js/midi-parser.js");
const b=fs.readFileSync("midis/demo_gamme.mid");
const u=new Uint8Array(b.length);u.set(b);
console.log(MidiFile.parse(u.buffer));'
```

## Limites restantes

- L'interface a été validée dans Chrome headless (session 5) et le parseur par
  Node.js, mais le son n'a pas été écouté dans l'environnement de vérification ;
  la synthèse suit la spécification Web Audio (création différée de
  l'`AudioContext` au premier clic, conforme à la politique d'autoplay).
- Pas de synthèse instrumentale réaliste, pas de gestion de la pédale.
- Certains compositeurs ont moins de 20 œuvres : le catalogue libre de droits
  utilisé est épuisé pour eux (détail dans `ETAT_PROJET.md`, session 5).
- Upload en corps brut (pas de multipart) : volontaire, pour un comportement
  identique avec ou sans Flask.
