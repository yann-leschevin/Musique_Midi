# ETAT_PROJET — Lecteur MIDI web (Flask + Web Audio)

- **Dépôt** : <https://github.com/yann-leschevin/Musique_Midi>
- **Session 1** : 2026-09-25 18:42 → 19:05 — **Session 2** : 2026-09-25 19:15 → 22:10 — **Session 3** : 2026-09-25 23:00 → 23:30 — **Session 4** : 2026-10-04 (treeview + 20/compositeur) — **Session 5** : 2026-10-05 (repli au démarrage, tri par nom, 342 œuvres, seek sur le musicogramme, refonte « Maestro ») — **Session 6** : 2026-10-16 (mise à jour de la documentation, publication sur GitHub)
- **Objectif** : application web de lecture de fichiers MIDI (`.mid`/`.midi`) en Python + Flask, interface HTML/CSS/JS natifs, lecture côté navigateur par l'API Web Audio, sans installer la moindre dépendance.
- **État global** : **TERMINÉ** — application réalisée, enrichie en session 2 (50 MIDI libres de droits, port 5002, 15 sons, curseur de vitesse), puis en session 3 (mise en page souple, 5 ondes supplémentaires, glisser-déposer croisé avec lecture automatique), puis en session 4 (colonne gauche en **treeview par artiste trié A→Z**, **20 œuvres majeures** pour chacun des 5 grands compositeurs : Bach, Beethoven, Chopin, Mozart, Schubert — 138 fichiers au total), vérifiée.

## Contraintes respectées

- Python + Flask uniquement côté serveur ; HTML/CSS/JS **natifs** côté client (aucun framework, aucun Node.js dans l'application).
- **Aucune installation** : ni `pip install`, ni gestionnaire de paquets.
- Serveur **jamais laissé tourner** : toutes les vérifications ont été faites hors serveur ou avec arrêt systématique.
- Rien n'a été supprimé dans le dossier courant (répertoire personnel riche en projets préexistants).

## Constat initial (étape 1)

- Dossier courant inspecté ; `ETAT_PROJET.md`, `templates/`, `static/`, `midis/` **absents** → tout est créé.
- Python 3.12.3 présent. **Flask n'est PAS installé** (`ModuleNotFoundError: No module named 'flask'`), l'installation étant interdite.
- **Solution sans installation retenue** : `app.py` importe Flask normalement (`from flask import ...`) ; si l'import échoue, il bascule sur `flask_fallback.py`, couche de compatibilité du projet implémentant le sous-ensemble d'API Flask utilisé (routes, `request`, `jsonify`, `render_template`, `send_from_directory`, `abort`, `Response`, client de test) sur `wsgiref` (bibliothèque standard). Aucun code applicatif dupliqué.
- Vérification complémentaire : avec un Flask 2.0.2 réel disponible dans un site-packages Windows de la machine (utilisé **en lecture seule, sans installation** via `PYTHONPATH`), la même `app.py` fonctionne → `flask_backend: "flask"`, toutes les routes OK.

## Étapes de travail (journal)

| # | Étape | Statut | Détail / résultat |
|---|-------|--------|-------------------|
| 1 | Examen du dossier courant | FAIT | Aucun fichier utile supprimé |
| 2 | Création de `ETAT_PROJET.md` | FAIT | Présent fichier |
| 3 | `flask_fallback.py` | FAIT | 608 lignes, compatibilité Flask sans installation |
| 4 | `app.py` | FAIT | 5 routes + 7 gestionnaires d'erreur, sécurité complète |
| 5 | `templates/index.html` | FAIT | UI : chargement, transport, progression, piano roll, limites |
| 6 | `static/css/style.css` | FAIT | Thème sombre, responsive, aucun framework |
| 7 | `static/js/midi-parser.js` | FAIT | SMF 0/1 écrit à la main (VLQ, statut courant, tempo, SMPTE) |
| 8 | `static/js/player.js` | FAIT | Web Audio : oscillateurs + enveloppe, lookahead, états |
| 9 | `static/js/pianoroll.js` | FAIT | Visualisation canvas avec couche statique + curseur |
| 10 | `static/js/app.js` | FAIT | Interface, drag & drop, upload, messages d'erreur |
| 11 | `midis/` + `make_demo_midi.py` | FAIT | 2 MIDI générés (`demo_gamme.mid`, `demo_accords.mid`) |
| 12 | `README.md` | FAIT | Lancement, sous-ensemble supporté, sécurité, vérifications |
| 13 | Vérification existence des fichiers | FAIT | 14/14 fichiers/dossiers présents (`ls`/`stat`) |
| 14 | Vérification syntaxe Python | FAIT | `python3 -m py_compile app.py flask_fallback.py make_demo_midi.py` → OK |
| 15 | Vérification syntaxe JS | FAIT | `node --check` sur les 4 fichiers → OK (Node utilisé **uniquement pour vérifier**, pas par l'app) |
| 16 | Tests routes (client WSGI, aucun serveur) | FAIT | **31/31 contrôles OK** |
| 17 | Test serveur HTTP réel (arrêt immédiat) | FAIT | 12 requêtes HTTP OK, processus tué, `aucun processus restant` |
| 18 | Tests du parseur MIDI (Node) | FAIT | 2 démos + 8 cas (garbage, tronqué, format 2, sans note, statut courant, SMPTE, tempo 120→60 BPM, note non refermée) → comportements corrects |
| 19 | Test de la machine à états du lecteur | FAIT | AudioContext simulé : load/lecture/pause/reprise/arrêt/seek/fin OK |
| 20 | Test avec un vrai Flask | FAIT | `flask_backend: "flask"` via `PYTHONPATH` (sans installation) |
| 21 | Nettoyage (`__pycache__`, fichiers de test) | FAIT | `midis/` ne contient que les 2 démos |
| 22 | Bilan final | FAIT | Voir ci-dessous |

## Fonctionnalités réalisées

- Page d'accueil claire, chargement **local** (sélecteur + glisser-déposer) et **serveur** (dossier `midis/`, liste + clic), envoi sur le serveur.
- Commandes **Lecture / Pause / Reprendre / Arrêt** (raccourcis `Espace`, `S`), barre de progression **cliquable et déplaçable**, temps écoulé / durée totale, navigation clavier (`←` `→` `Début` `Fin`).
- Réglages volume et forme d'onde, visualisation **piano roll** sur canvas, badges « backend » et « serveur ».
- Métadonnées affichées : format SMF, pistes, division, durée, nombre de notes, BPM, canaux, instruments (noms GM).
- Gestion explicite des erreurs (messages français, jamais de plantage) : fichier invalide, format 2, taille, extension, dossier absent, serveur injoignable, absence de Web Audio.

## Vérifications effectivement exécutées

1. `python3 -m py_compile app.py flask_fallback.py make_demo_midi.py` → **OK**.
2. `node --check` sur `midi-parser.js`, `player.js`, `pianoroll.js`, `app.js` → **OK**.
3. Client de test WSGI (aucun serveur démarré) : **31/31 contrôles OK** (routes, statuts, contenu HTML, MIME, `nosniff`, 404 HTML/JSON, 405, 400/413 sur upload, traversal de dossiers, whitelist d'extensions, dossier nettoyé).
4. Serveur HTTP réel démarré sur le port 5099 puis **arrêté** : 12 requêtes (/, CSS, JS, health, liste, fichier MIDI, traversals, 404, uploads) → réponses correctes, `aucun processus restant`.
5. Parseur JavaScript exécuté sur 10 fichiers (2 démos + 8 cas) → lecture correcte, rejet explicite des cas invalides.
6. Lecteur audio exécuté avec `AudioContext` simulé → cycle d'états complet validé.
7. `app.py` exécuté avec un **vrai Flask** (lecture seule, sans installation) → identique.

## Limites restantes

- **Pas de navigateur dans l'environnement** : la synthèse Web Audio suit la spécification (création différée de l'`AudioContext` au premier clic) mais n'a pas pu être écoutée ici.
- Sous-ensemble MIDI assumé et **affiché à l'utilisateur** : formats 0 et 1 uniquement (format 2 rejeté), sysex et événements système ignorés, pédale CC64/pitch bend non joués, timbres réels non reproduits (oscillateurs).
- Upload en **corps brut** (`X-File-Name`) plutôt qu'en multipart — volontaire : comportement identique avec ou sans Flask.
- `flask_fallback.py` couvre uniquement le sous-ensemble d'API utilisé par cette application (ce n'est pas Flask complet).


---

# SESSION 2 — 2026-09-25 (19:15 → 22:10)

## Demandes traitées

1. Ajouter **50 fichiers MIDI** (`*.mid`) **libres de droits** dans le répertoire `midis/` ;
2. Changer le **port 5000** de l'application en **5002** ;
3. Ajouter la **possibilité de modifier les sons**, avec **15 sons populaires** ;
4. Ajouter un **curseur de vitesse** de la musique.

## Étapes de travail (journal détaillé)

| # | Étape | Statut | Détail / résultat |
|---|-------|--------|-------------------|
| 1 | Relecture de `ETAT_PROJET.md` et inventaire du projet | FAIT | Session 1 comprise ; `app.py`, `templates/`, `static/`, `midis/`, `README.md` existants |
| 2 | Recherche du port dans le code | FAIT | `app.py` utilise déjà `PORT=5002` (défaut), mais `README.md` (2×) et `flask_fallback.py` annonçaient encore **5000** |
| 3 | Correction du port dans `README.md` | FAIT | URL d'ouverture `http://127.0.0.1:5002/` + variable `PORT` (défaut `5002`) |
| 4 | Correction du port dans `flask_fallback.py` | FAIT | signature `run(host="127.0.0.1", port=5002, ...)` |
| 5 | Contrôle global des occurrences « 5000 » | FAIT | plus aucune occurrence liée au port (seuls subsistent `DEFAULT_TEMPO = 500000` µs et un `setTimeout(…, 5000)`) |
| 6 | Création de `fetch_free_midis.py` (source 1 : API Wikimedia Commons) | FAIT | recherche multicritère, licences, validation SMF, noms ASCII, manifeste |
| 7 | Exécution → **HTTP 429** persistant sur `upload.wikimedia.org` | INCIDENT | limite de débit IP après appel excessif ; processus arrêté (`kill -9`), 2 fichiers récupérés avant le blocage |
| 8 | Recherche d'une source alternative | FAIT | catalogue GitHub `tactilegalactic/public-domain-midi` : 1014 éditions MIDI avec licence **Public Domain** ou **CC0-1.0**, URL d'origine et **SHA-256** par fichier |
| 9 | Réécriture de `fetch_free_midis.py` sur cette source | FAIT | téléchargement depuis `raw.githubusercontent.com`, vérification **empreinte SHA-256**, structure SMF, ≥ 20 notes, taille 800 o – 5 Mo |
| 10 | Sélection équilibrée (20 piano, 16 orchestre, 7 comptines, 5 hymnes, 2 marches) | FAIT | 50 fichiers ajoutés ; noms ASCII conformes à la whitelist de l'application |
| 11 | Manifeste `midis/SOURCES_MIDI.md` | FAIT | 55 fichiers documentés : œuvre, compositeur, licence + lien, URL d'origine |
| 12 | Contrôle du dossier `midis/` | FAIT | **55 fichiers `.mid`**, 7,1 Mo, 0 invalide, 0 nom non conforme, max 473 Ko |
| 13 | Nouveaux sons : `static/js/player.js` | FAIT | table `SOUNDS` de **15 timbres** (piano, piano électrique, orgue, guitare, basse, harpe, cordes, chœurs, cuivres, saxophone, flûte, synthé lead, pad, clochettes, marimba) |
| 14 | Synthèse enrichie | FAIT | par note : oscillateur principal + oscillateur secondaire, **filtre biquad** à enveloppe, **ADSR**, **vibrato** LFO (retardé), gain selon vélocité ; nettoyage des nœuds assuré |
| 15 | Mode « Auto » | FAIT | `resolveSound()` mappe le programme GM du canal (dernier `program change`) sur le timbre le plus proche ; canal 9 → timbre frappé ; mode forcé sinon |
| 16 | API du lecteur | FAIT | `setSound()` / `getSound()` / `resolveSound()` + `MidiPlayer.SOUNDS` exportés, changement sans interrompre la lecture |
| 17 | Curseur de vitesse : `setSpeed()` | FAIT | plage **0,25× → 4×**, borne et validée (`NaN` → 1) |
| 18 | Adaptation de l'horloge à la vitesse | FAIT | `getPosition()` = `(currentTime - startedAt) × vitesse`, `_startAt()` / `resume()` divisent par la vitesse, notes replanifiées (`_startAt(position)`) en lecture, `paused` → reprise différée |
| 19 | Interface `templates/index.html` | FAIT | `<select id="sound">` (option « Auto (instrument du fichier) »), `<input id="speed">` + `<output id="speedValue">`, option « Auto » ajoutée à la forme d'onde |
| 20 | Câblage `static/js/app.js` | FAIT | remplissage du sélecteur depuis `MidiPlayer.SOUNDS` (16 options), format français `1,00×`, écouteurs `input`/`change`, messages utilisateur |
| 21 | Styles `static/css/style.css` | FAIT | `output` (largeur fixe, chiffres tabulaires), `max-width` du sélecteur de son |
| 22 | Textes de l'interface | FAIT | rappel des réglages dans le bandeau « Transport », colonne « pris en charge » mise à jour (15 timbres, vitesse 0,25×–4×) |
| 23 | `README.md` mis à jour | FAIT | fonctionnalités (sons, vitesse), arborescence, section « D'où viennent les fichiers ? », commande de vérification Python |
| 24 | Vérifications (voir ci-dessous) | FAIT | syntaxe, routes, parseur sur 55 fichiers, lecteur simulé, interface simulée, serveur réel arrêté |
| 25 | Mise à jour de ce fichier de suivi | FAIT | présente section |

## Ce qui a changé (session 2)

| Fichier | Changement |
|---|---|
| `midis/` | **+50 fichiers `.mid`** (55 au total, 7,1 Mo) + `SOURCES_MIDI.md` |
| `fetch_free_midis.py` | **nouveau** : récupère/valide les MIDI libres de droits (pur Python, aucune dépendance) |
| `README.md` | port 5002, fonctionnalités sons/vitesse, provenance des MIDI, arborescence |
| `flask_fallback.py` | port par défaut `5000` → **5002** |
| `templates/index.html` | sélecteur **Son** (15 sons + auto), curseur **Vitesse**, forme d'onde « auto », textes |
| `static/js/player.js` | 15 timbres + résolution automatique, vitesse 0,25×–4×, enveloppes/filtre/vibrato (819 lignes) |
| `static/js/app.js` | câblage des nouveaux contrôles (804 lignes) |
| `static/css/style.css` | styles des nouveaux contrôles |
| `app.py` | **inchangé** (déjà sur le port 5002) |
| `ETAT_PROJET.md` | présente session |

## Vérifications effectivement exécutées (session 2)

1. `python3 -m py_compile app.py flask_fallback.py make_demo_midi.py fetch_free_midis.py` → **OK**.
2. `node --check` sur les 4 fichiers `static/js/*.js` → **OK**.
3. Client de test WSGI (aucun serveur) : **10/10 contrôles OK** — `/` 200, `/api/health` 200 (`flask_fallback`), **`/api/midis` → 55 fichiers**, fichier MIDI 200 `audio/midi`, traversal `400`, inconnu `404`, `DELETE` `405`, upload texte `400`, upload MIDI `200` (fichier de test supprimé).
4. Parseur JavaScript (Node) sur **les 55 fichiers** : **55/55 OK** (formats 0 et 1, 600 → 32 000 notes, aucune erreur).
5. Lecteur avec `AudioContext` simulé : vitesse défaut 1, bornes `0,25`/`4`, **position conservée** au passage de ×1 à ×2 (0,500 s → 0,500 s), avance exacte ensuite (1,500 s), pause/reprise/seek/arrêt/fin OK ; sons : force `flute` → « Flûte », valeur inconnue → retour à `auto`, programmes GM 73/40/48/88 → flûte/cordes/cordes/pad, canal 9 → marimba.
6. Interface simulée (DOM minimal, Node) : **13/13 contrôles OK** — 16 options dans le sélecteur, affichage `1,00×`/`1,50×`/`0,25×`, appels `setSpeed(1.5)`, `setSpeed(0.25)`, `setSound('flute')`, `setWaveform('square')`, `setVolume(0.4)`.
7. Serveur réel démarré sur le **port 5002** : 8 requêtes (`/`, `/api/health`, `/api/midis` → 55, fichier MIDI 200 `audio/midi`, `player.js`, `app.js`, `style.css`, `/`) → toutes en 200, journal `wsgiref` correct ; la page contient `id="sound"`, `id="speed"`, `id="speedValue"` → **puis arrêté** (`kill`), `0` processus `app.py` restant, **port 5002 libre**.

## Incidents de la session

- **HTTP 429 (Wikimedia)** : la première version du script interrogeait l'API et le CDN Wikimedia trop vite ; blocage de débit IP. Processus arrêté, source remplacée par un catalogue GitHub (via `raw.githubusercontent.com`), script réécrit avec pauses et nouvelles tentatives. Les 2 fichiers déjà récupérés (licences vérifiées « Public domain » via l'API) ont été conservés et documentés.
- **Port 5000 déjà occupé** sur la machine par une autre application (Python, « Image → prompt Gemma », laissée intacte) : cela confirme l'utilité du passage en **5002** ; vérifié que l'application ne répond plus sur 5000 (elle répond sur 5002).

## Limites de la session 2

- **Toujours pas de navigateur** dans l'environnement : les timbres et la vitesse ont été validés par simulation (`AudioContext` et DOM factices), pas par écoute réelle.
- Les 15 sons sont des **synthèses approchées** (oscillateurs + filtre + enveloppe), pas des banques d'échantillons : la « famille GM » du fichier sert de point de départ en mode auto.
- Changer la vitesse **en cours de lecture** replanifie les notes : une micro-coupure sonore est possible (comportement assumé, position et durée conservées).
- Les 50 fichiers proviennent d'un catalogue tiers qui **publie la licence et l'empreinte SHA-256 de chaque fichier** ; le script revérifie l'empreinte et la structure SMF avant écriture. Tout reste détaillé dans `midis/SOURCES_MIDI.md`.
- `fetch_free_midis.py --target N` **ajoute** N fichiers : une nouvelle exécution en ajouterait d'autres (noms dédupliqués, aucun fichier existant écrasé).

---

# SESSION 3 — 2026-09-25 (23:00 → 23:30)

## Demandes traitées

1. Le bloc **« Charger un fichier »** a besoin de plus de place et **empiète sur le bloc « Fichier chargé »** → faire en sorte que **l'un se réduise si l'autre doit grandir** ;
2. **Supprimer le bouton « Arrêt »** (inutile) **ou expliquer à quoi il sert** ;
3. Ajouter **5 formes d'onde** à la liste « Forme d'onde » ;
4. Permettre le **glisser-déposer de la liste « Charger un fichier » vers « Fichier chargé »** et **lancer automatiquement la musique**.

## Réponse à la demande n° 2 (le bouton « Arrêt »)

Le bouton **n'a pas été supprimé** : il n'est pas inutile, il fait quelque chose
que **Pause** ne fait pas.

| | Pause | **Arrêt** |
|---|---|---|
| Son | coupe, mais les nœuds restent planifiés | **annule** toutes les notes en cours (`_cancelSources()`) |
| Position | **conservée** → « Reprendre » repart au même endroit | **remise à 0** |
| État | `paused` | `stopped` |
| Après la fin du fichier | — | permet de **relancer depuis le début** sans boucler la barre |

Raccourci clavier associé : **`S`**. C'est aussi la seule commande qui coupe
net toutes les oscillations en vol (Pause laisse la réverbération/le release
se terminer). Le rôle du bouton est désormais **expliqué dans l'interface** :
`title` infobulle + légende « Transport » mise à jour (« ≠ Pause, qui garde la
position »). À supprimer, il suffirait de retirer `#btnStop` de
`templates/index.html` et son écouteur dans `bindTransport()` (`app.js`).

## Étapes de travail (journal détaillé)

| # | Étape | Statut | Détail / résultat |
|---|-------|--------|-------------------|
| 1 | Relecture de `ETAT_PROJET.md` + inventaire | FAIT | sessions 1 et 2 comprises ; 4 demandes relevées |
| 2 | Analyse de l'empilement des deux blocs | FAIT | `.layout` était une **grille** : colonne de gauche fixe à `330px`, `.sidebar` en `sticky` sans `min-width: 0` → contenu non réductible qui débordait sur la scène |
| 3 | Passage de la grille au **flex mutuel** (`style.css`) | FAIT | `.layout { display:flex; flex-wrap:wrap }`, `.sidebar { flex: 1 1 auto; min-width:0; max-width: min(520px,48%) }`, `.stage { flex: 2 1 640px; min-width:0 }` → **si l'un grandit, l'autre se réduit** |
| 4 | Anti-débordement de la barre latérale | FAIT | `overflow-x:hidden`, `overflow-y:auto`, `max-height:calc(100vh-92px)`, `overflow-wrap:anywhere` → la barre ne peut plus recouvrir « Fichier chargé » |
| 5 | Plus de place pour « Charger un fichier » | FAIT | colonne élargie jusqu'à 520 px (au lieu de 330), `min-height:96px` sur le dépôt, texte d'aide ajouté |
| 6 | Media-query adaptée | FAIT | ≤ 960 px : colonnes empilées, `max-height`/`overflow` neutralisés (sinon barre de défilement imbriquée) |
| 7 | Étude du bouton **Arrêt** | FAIT | réellement utile (voir tableau ci-dessus) → **conservé** + explicite (infobulle, légende) |
| 8 | 5 ondes supplémentaires (`player.js`) | FAIT | table `CUSTOM_WAVES` + `periodic()` qui calcule les séries de Fourier (32 harmoniques) : `saw-inv`, `pulse`, `organ`, `hollow`, `metallic` |
| 9 | Fabrication des ondes | FAIT | `_periodicWave(type)` appelle `ctx.createPeriodicWave(real, imag)` **une fois** puis met en cache (`this._waves`) ; `applyWave()` distingue type natif et `PeriodicWave` |
| 10 | Sécurité des types d'oscillateur | FAIT | `osc.type = "pulse"` **lèverait un `TypeError`** (enum WebIDL) : affectation interdite, seul `setPeriodicWave()` est utilisé pour les ondes maison ; repli `sine` si échec |
| 11 | Validation `setWaveform()` | FAIT | `isKnownWave()` accepte auto + 4 natifs + 5 personnalisés, sinon retour à `auto` ; **retourne** la valeur retenue ; export `MidiPlayer.WAVES` / `CUSTOM_WAVE_IDS` |
| 12 | Interface : liste d'ondes (`index.html`) | FAIT | 5 `<option>` ajoutées → **auto + 9 ondes** ; ligne « pris en charge » mise à jour |
| 13 | Cible de dépôt « Fichier chargé » | FAIT | `.now-playing` reçoit `id="nowPlaying"`, une invite `#dropHint`, une bordure pointillée et `.drop-hover` au survol |
| 14 | Sources de glissement (`app.js`) | FAIT | éléments de `#midiList` en `draggable` (`application/x-midi-file`) et dépôt local en `draggable` dès qu'un fichier est choisi (`application/x-midi-local`) |
| 15 | Lecture automatique | FAIT | `loadFromServer(name, true)` / `handleLocalFile(file, true)` → `startPlayback()` juste après `applyParsed()` |
| 16 | Déblocage audio | FAIT | un dépôt n'est pas toujours un « geste utilisateur » : si l'`AudioContext` reste `suspended`, message + déblocage au prochain clic/touche (`warnIfAudioSuspended()`) |
| 17 | Dépôt sur la zone locale | FAIT | la zone « Charger un fichier » accepte aussi un titre de la liste (chargement **sans** lancement, comme un clic) |
| 18 | Textes | FAIT | astuce dans les deux blocs, invite de dépôt, titre du bouton Arrêt, ligne « pris en charge » |
| 19 | `README.md` | FAIT | glisser-déposer croisé, 9 ondes, mise en page souple, rôle d'« Arrêt » |
| 20 | Vérifications (voir ci-dessous) | FAIT | syntaxe, 48 contrôles interface/lecteur, 34 contrôles routes, serveur réel démarré puis **arrêté** |
| 21 | Mise à jour de ce fichier | FAIT | présente section |

## Ce qui a changé (session 3)

| Fichier | Changement |
|---|---|
| `static/css/style.css` | grille → **flex mutuel** (`min-width: 0`, largeurs bornées), anti-débordement de la `.sidebar`, `.now-playing` en zone de dépôt, styles `dragging`/`drop-hover`/`draggable` |
| `static/js/player.js` | **5 ondes personnalisées** (`CUSTOM_WAVES`, `periodic()`, `_periodicWave()`, `applyWave()`, `isKnownWave()`), export `WAVES` |
| `static/js/app.js` | glisser-déposer croisé (`DND_FILE` / `DND_LOCAL`), `bindDropTarget()`, `startPlayback()`, `warnIfAudioSuspended()`, paramètre `autoplay` |
| `templates/index.html` | `id="nowPlaying"` + invite de dépôt, 5 options d'onde, astuces de glissement, `title` et légende du bouton **Arrêt** |
| `README.md` | fonctionnalités de la session 3 |
| `app.py`, `flask_fallback.py`, `static/js/midi-parser.js`, `static/js/pianoroll.js` | **inchangés** |
| `midis/` | **inchangé** (55 fichiers) |
| `ETAT_PROJET.md` | présente session |

## Vérifications effectivement exécutées (session 3)

1. `python3 -m py_compile app.py flask_fallback.py make_demo_midi.py fetch_free_midis.py` → **OK**.
2. `node --check` sur les 4 fichiers `static/js/*.js` → **OK**.
3. **Banc d'interface/lecteur** (`vm` + DOM et `AudioContext` factices, parseur réel sur `midis/demo_gamme.mid`) : **48/48 contrôles OK** —
   9 ondes exportées + 10 options HTML ; `setWaveform` accepte les 5 nouvelles et rejette l'inconnu ; `setPeriodicWave()` appelé et **aucune affectation invalide à `osc.type`** ; éléments de liste `draggable` avec `dragstart`/`dragend` ; survol → surbrillance + invite « Relâchez » ; dépôt d'un titre serveur → téléchargement, titre « Demo gamme de Do », **état « lecture »**, durée `0:05` ; dépôt d'un fichier local → chargé et **lu** ; dépôt sur la zone locale → chargement **sans** lancement ; type inconnu géré ; clic sur la liste toujours fonctionnel.
4. **Client de test WSGI** (aucun serveur) : **34/34 contrôles OK** — `/` 200 avec `#nowPlaying`, `#dropHint`, 10 options d'onde ; `/api/health` ; `/api/midis` → **55 fichiers** ; fichier MIDI 200 `audio/midi` ; 3 fichiers statiques 200 ; présence des marqueurs `bindDropTarget` / `startPlayback` / `MidiPlayer.WAVES` ; traversal → 400 ; inconnu → 404.
5. **Serveur réel** sur le port **5077** : 5 requêtes (`/`, `/api/health`, `/api/midis`, `app.js`, `style.css`) → toutes en 200, page contenant `id="nowPlaying"`, `id="dropHint"` et `value="metallic"` → **puis arrêté** (`kill`), **aucun processus `app.py` restant**, port libre.

## Limites de la session 3

- **Toujours pas de navigateur** : le glisser-déposer et les ondes ont été validés par **simulation** (DOM/`AudioContext` factices), pas par écoute ni par manipulation à la souris réelle.
- Le **lancement automatique** dépend de la politique d'autoplay du navigateur : si le dépôt n'est pas accepté comme geste utilisateur, l'application affiche un message et débloque l'`AudioContext` au prochain clic (le pointeur restera figé jusque-là, comportement assumé).
- La barre latérale reste **collante** (`sticky`) et donc défilable en interne : sur un écran très bas, un défilement imbriqué liste/colonne peut apparaître (au-delà de 960 px de large uniquement).
- Les 5 ondes supplémentaires sont des **séries de Fourier tronquées à 32 harmoniques** (normalisées par `createPeriodicWave`) : ce sont des timbres synthétiques, pas des enregistrements.
- L'astuce voulue « liste de Charger un fichier » a été interprétée comme **la liste des fichiers du dépôt latéral** (`#midiList`, sous le bloc « Charger un fichier ») : c'est elle qui est glissable, ainsi que le dépôt local lui-même.

---

# SESSION 4 — 2026-10-04 (treeview par artiste + 20 œuvres/compositeur)

## Demandes traitées

1. **Remplacer le cadre (frame) de gauche par un treeview** pour classer les musiques ;
2. **Trier par nom d'artiste** (Chopin, Mozart, …) ;
3. **Ajouter les 20 musiques MIDI les plus connues pour chaque musicien**.

## Interprétation retenue (notée ici car la demande est large)

- Le « frame » = la liste plate `<ul id="midiList">` du bloc « Dossier `midis/` »
  dans la colonne de gauche → remplacée par un **arbre repliable par artiste**
  (`#midiTree`, `role="tree"`), avec recherche, Tout déplier / Tout replier,
  tri A→Z, clavier (`Entrée`/`Espace`, `←`/`→` sur les nœuds).
- « Chaque musicien » = les **5 grands compositeurs** couverts par le catalogue
  avec ≥ 20 entrées libres de droits : **Bach, Beethoven, Chopin, Mozart,
  Schubert**. Haydn n'a que 18 entrées au catalogue → exclu du lot « 20 ».
  Objectif : **atteindre 20 fichiers par compositeur** (existant + ajouts),
  soit 20 Mozart (dont 0 avant), 17 Chopin, 13 Beethoven, 18 Bach, 15 Schubert
  = **83 ajouts**, **138 fichiers** au total, tous vérifiés SMF + SHA-256.
- Normalisation des variantes d'écriture (`F_F_Chopin`, `Frederic_Chopin`,
  `L_V_Beethoven`, `Ludwig_van_Beethoven`, `Johann_Sebastian_Bach`…) vers un
  nom canonique unique par artiste, sinon le treeview éclaterait Chopin en 2
  groupes et Beethoven en 3.

## Étapes de travail (journal détaillé)

| # | Étape | Statut | Détail / résultat |
|---|-------|--------|-------------------|
| 1 | Relecture de `ETAT_PROJET.md` + inventaire | FAIT | sessions 1-3 comprises ; liste plate `#midiList`, 55 `.mid`, 0 Mozart, Chopin/Beethoven fragmentés |
| 2 | Analyse par artiste (préfixe ` - `) | FAIT | 32 variantes ; cibles : Bach 2, Beethoven 7, Chopin 3, Mozart 0, Schubert 5 |
| 3 | Test réseau + inspection du catalogue (1014 éditions) | FAIT | Bach 176, Beethoven 65, Mozart 62, Chopin 33, Schubert 23, Haydn 18 → périmètre 5×20 validé |
| 4 | Création de `fetch_composers_20.py` | FAIT | priorités « œuvres célèbres » par compositeur, SHA-256, SMF ≥ 20 notes, noms `Mozart - ….mid`, manifeste |
| 5 | `--dry-run` | FAIT | manque 20+17+13+18+15 = 83, 20-32 candidats prioritaires chacun |
| 6 | Téléchargement réel | FAIT | **83/83 ajoutés** (ex. Petite musique de nuit, Alla Turca, Dies Irae, Jupiter, Lettre à Élise, Valse minute, Fantaisie-Impromptu, Préludes…) ; total `midis/` = **138** |
| 7 | `app.py` : `ARTIST_ALIASES` + `artist_info()` | FAIT | `EMPEROR.mid` → Beethoven, `demo_*` → Démos, `Johannes Brahms…` → Brahms, sinon `Divers / Inconnu` |
| 8 | `app.py` : `list_midi_files()` enrichie + triée | FAIT | champs `artist`/`artist_key`/`title`, tri `(artist_key, title, name)` |
| 9 | `app.py` : `group_midi_files()` + `/api/midis` | FAIT | réponse `{files, groups, max_size}`, groupes triés pour le treeview |
| 10 | `templates/index.html` : treeview | FAIT | `#midiTree[role=tree]`, `#treeSearch`, `#btnExpandAll`/`#btnCollapseAll`, bloc renommé « par artiste », aide A→Z |
| 11 | `static/js/app.js` : arbre | FAIT | `groupFiles()`, `renderTree()`, `makeFileItem()` (titre joli + `title=` nom réel), repli mémorisé, recherche, `←`/`→`, `markActiveInTree()`, drag & drop conservé, repli legacy si vieux HTML |
| 12 | `static/css/style.css` : styles d'arbre | FAIT | `.tree-toolbar`, `.tree`, `.tree-group`, `.tree-toggle` + chevron rotatif, `.tree-count`, `.tree-children` |
| 13 | Vérifications (voir ci-dessous) | FAIT | py_compile, node --check, routes WSGI, parseur 138/138, tri vérifié |
| 14 | Mise à jour de ce fichier + manifeste | FAIT | présente section + `midis/SOURCES_MIDI.md` (+83 lignes) |

## Ce qui a changé (session 4)

| Fichier | Changement |
|---|---|
| `midis/` | **+83 `.mid`** (138 au total : 20 Bach, 20 Beethoven, 20 Chopin, 20 Mozart, 20 Schubert) |
| `fetch_composers_20.py` | **nouveau** : complète à 20/compositeur depuis le même catalogue PD/CC0 (pur stdlib) |
| `midis/SOURCES_MIDI.md` | section « Ajout `fetch_composers_20.py` (83 fichiers) » : œuvre, compositeur catalogue, cible, licence, origine |
| `app.py` | `ARTIST_ALIASES`, `artist_info()`, `list_midi_files()` enrichie/triée, `group_midi_files()`, `/api/midis` → `{files, groups}` |
| `templates/index.html` | liste plate → **treeview** (`#midiTree`, recherche, déplier/replier) |
| `static/js/app.js` | arbre par artiste trié, filtre, clavier, surbrillance active, DnD inchangé (+236 lignes) |
| `static/css/style.css` | styles du treeview |
| `ETAT_PROJET.md` | présente session |
| `flask_fallback.py`, `midi-parser.js`, `player.js`, `pianoroll.js` | **inchangés** |

## Vérifications effectivement exécutées (session 4)

1. `python3 -m py_compile app.py fetch_composers_20.py fetch_free_midis.py flask_fallback.py make_demo_midi.py` → **OK**.
2. `node --check` sur `app.js`, `player.js`, `midi-parser.js`, `pianoroll.js` → **OK**.
3. Logique métier (sans serveur) : 138 fichiers enrichis, **32 groupes**, tri artistes A→Z **OK**, tri titres intra-groupe **OK**, 20/20 pour les 5 cibles, traversal `../x.mid` → `None` **OK**.
4. Client WSGI (aucun serveur) : `/api/midis` 200 → 138 `files` + 32 `groups`, clés `artist/artist_key/title` présentes ; `/` 200 contient `midiTree`, `treeSearch`, `btnExpandAll` (plus d'`ul#midiList`) → **OK** (backend réel `flask` détecté ici).
5. Marqueurs JS/CSS/HTML : `renderTree`, `groupFiles`, `bindTreeToolbar`, `clientArtistOf`, `markActiveInTree`, `DND_FILE`, `.tree-toggle`, `.tree-children` → **OK**.
6. Parseur JS réel sur **138/138 fichiers** (`ArrayBuffer` même realm) → **138/138 OK** (notes > 0).
7. Aucun serveur laissé tourner (tout en client WSGI + lectures fichiers).

## Limites de la session 4

- Les « 20 plus connues » sont un **choix éditorial de notoriété** projeté sur le catalogue disponible (ex. `Eine kleine Nachtmusik`, `Alla Turca`, `Lettre à Élise`, `Valse minute`), pas un palmarès officiel ; certaines œuvres existent en **éditions multiples** (ex. `Marche militaire n°3` en `F_Schubert` + `Schubert`), comptées comme fichiers distincts.
- Haydn (18 entrées catalogue) et les petits répertoires (comptines, hymnes, démos) restent **hors quota 20** mais apparaissent normalement dans le treeview (32 groupes au total).
- Treeview replié par défaut (sauf recherche) : avec 138 fichiers, tout déplier allonge la colonne (défilement interne `max-height: 420px` assumé).
- Toujours **pas de navigateur** : l'arbre a été validé par structure + simulation, pas au clic souris réel.

---

# SESSION 5 — 2026-10-05 (repli au démarrage, tri par nom, 20/musicien, seek sur le musicogramme, refonte visuelle)

## Demandes traitées

1. Treeview de gauche : **entrées pliées au démarrage** ;
2. **Tri par nom d'artiste** (Chopin, Mozart, …) ;
3. **20 musiques MIDI les plus connues pour chaque musicien** ;
4. **Supprimer la barre de défilement** sous le musicogramme ; avancer / reculer en
   manipulant **le trait de lecture** du musicogramme ;
5. Interface **« sexy et professionnelle »**.

## Constat initial (étape 1)

- Bug réel : `renderTree()` calculait `collapsed = !!state.collapsed[key]` → `false` par
  défaut → **tous les groupes étaient dépliés au démarrage** (contrairement à ce
  qu'annonçait la session 4).
- Tri : seuls 5-6 compositeurs avaient un alias « Nom, Prénom » ; les autres étaient
  triés par **prénom** (`Antonin Dvorak` sous A, `Johannes Brahms` sous J, `Joseph Haydn`
  sous J…) et Brahms était éclaté en 2 groupes (`Johannes Brahms Op 118…` sans séparateur).
- 20/compositeur atteint seulement pour Bach, Beethoven, Chopin, Mozart, Schubert.

## Étapes de travail (journal détaillé)

| # | Étape | Statut | Détail / résultat |
|---|-------|--------|-------------------|
| 1 | Relecture `ETAT_PROJET.md`, inventaire code + `midis/` | FAIT | 138 fichiers, bug de repli identifié, tri par prénom identifié |
| 2 | Inventaire du catalogue PD/CC0 par compositeur | FAIT | 1014 éditions ; voir « 20 par musicien » ci-dessous |
| 3 | `app.py` : normalisation des artistes | FAIT | `ARTIST_CANONICAL` (26 compositeurs, « Nom, Prénom »), `canonical_artist()` générique (« Prénom Nom » → « Nom, Prénom », particules van/von/de), `Traditional_X` → « Traditionnel (x) », clé de tri **sans accents** (`_plain`) → tri par **nom de famille** ; Brahms réunifié, `J_M_Bach_…` → « Bach, Johann Michael » |
| 4 | `fetch_composers_all20.py` (nouveau) | FAIT | 19 musiciens ciblés, priorité « œuvres célèbres » puis complément catalogue, dédoublonnage **SHA-256** contre `midis/`, SMF ≥ 20 notes, manifeste |
| 5 | `--dry-run` puis téléchargement réel | FAIT | **+204 fichiers** (138 → 342), 40 groupes ; détail ci-dessous |
| 6 | `static/js/pianoroll.js` réécrit | FAIT | musicogramme = contrôle de position : `timeAt(clientX)`, `isNearPlayhead()`, `setHover()` ; trait lumineux + poignées haut/bas, zone jouée teintée, notes en cours en surbrillance (dichotomie sur `t`), bandes touches noires, notes arrondies |
| 7 | `templates/index.html` refondu | FAIT | marque « Maestro », bibliothèque (recherche + puces déplier/replier) puis import ; scène : carte « En lecture » (titre + artiste + égaliseur animé), musicogramme 340 px (`role=slider`), transport à icônes SVG (arrêt / lecture / pause / reprendre) + temps + volume ; **barre `#progressBar` supprimée** ; case « Afficher le piano roll » supprimée (le musicogramme est désormais le contrôle de position) ; détails du fichier en `<details>` ; « À propos » replié en pied de page |
| 8 | `static/js/app.js` | FAIT | **repli par défaut** (`state.collapsed[key] !== false`), « Tout replier » = remise à zéro ; nom de famille en gras + prénom discret + pastille d'initiale ; recherche **sans accents** (`plain()`) ; groupe contenant le titre actif signalé ; badge « N œuvres · M artistes » ; artiste sous le titre en lecture ; **seek sur le musicogramme** : clic = saut, glisser du trait = aperçu (lecteur repositionné au relâchement), survol = ligne pointillée + infobulle de temps, `←`/`→` ±5 s, `Début`/`Fin` |
| 9 | `static/css/style.css` réécrit | FAIT | thème « studio » (graphite + dégradé violet → turquoise, verre dépoli), arbre à pastilles + filet de hiérarchie, transport à boutons ronds, curseurs personnalisés, toasts à liseré, `prefers-reduced-motion`, responsive 1000 / 640 px |
| 10 | Vérification navigateur réel (Chrome headless Windows, serveur temporaire port 5091 **arrêté après chaque passe**) | FAIT | voir vérifications ; 2 défauts trouvés et corrigés (étapes 11-12) |
| 11 | Correctif : groupes repliés mais visibles | FAIT | `display:flex` écrasait l'attribut `hidden` → règle globale `[hidden]{display:none!important}` |
| 12 | Correctif : responsive étroit | FAIT | badges backend/serveur masqués ≤ 1000 px, grille `minmax(0,1fr)` ; débordement mesuré : `scrollWidth 490 < innerWidth 500` (Chrome n'accepte pas moins de 500 px) |
| 13 | `README.md` + présent journal | FAIT | sections bibliothèque, position sur le musicogramme, réglages, vitesse (0,25×–2×, valeur réelle du curseur) |

## 20 œuvres par musicien — bilan (avant → après, plafond = catalogue PD/CC0)

| Atteint 20 | Bach, Beethoven, Chopin, Mozart, Schubert (session 4) ; **Burgmüller, Czerny, Schumann, Verdi** (session 5) |
|---|---|
| Catalogue épuisé (< 20) | Joplin 19, Haydn 17, Grieg 14, Mendelssohn 15, Tchaïkovski 14, Brahms 10, Sousa 10, Pezold 8, Clementi 7, Debussy 6, Dvořák 6, Vivaldi 5, Haendel 4, Liszt 4, Satie 3 |
| Hors quota | compositeurs absents du catalogue (Aberle, Davies, Godowsky, Lefébure-Wély, Marcailhou, Neumane, Smith, Turner, Zimmermann, J. M. Bach), airs traditionnels, démos |

## Ce qui a changé (session 5)

| Fichier | Changement |
|---|---|
| `app.py` | `ARTIST_CANONICAL`, `canonical_artist()`, `_plain()`, `artist_info()` réécrit (tri par nom de famille, Brahms / J. M. Bach / Traditionnel) |
| `fetch_composers_all20.py` | **nouveau** (19 musiciens, dédoublonnage SHA-256) |
| `midis/` | **+204 `.mid`** (342 au total) ; `SOURCES_MIDI.md` : section « Ajout `fetch_composers_all20.py` » |
| `templates/index.html` | refonte complète ; `#progressBar` et `#showRoll` **supprimés** |
| `static/js/app.js` | repli par défaut, affichage Nom/Prénom, recherche sans accents, seek sur le musicogramme |
| `static/js/pianoroll.js` | réécrit (contrôle de position + rendu) |
| `static/css/style.css` | réécrit |
| `README.md`, `ETAT_PROJET.md` | mis à jour |
| `flask_fallback.py`, `midi-parser.js`, `player.js`, `fetch_composers_20.py` | **inchangés** |

## Vérifications effectivement exécutées (session 5)

1. `python3 -m py_compile app.py fetch_composers_all20.py` → OK ; `node --check` sur les 4 JS → OK.
2. `list_midi_files()` / `group_midi_files()` : 342 fichiers, 40 groupes, ordre Aberle, Bach (J. M.), Bach (J. S.), Beethoven, Brahms, Burgmüller, Chopin, Clementi… → tri par nom **OK**.
3. Téléchargement : chaque fichier contrôlé (empreinte SHA-256 du catalogue, SMF 0/1, ≥ 20 notes, ≤ 5 Mo).
4. Chrome headless (vraie page, Flask 3.1.3 du `.venv`) :
   - démarrage : `groups=40 collapsed=40`, `#progressBar` absent → **OK** ;
   - clic Chopin › Fantaisie-Impromptu, appui à 30 %, glisser à 42 %, relâcher → `1:46 / 4:13` (42 % de 253 s = 106 s) → **seek OK** ; artiste « Frédéric Chopin » affiché ; groupe actif signalé ;
   - recherche « dvorak » → 1 groupe (« Dvořák »), 6 titres → **recherche sans accents OK** ;
   - captures 1440 px et mobile inspectées visuellement.
5. Serveur de test lancé en arrière-plan puis **arrêté** à chaque passe (port 5091 vérifié libre) ; aucun serveur laissé tourner.

## Limites de la session 5

- « 20 plus connues » : choix éditorial projeté sur un catalogue libre de droits ; 15 musiciens n'y ont pas 20 œuvres (tableau ci-dessus) — rien n'a été pris hors licences PD/CC0.
- Doublons d'édition déjà présents avant cette session conservés (ex. *Ballade n° 4* de Chopin en `F_F_Chopin` + `Chopin`) : rien n'a été supprimé.
- Le son n'a pas été écouté (headless) : le seek a été validé par la position et l'affichage, pas à l'oreille.
- Pendant un glisser du trait en lecture, le son continue à l'ancienne position jusqu'au relâchement (choix volontaire pour éviter un son haché).
- Pas de police web téléchargée (aucune dépendance externe) : pile système Inter / Segoe UI / system-ui.

---

# SESSION 6 — 2026-10-16 (documentation + publication GitHub)

## Demandes traitées

1. Mettre à jour la documentation ;
2. Pousser le projet sur GitHub (`yann-leschevin/Musique_Midi`, dépôt public, vide jusque-là).

## Ce qui a changé (session 6)

| Fichier | Changement |
|---|---|
| `README.md` | section « Installation et lancement » (clone, `source.sh` sur le port 5009, lancement direct sur 5002), note Flask actualisée (Flask 3.1.3 dans le `.venv`, repli `flask_fallback.py` toujours possible), arborescence complète (scripts `fetch_composers_*`, `source.sh`, 342 MIDI / 40 artistes), provenance des MIDI actualisée, limites actualisées |
| `ETAT_PROJET.md` | chemin local obsolète remplacé par l'URL du dépôt ; présente section |
| `requirements.txt` | **nouveau** : `flask` (facultatif) |
| `.gitignore` | **nouveau** : `.venv/`, `__pycache__/`, fichiers d'éditeur / système |
| Dépôt git | initialisé (branche `main`), premier commit, poussé sur `origin` |

Code applicatif : **inchangé**.

