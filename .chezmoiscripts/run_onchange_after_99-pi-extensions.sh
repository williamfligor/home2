#!/bin/bash
# vi: ft=bash
set -euo pipefail

echo "=== Installing pi extension dependencies ==="

# Ensure mise-managed node/npm is in PATH
export PATH="$HOME/.local/bin:$PATH"
eval "$(mise activate bash)"

# Install npm dependencies for extensions that have a package.json
for dir in ~/.pi/agent/extensions/*/; do
    if [[ -f "$dir/package.json" ]]; then
        echo "Installing deps for $(basename "$dir")..."
        (cd "$dir" && npm install --no-audit --no-fund 2>&1 | tail -1)
    fi
done

echo "=== Done ==="
