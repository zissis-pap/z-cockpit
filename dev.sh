#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

# Stop any running uvicorn on port 8000
if lsof -ti tcp:8000 &>/dev/null; then
    echo "Stopping existing server on port 8000..."
    lsof -ti tcp:8000 | xargs kill 2>/dev/null || true
fi

echo "Building frontend..."
cd "$ROOT/frontend"
npm run build

echo "Starting server → http://localhost:8000"
cd "$ROOT"
source venv/bin/activate
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
