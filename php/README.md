# musique-midi — version PHP (OVH)

Lecteur MIDI « Maestro » : bibliothèque de 341 MIDI libres de droits, lecture et musicogramme dans le navigateur.

Portage de https://github.com/yann-leschevin/Musique_Midi (Flask → PHP).

## Arborescence
- `www/` : **seul dossier à envoyer** sur OVH (son contenu va dans `www/projets/musique-midi/` chez OVH).
- `tests/test.sh` : tests locaux (`bash tests/test.sh`, PHP + curl requis). Ne pas envoyer.
- `www/api/` : `health.php`, `midis.php` (liste), `midi.php?name=…` (un fichier), `upload.php` (envoi).
- `www/lib/` : `config.php` (réglages) et `midi.php` (fonctions) — accès web bloqué.
- `www/midis/` : les fichiers MIDI — accès web direct bloqué, ils passent par `api/midi.php`.
- `SOURCES_MIDI.md` : provenance et licence de chaque MIDI.

**Envoi de fichiers par les visiteurs : désactivé** (`UPLOAD_ENABLED = false` dans `www/lib/config.php`).
Sur un site public, n'importe qui pourrait remplir l'hébergement ou y déposer des fichiers protégés.
La lecture d'un MIDI depuis son propre ordinateur reste possible (rien n'est envoyé au serveur).
Si on l'active : le dossier `www/midis/` doit être inscriptible par PHP (droits 755, par défaut chez OVH).

Les scripts `fetch_*.py` / `make_demo_midi.py` du dépôt Python restent des outils à lancer sur le PC ;
on envoie ensuite les nouveaux MIDI dans `www/midis/` par FTP (et on complète `SOURCES_MIDI.md`).

Le fichier `J_M_Bach_Auf_lasst_uns_den_Herren_loben.mid` du dépôt n'est **pas repris** : sa provenance n'est pas documentée.

## Tester en local
```bash
php -S 127.0.0.1:18765 -t www     # puis http://127.0.0.1:18765/
bash tests/test.sh
```
Le serveur intégré de PHP ignore les `.htaccess` : ils ne s'appliqueront que chez OVH.
