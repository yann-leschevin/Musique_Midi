#!/usr/bin/env bash
# Tests locaux : lance le serveur PHP intégré sur www/ puis vérifie les pages.
# Usage : bash tests/test.sh   (depuis le dossier du projet)
# NB : le serveur intégré de PHP ignore les .htaccess (ils seront actifs chez OVH).
set -u
cd "$(dirname "$0")/.."
WWW="${WWW:-www}"
PORT="${PORT:-18765}"
BASE="http://127.0.0.1:$PORT"
if curl -s --max-time 10 -o /dev/null "$BASE/"; then echo "Port $PORT déjà utilisé : relancer avec PORT=xxxx bash tests/test.sh"; exit 2; fi
php -S 127.0.0.1:$PORT -t "$WWW" >/dev/null 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT
for _ in $(seq 50); do curl -s --max-time 10 -o /dev/null "$BASE/" && break; sleep 0.1; done
OK=0; KO=0
check() { # description, commande
    if eval "$2" >/dev/null 2>&1; then echo "  OK  $1"; OK=$((OK+1)); else echo "  KO  $1"; KO=$((KO+1)); fi
}
code() { curl -s --max-time 10 -o /dev/null -w '%{http_code}' "$@"; }
body() { curl -s --max-time 10 "$@"; }
J() { php -r '$j=json_decode(stream_get_contents(STDIN),true); exit(('"$1"') ? 0 : 1);'; }
MIDI_OK=$(ls "$WWW/midis" | grep -m1 '^Mozart')
echo "musique-midi"
check "index 200"                       '[ "$(code $BASE/)" = 200 ]'
check "chemins static relatifs"         'body $BASE/ | grep -q "src=\"static/js/app.js\""'
for js in app player pianoroll midi-parser; do
  check "JS $js valide et servi"        "node --check $WWW/static/js/$js.js && [ \"\$(code $BASE/static/js/$js.js)\" = 200 ]"
done
check "health : backend php"            'body $BASE/api/health.php | J "\$j[\"ok\"]===true && \$j[\"backend\"]===\"php\""'
check "health : upload désactivé"       'body $BASE/api/health.php | J "\$j[\"upload_enabled\"]===false"'
check "midis : 341 fichiers groupés"    'body $BASE/api/midis.php | J "count(\$j[\"files\"])===341 && array_sum(array_column(\$j[\"groups\"],\"count\"))===341"'
check "midis : Beethoven regroupé"      'body $BASE/api/midis.php | J "count(array_filter(\$j[\"groups\"],fn(\$g)=>\$g[\"artist\"]===\"Beethoven, Ludwig van\"))===1"'
check "midi : fichier servi (MThd)"     '[ "$(curl -s --max-time 10 -G --data-urlencode "name=$MIDI_OK" $BASE/api/midi.php | head -c4)" = MThd ]'
check "midi : type audio/midi"          'curl -s --max-time 10 -D- -o /dev/null -G --data-urlencode "name=$MIDI_OK" $BASE/api/midi.php | grep -qi "content-type: audio/midi"'
check "midi : traversal refusé (400)"   '[ "$(code "$BASE/api/midi.php?name=..%2Flib%2Fconfig.php")" = 400 ]'
check "midi : mauvaise extension (400)" '[ "$(code "$BASE/api/midi.php?name=index.php")" = 400 ]'
check "midi : inconnu (404)"            '[ "$(code "$BASE/api/midi.php?name=absent.mid")" = 404 ]'
check "midi : POST refusé (405)"        '[ "$(code -X POST "$BASE/api/midi.php?name=EMPEROR.mid")" = 405 ]'
check "upload : refusé si désactivé"    '[ "$(code -X POST -H "X-File-Name: x.mid" --data-binary @"$WWW/midis/$MIDI_OK" $BASE/api/upload.php)" = 403 ]'

# Upload activé : sur une copie temporaire de www/ (la vraie n'est pas modifiée)
if [ "${SANS_UPLOAD:-0}" != 1 ]; then
  TMP=$(mktemp -d); cp -r "$WWW" "$TMP/www"
  sed -i 's/const UPLOAD_ENABLED = false;/const UPLOAD_ENABLED = true;/' "$TMP/www/lib/config.php"
  echo "Upload activé (copie temporaire)"
  kill $SRV 2>/dev/null; wait $SRV 2>/dev/null
  php -S 127.0.0.1:$PORT -t "$TMP/www" >/dev/null 2>&1 & SRV=$!
  for _ in $(seq 50); do curl -s --max-time 10 -o /dev/null "$BASE/" && break; sleep 0.1; done
  printf 'MThd\0\0\0\6\0\0\0\1\0\140MTrk\0\0\0\4\0\377\57\0' > "$TMP/ok.mid"
  check "upload : MIDI valide accepté"   'body -X POST -H "X-File-Name: Test_Envoi.mid" --data-binary @"$TMP/ok.mid" $BASE/api/upload.php | J "\$j[\"ok\"]===true" && [ -f "$TMP/www/midis/Test_Envoi.mid" ]'
  check "upload : faux MIDI refusé"      '[ "$(code -X POST -H "X-File-Name: faux.mid" --data-binary "hello world, pas un midi" $BASE/api/upload.php)" = 400 ]'
  check "upload : .php refusé"           '[ "$(code -X POST -H "X-File-Name: shell.php" --data-binary @"$TMP/ok.mid" $BASE/api/upload.php)" = 400 ] && [ ! -e "$TMP/www/midis/shell.php" ]'
  check "upload : chemin refusé"         '[ "$(code -X POST -H "X-File-Name: ../x.mid" --data-binary @"$TMP/ok.mid" $BASE/api/upload.php)" = 400 ]'
  head -c 6000000 /dev/zero > "$TMP/gros.mid"
  check "upload : > 5 Mo refusé (413)"   '[ "$(code -X POST -H "X-File-Name: gros.mid" --data-binary @"$TMP/gros.mid" $BASE/api/upload.php)" = 413 ]'
  rm -rf "$TMP"
fi
echo "$OK réussi(s), $KO échec(s)"; [ $KO -eq 0 ]
