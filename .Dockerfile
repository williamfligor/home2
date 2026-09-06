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

# ── Install mise (install.sh does this on a fresh machine) ───
RUN curl -fsSL https://mise.run | sh && \
    export PATH="$HOME/.local/bin:$PATH" && \
    mise --version | head -1

# ── Cache layer: install [tools] from a throwaway config so the tool-install
#    work is not repeated when only dotfiles/scripts change. Uses
#    MISE_GLOBAL_CONFIG_FILE so ~/.config/mise stays EMPTY (install.sh's
#    `git clone` below requires an empty/nonexistent target). Tools land in
#    $MISE_DATA_DIR and persist into the install.sh bootstrap stage.
COPY mise.toml mise.linux.toml mise.macos.toml mise.android.toml /tmp/cfg/
RUN --mount=type=secret,id=github_token \
    --mount=type=cache,target=/root/.cache/mise,sharing=locked \
    export PATH="$HOME/.local/bin:$PATH" && \
    mise trust /tmp/cfg/mise.toml >/dev/null 2>&1 ; \
    GITHUB_TOKEN=$(cat /run/secrets/github_token) MISE_GLOBAL_CONFIG_FILE=/tmp/cfg/mise.toml \
        MISE_AUTO_ENV=true mise install --yes

# ── Run the REAL fresh-machine installer against this checkout ──
# install.sh: clone repo → ~/.config/mise (repo mise.toml becomes the global
# config, matching the future `--from-git`), then `mise bootstrap --yes`
# (dotfiles → tools converge → post-tools hook → final task).
COPY . /tmp/home2/
RUN cd /tmp/home2 && \
    git init -q && \
    git -c user.email=ci@localhost -c user.name=ci add -A && \
    git -c user.email=ci@localhost -c user.name=ci commit -qm "context" && \
    export PATH="$HOME/.local/bin:$PATH" && \
    bash /tmp/home2/install.sh /tmp/home2