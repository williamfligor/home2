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

RUN mkdir -p /root/.local/share/chezmoi
COPY . /root/.local/share/chezmoi
RUN --mount=type=secret,id=github_token \
    GITHUB_TOKEN=$(cat /run/secrets/github_token) chezmoi init && \
    GITHUB_TOKEN=$(cat /run/secrets/github_token) chezmoi apply
