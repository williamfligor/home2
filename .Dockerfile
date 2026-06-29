# syntax=docker/dockerfile:1
FROM ubuntu:24.04

RUN apt-get update && \
    apt-get install -y \
        git \
        sudo \
        curl  \
        bash \
        zsh \
        python3 \
        python3-pip \
        python3-venv \
    && rm -rf /var/lib/apt/lists/*

RUN curl -sfL https://git.io/chezmoi | sh

ENV HOME=/root
WORKDIR /root

# ── Pre-install mise tools ─────────────────────────────────
# Config is copied separately so this layer stays cached when
# only non-mise files change (e.g. .zshrc, neovim config).
# Cache mount avoids re-downloading archives on rebuild.
COPY dot_config/mise/config.toml /root/.local/share/chezmoi/dot_config/mise/config.toml
COPY mise.toml /root/.local/share/chezmoi/mise.toml
RUN --mount=type=secret,id=github_token \
    --mount=type=cache,target=/root/.cache/mise,sharing=locked \
    mkdir -p /root/.config/mise && \
    cp /root/.local/share/chezmoi/dot_config/mise/config.toml /root/.config/mise/config.toml && \
    cp /root/.local/share/chezmoi/mise.toml /root/mise.toml && \
    curl -fsSL https://mise.run | sh && \
    export PATH="$HOME/.local/bin:$PATH" && \
    GITHUB_TOKEN=$(cat /run/secrets/github_token) mise install --yes

# ── Apply dotfiles ──────────────────────────────────────────
COPY . /root/.local/share/chezmoi
RUN --mount=type=secret,id=github_token \
    --mount=type=cache,target=/root/.cache/mise,sharing=locked \
    GITHUB_TOKEN=$(cat /run/secrets/github_token) chezmoi init && \
    rm -f /root/.config/mise/config.toml && \
    GITHUB_TOKEN=$(cat /run/secrets/github_token) chezmoi apply
