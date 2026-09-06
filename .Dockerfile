# syntax=docker/dockerfile:1
FROM ubuntu:24.04

RUN apt-get update && \
    apt-get install -y \
        git \
        sudo \
        curl \
        bash \
        zsh \
        python3 \
        python3-pip \
        python3-venv \
        build-essential \
    && rm -rf /var/lib/apt/lists/*

ENV HOME=/root
WORKDIR /root

# ── Install mise ─────────────────────────────────────────────
# install.sh equivalent: curl mise.run | sh → ~/.local/bin/mise
RUN curl -fsSL https://mise.run | sh && \
    export PATH="$HOME/.local/bin:$PATH" && \
    mise --version | head -1

# ── Stage config files as the global config dir ─────────────
# Mirrors `mise bootstrap --from-git`: the repo is cloned into ~/.config/mise
# and its mise.toml IS the global config. Config files are copied first so the
# tool-install layer below stays cached when only dotfiles/scripts change.
COPY mise.toml mise.linux.toml mise.macos.toml mise.android.toml .miserc.toml /root/.config/mise/
RUN --mount=type=secret,id=github_token \
    --mount=type=cache,target=/root/.cache/mise,sharing=locked \
    export PATH="$HOME/.local/bin:$PATH" && \
    GITHUB_TOKEN=$(cat /run/secrets/github_token) mise install --yes

# ── Full repo (dotfiles + scripts) + full bootstrap ─────────
# Tools converge instantly (layer above); this RUN applies dotfiles, runs the
# post-tools hook (pi ext deps) and the bootstrap final task (ssh key, autossh,
# grill-me), exactly as a fresh machine.
COPY . /root/.config/mise/
RUN --mount=type=secret,id=github_token \
    --mount=type=cache,target=/root/.cache/mise,sharing=locked \
    export PATH="$HOME/.local/bin:$PATH" && \
    GITHUB_TOKEN=$(cat /run/secrets/github_token) MISE_AUTO_ENV=true mise bootstrap --yes