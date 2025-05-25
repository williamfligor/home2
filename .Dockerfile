FROM ubuntu:24.04

RUN apt-get update && \
    apt-get install -y \
        git \
        sudo \
        curl  \
        bash  \
        python3 \
        python3-pip \
        python3-venv \
    && rm -rf /var/lib/apt/lists/*

RUN curl -sfL https://git.io/chezmoi | sh

ENV HOME=/root
WORKDIR /root

# CMD chezmoi init && chezmoi apply && bash
