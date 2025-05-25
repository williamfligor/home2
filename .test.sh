#!/bin/bash

podman build -t chezmoi-test -f .Dockerfile .
podman run \
    --rm \
    -it \
    -v ~/.local/share/chezmoi:/root/.local/share/chezmoi \
    chezmoi-test
