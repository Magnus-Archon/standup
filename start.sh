#!/usr/bin/env bash
# Standup – start everything with one command
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
FRONTEND="$ROOT/frontend"
BACKEND="$ROOT/backend"

echo ""
echo "  ╔═══════════════════════════════════╗"
echo "  ║         🎤  S T A N D U P        ║"
echo "  ║   Video meetings · Smart notes    ║"
echo "  ╚═══════════════════════════════════╝"
echo ""

# Check Python
if ! command -v python3 &>/dev/null; then
  echo "❌ Python 3 is required. Install from https://python.org"
  exit 1
fi

# Check Node
if ! command -v node &>/dev/null; then
  echo "❌ Node.js is required. Install from https://nodejs.org"
  exit 1
fi

# Install Python deps
echo "📦 Installing Python dependencies..."
pip install -r "$ROOT/requirements.txt" -q 2>&1 || \
  pip install -r "$ROOT/requirements.txt" -q --break-system-packages 2>&1

# Install Node deps
echo "📦 Installing frontend dependencies..."
cd "$FRONTEND" && npm install -q 2>&1 | tail -1

echo ""
echo "✅ Dependencies ready"
echo "🚀 Starting Standup..."
echo "   → http://localhost:8000"
echo ""

cd "$BACKEND"
python3 main.py
