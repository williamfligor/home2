#!/bin/bash
# vi: ft=bash
set -euo pipefail

echo "=== Building autossh ==="

# Only build if gcc is available
if ! command -v gcc &>/dev/null; then
    echo "gcc not found, skipping autossh build"
    exit 0
fi

AUTOSSH_DIR="$HOME/.local/share/mise/installs/http-autossh/latest"
AUTOSSH_BIN="$HOME/.local/bin/autossh"

if [ ! -d "$AUTOSSH_DIR" ]; then
    echo "autossh source not found at $AUTOSSH_DIR, skipping"
    exit 0
fi

# Build and install
cd "$AUTOSSH_DIR"

if [ ! -f "Makefile" ]; then
    if [ -f "configure" ]; then
        ./configure --prefix="$HOME/.local"
    elif command -v autoreconf &>/dev/null; then
        autoreconf -i
        ./configure --prefix="$HOME/.local"
    else
        echo "Neither configure nor autoreconf found, skipping"
        exit 0
    fi
fi

make && make install
echo "=== autossh built and installed ==="
