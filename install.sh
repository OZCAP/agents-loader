#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="${LAG_INSTALL_DIR:-}"

if [ -z "$TARGET_DIR" ]; then
  for candidate in "$HOME/.local/bin" "/usr/local/bin" "/opt/homebrew/bin"; do
    if [ -d "$candidate" ] && [ -w "$candidate" ]; then
      TARGET_DIR="$candidate"
      break
    fi
  done
  if [ -z "$TARGET_DIR" ]; then
    TARGET_DIR="$HOME/.local/bin"
  fi
fi

mkdir -p "$TARGET_DIR"

if ! command -v bun >/dev/null 2>&1; then
  echo "bun is required to build lag. Install Bun first." >&2
  exit 1
fi

bun build --compile "$ROOT_DIR/index.ts" --outfile "$TARGET_DIR/lag"

echo "Installed lag to $TARGET_DIR/lag"
