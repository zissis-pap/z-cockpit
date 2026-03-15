#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

# Check venv exists
if [ ! -f "$ROOT/venv/bin/activate" ]; then
  echo "Virtual environment not found. Run ./setup.sh first."
  exit 1
fi

source venv/bin/activate

MODE="${1:-prod}"

if [ "$MODE" = "dev" ]; then
  echo "=== Z-Cockpit DEV mode ==="
  echo "→ Backend:  http://localhost:8000 (API + WS)"
  echo "→ Frontend: http://localhost:5173 (Vite dev server)"
  echo ""
  # Start backend in background
  python -m backend.main &
  BACKEND_PID=$!
  # Start Vite dev server
  cd frontend && npm run dev
  kill "$BACKEND_PID" 2>/dev/null || true
else
  echo "=== Z-Cockpit ==="
  echo "→ Open: http://localhost:8000"
  echo ""
  python -m backend.main
fi
