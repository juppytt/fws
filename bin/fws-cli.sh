#!/usr/bin/env bash
# Wrapper that runs fws.ts via tsx without requiring a build step
SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
exec "$SCRIPT_DIR/../node_modules/.bin/tsx" "$SCRIPT_DIR/fws.ts" "$@"
