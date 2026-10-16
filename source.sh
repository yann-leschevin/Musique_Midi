#!/bin/bash

PROJECT_DIR="$(pwd)"
cd "$PROJECT_DIR" || exit 1

VENV_DIR=".venv"
VENV_PYTHON="$VENV_DIR/bin/python3"

# Port dédié à ce projet (5003, puis 5005 → 5016 ; 5004 évité : bloqué en localhost sous WSL mirrored)
PORT=5009
HOST="0.0.0.0"

# Fonction pour (re)créer un venv propre
create_venv() {
    echo "👉 Création de l'environnement virtuel..."
    python3 -m venv "$VENV_DIR" || {
        echo "❌ Impossible de créer le venv. Vérifie que python3-venv est installé :"
        echo "   sudo apt install python3-venv python3-full"
        exit 1
    }
}

# Vérifie que le venv existe et est fonctionnel
if [ ! -d "$VENV_DIR" ] || [ ! -x "$VENV_PYTHON" ]; then
    echo "❌ Environnement virtuel introuvable ou incomplet."
    rm -rf "$VENV_DIR"
    create_venv
fi

# Activation du venv
source "$VENV_DIR/bin/activate"

# Vérification que le python actif est bien celui du venv
ACTIVE_PYTHON="$(which python3)"
if [[ "$ACTIVE_PYTHON" != "$PROJECT_DIR/$VENV_DIR"* ]]; then
    echo "⚠️  Le venv semble corrompu (python3 pointe vers $ACTIVE_PYTHON)."
    echo "👉 Recréation du venv..."
    deactivate 2>/dev/null
    rm -rf "$VENV_DIR"
    create_venv
    source "$VENV_DIR/bin/activate"
fi

echo "✅ Projet Musique_midi"
echo "📁 $(pwd)"
echo "🐍 Python : $(which python3)"

# Mise à jour de pip (évite pas mal de soucis d'installation)
python3 -m pip install --upgrade pip >/dev/null 2>&1

# Test de Flask
if python3 -c "import flask" 2>/dev/null; then
    FLASK_VERSION=$(python3 -c "import flask; print(flask.__version__)" 2>/dev/null)
    echo "🌐 Flask : installé (version $FLASK_VERSION)"
else
    echo "❌ Flask n'est pas installé dans le .venv."
    echo "👉 Installation de Flask..."

    python3 -m pip install flask || {
        echo "❌ Échec de l'installation de Flask."
        exit 1
    }

    FLASK_VERSION=$(python3 -c "import flask; print(flask.__version__)" 2>/dev/null)
    echo "✅ Flask installé (version $FLASK_VERSION)"
fi

# ─── Lancement sur le port dédié au projet ─────────────────────────────
# HOST=0.0.0.0 : accessible depuis Windows et le réseau local (voir openport.txt).
# Les variables d'environnement couvrent les noms lus par les différentes apps.
export HOST PORT
export YANNDB_HOST="$HOST" YANNDB_PORT="$PORT"
export NETMAP_HOST="$HOST" NETMAP_PORT="$PORT"

if ss -ltn 2>/dev/null | grep -qE "[:.]$PORT\b"; then
    echo "❌ Le port $PORT est déjà utilisé. Arrête l'autre serveur ou change PORT dans source.sh."
    exit 1
fi

echo "🚀 Serveur sur http://localhost:$PORT"
echo

if grep -qE "environ\.get\(['\"](PORT|YANNDB_PORT|NETMAP_PORT)['\"]" app.py; then
    # L'application lit déjà le port depuis l'environnement : lancement normal
    # (conserve son initialisation propre au bloc __main__).
    exec "$VENV_PYTHON" app.py
else
    # Port codé en dur dans app.py : on l'impose via « flask run ».
    exec "$VENV_PYTHON" -m flask --app app run --host "$HOST" --port "$PORT"
fi
