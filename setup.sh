#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

echo "=== Z-Cockpit Setup ==="

# ── Python venv ──────────────────────────────────────────────────────────────
echo ""
echo "→ Creating Python virtual environment at $ROOT/venv"
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip -q
pip install -r requirements.txt

# ── Node / npm ───────────────────────────────────────────────────────────────
echo ""
echo "→ Installing frontend dependencies"
cd frontend
npm install

# ── Build frontend ───────────────────────────────────────────────────────────
echo ""
echo "→ Building React frontend (output → backend/static/)"
npm run build
cd "$ROOT"

echo ""
echo "=== Setup complete! ==="
echo ""
echo "To start the server:"
echo "  source venv/bin/activate && python -m backend.main"
echo ""
echo "Or use:  ./start.sh"
