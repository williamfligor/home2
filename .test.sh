#!/bin/bash
set -euo pipefail

# Detect container runtime (podman preferred, docker fallback)
if command -v podman &>/dev/null; then
    RUNNER=podman
elif command -v docker &>/dev/null; then
    RUNNER=docker
else
    echo "ERROR: Neither podman nor docker found" >&2
    exit 1
fi
echo "Using $RUNNER"

# Use buildx for --secret support
# Use BuildKit cache mount when available (GitHub Actions restores to /tmp/.buildx-cache).
# Docker BuildKit syntax only — podman/buildah don't support type=local cache.
CACHE_ARGS=()
if [ "$RUNNER" = "docker" ] && [ -d /tmp/.buildx-cache ]; then
    CACHE_ARGS=(--cache-from=type=local,src=/tmp/.buildx-cache --cache-to=type=local,dest=/tmp/.buildx-cache,mode=max)
fi
$RUNNER buildx build \
    --load \
    --progress=plain \
    "${CACHE_ARGS[@]}" \
    --secret "id=github_token,env=GITHUB_TOKEN" \
    -t chezmoi-test -f .Dockerfile . # 2>&1 | tail -50

# ── Smoke test: mise ─────────────────────────────────────────────
echo ""
echo "=== Mise smoke test ==="
$RUNNER run --rm chezmoi-test zsh -ic '
    echo "[1] mise binary..."
    if command -v mise &>/dev/null; then
        echo "  ✓ mise $(mise --version 2>&1 | head -1)"
    else
        echo "  ✗ mise not found in PATH"
    fi

    echo "[2] mise tools installed..."
    for tool in fd rg eza bat fzf tmux zoxide delta; do
        if command -v "$tool" &>/dev/null; then
            echo "  ✓ $tool ($(which "$tool"))"
        else
            echo "  ✗ $tool MISSING"
        fi
    done

    echo "[3] mise which check..."
    mise which fd 2>/dev/null && echo "  ✓ mise which fd works" || echo "  ✗ mise which fd failed"

    echo "=== mise smoke test complete ==="
' 2>&1 | grep -v "bindkey\|tput\|zle\|zsh:"

# ── Smoke test: neovim + lazy.nvim ─────────────────────────────
echo ""
echo "=== Neovim smoke test (zsh session) ==="
$RUNNER run --rm chezmoi-test zsh -ic '

    echo "[1] neovim binary..."
    nvim --version | head -1

    echo "[2] bootstrap lazy.nvim + install plugins..."
    nvim --headless "+Lazy! sync" +qa 2>&1 | tee /tmp/lazy-sync.log | tail -15 || true

    echo "[3] clean startup check..."
    nvim --headless -c "lua print(\"startup OK\")" -c "quit" 2>&1 | tee /tmp/nvim-startup.log

    echo "[4] mise-installed plugin dirs..."
    for plugin in lazy-nvim nvim-lspconfig blink-cmp sidekick-nvim snacks-nvim; do
        dir="$HOME/.local/share/mise/installs/http-$plugin/latest"
        if [ -d "$dir" ]; then
            echo "  ✓ http-$plugin ($dir)"
        else
            echo "  ✗ http-$plugin MISSING"
        fi
    done

    echo "[5] plugin loadability..."
    for plugin in lazy lspconfig blink.cmp sidekick snacks; do
        result=$(nvim --headless -c "lua local ok, e = pcall(require, \"$plugin\"); if ok then print(\"✓ $plugin loaded\") else print(\"✗ \" .. tostring(e):gsub(\"\\n\",\" \")) end" -c "quit" 2>&1 | grep -E "^[✓✗]")
        echo "  $result"
    done

    echo "[6] lockfile..."
    if [ -f "$HOME/.config/nvim/lazy-lock.json" ]; then
        count=$(grep -oP '^\s*"\K[^"]+' "$HOME/.config/nvim/lazy-lock.json" | sort -u | wc -l)
        echo "  ✓ lazy-lock.json ($count entries)"
    else
        echo "  ✗ lazy-lock.json MISSING"
    fi

    echo "[7] error scan..."
    errors=$(grep -E "Error |E[0-9]+:" /tmp/nvim-startup.log 2>/dev/null | grep -iv "blink.cmp" | grep -iv "cargo" || true)
    if [ -n "$errors" ]; then
        echo "  ⚠ errors found:"
        echo "$errors" | sed "s/^/    /"
    else
        echo "  ✓ no startup errors"
    fi

    echo ""
    echo "=== smoke test complete ==="
' 2>&1 | grep -v "bindkey\|tput\|zle\|zsh:"

if [ -t 0 ]; then
    echo ""
    echo "Dropping into interactive container..."
    $RUNNER run \
        --rm \
        -it \
        -v ~/.local/share/chezmoi:/root/.local/share/chezmoi \
        chezmoi-test
fi
