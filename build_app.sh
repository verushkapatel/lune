#!/usr/bin/env bash
# Build the downloadable Lune app for the machine you run this on.
#
#   macOS    -> dist/Lune.app
#   Windows  -> dist/Lune/Lune.exe
#   Linux    -> dist/Lune/Lune
#
# PyInstaller cannot cross-compile, so each platform's build has to be produced
# on that platform.

set -euo pipefail

cd "$(dirname "$0")"

if [ ! -d .venv ]; then
  echo "No .venv found. Run ./run.sh once first to create it."
  exit 1
fi

source .venv/bin/activate

echo "Installing build dependencies..."
pip install -q -r requirements.txt
pip install -q pywebview pyinstaller

# A stray .env inside the bundle would ship your personal API key to everyone
# who downloads the app.
if [ -f .env ] && grep -qE '^[[:space:]]*(OPENAI|ANTHROPIC)_API_KEY=.+' .env; then
  echo
  echo "Note: .env contains an API key. It is NOT bundled into the app —"
  echo "      each person who installs Lune signs in and adds their own key."
  echo
fi

echo "Building..."
rm -rf build dist
pyinstaller --noconfirm --clean lune.spec

echo
if [ -d "dist/Lune.app" ]; then
  echo "Built dist/Lune.app"
  echo "Zip it for distribution:  ditto -c -k --keepParent dist/Lune.app Lune-mac.zip"
else
  echo "Built dist/Lune"
fi
