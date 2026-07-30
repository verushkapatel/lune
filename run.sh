#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d ".venv" ]; then
  echo "Creating virtual environment..."
  python3 -m venv .venv
fi

source .venv/bin/activate
pip install -q --upgrade pip
pip install -q -r requirements.txt

echo ""
echo "Lune is running at http://127.0.0.1:8000"
echo "Create an account in the app, then add your API key in Settings."
echo ""
exec uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
