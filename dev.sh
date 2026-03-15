#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "Building frontend..."
cd "$ROOT/frontend"
npm run build

echo "Starting server → http://localhost:8000"
cd "$ROOT"
source venv/bin/activate
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
