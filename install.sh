#!/bin/bash
# vi: ft=bash
set -euo pipefail

# Home2 fresh-machine bootstrap (chezmoi → mise bootstrap migration).
#
#   curl -fsSL https://raw.githubusercontent.com/williamfligor/home2/main/install.sh | bash
#
# 1. Installs mise (mise.run installer → ~/.local/bin/mise) if absent.
# 2. Clones this repo into ~/.config/mise so its repo-root mise.toml IS the
#    GLOBAL mise config (dotfiles, tools, hooks, final task all live there).
#    This is the released realization of `mise bootstrap --from-git` — the flag
#    itself is documented-but-unreleased as of mise 2026.9.1 (the current latest),
#    and it will clone into ~/.config/mise exactly as this script does.
# 3. Runs `mise bootstrap --yes`: dotfiles (symlinks) → [tools] → post-tools hook
#    (pi extension deps) → final hook.
#
# The repo is PUBLIC; never commit credentials. (If it ever goes private, generate
# ~/.ssh/id_rsa BEFORE this script clones — see MIGRATION.md decision #11.)
#
# Optional arg 1 = repo URL/path to clone (defaults to the public GitHub repo;
# the Docker smoke test passes the local checkout so it exercises this exact
# script without depending on a pushed remote).

REPO_URL="${1:-https://github.com/williamfligor/home2}"
CONFIG_DIR="${HOME}/.config/mise"

if [[ ! -x "${HOME}/.local/bin/mise" ]]; then
    echo "=== Installing mise ==="
    curl -fsSL https://mise.run | sh
else
    echo "=== mise already installed at ${HOME}/.local/bin/mise ==="
fi
export PATH="${HOME}/.local/bin:$PATH"

if [[ -d "${CONFIG_DIR}" ]] && [[ ! -d "${CONFIG_DIR}/.git" ]]; then
    echo "ERROR: ${CONFIG_DIR} exists and is not a git clone of this repo." >&2
    echo "       Move it aside (e.g. mv ${CONFIG_DIR} ${CONFIG_DIR}.old) or remove it," >&2
    echo "       then re-run this script. Existing mise config is never destroyed automatically." >&2
    exit 1
fi

if [[ ! -d "${CONFIG_DIR}/.git" ]]; then
    echo "=== Cloning ${REPO_URL} into ${CONFIG_DIR} ==="
    git clone --depth 1 "${REPO_URL}" "${CONFIG_DIR}"
else
    echo "=== Updating existing config clone in ${CONFIG_DIR} ==="
    git -C "${CONFIG_DIR}" fetch --depth 1 origin
    git -C "${CONFIG_DIR}" reset --hard origin/HEAD
fi

echo "=== mise bootstrap --yes ==="
# auto_env enables the platform env files (mise.linux.toml, ...). Set here AND
# in ~/.config/zsh/env.sh — mise 2026.9.1 doesn't read .miserc.toml yet.
MISE_AUTO_ENV=true mise bootstrap --yes

echo ""
echo "Done. Open a new shell (env.sh activates mise via ~/.zshenv)."
echo "macOS: run `mise run install-macos-apps` after first login to install .app bundles"
