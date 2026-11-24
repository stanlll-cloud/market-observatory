#!/usr/bin/env bash
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Starting Market Observatory Backend (port 8766)..."
(cd "$DIR/backend" && "$DIR/.venv/bin/uvicorn" main:app --host 127.0.0.1 --port 8766) &
BACK_PID=$!

echo "Starting Market Observatory Frontend (port 5173)..."
(cd "$DIR/frontend" && npm run dev -- --port 5173) &
FRONT_PID=$!

trap 'kill $BACK_PID $FRONT_PID 2>/dev/null || true' EXIT INT TERM
sleep 2
open "http://localhost:5173" 2>/dev/null || true
wait
