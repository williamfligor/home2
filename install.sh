#!/bin/bash
# vi: ft=bash
set -euo pipefail

# Home2 fresh-machine bootstrap (chezmoi → mise bootstrap migration).
#
#   curl -fsSL https://raw.githubusercontent.com/williamfligor/home2/main/install.sh | bash
#
# 1. Installs mise (mise.run installer → ~/.local/bin/mise) if absent.
# 2. Runs `mise bootstrap --from-git`: clones this repo into ~/.config/mise and
#    treats its repo-root mise.toml as the GLOBAL config. Bootstrap then applies
#    dotfiles (symlinks), installs [tools], runs the post-tools hook (pi
#    extension deps), and the final task (per-machine ssh key, autossh build,
#    grill-me skill fetch) — in that order.
#
# The repo is PUBLIC (keys are generated per-machine by the bootstrap task and
# never committed). If it ever goes private, generate ~/.ssh/id_rsa BEFORE this
# script runs so the clone can authenticate (see MIGRATION.md decision #11).

REPO="williamfligor/home2"

if ! command -v mise &>/dev/null && [[ ! -x "$HOME/.local/bin/mise" ]]; then
    echo "=== Installing mise ==="
    curl -fsSL https://mise.run | sh
fi
export PATH="$HOME/.local/bin:$PATH"

echo "=== mise bootstrap --from-git $REPO ==="
# auto_env enables the platform env files (mise.linux.toml, ...). Set here AND
# in ~/.config/zsh/env.sh — mise 2026.9.1 doesn't read .miserc.toml yet.
MISE_AUTO_ENV=true mise bootstrap --from-git "$REPO" --yes

echo ""
echo "Done. Open a new shell (env.sh activates mise via ~/.zshenv)."
echo "Post-bootstrap steps you may want:"
echo "  - add the generated key to GitHub: cat ~/.ssh/id_rsa.pub"
echo "  - macOS: re-run ~/.local/bin/install-macos-apps after first login"
