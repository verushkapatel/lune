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
echo "Lune score coach is running at http://127.0.0.1:8000"
echo "Click Play the demo — no account or API key needed."
echo ""
exec uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
