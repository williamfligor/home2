#!/bin/bash

podman build -t chezmoi-test .
podman run \
    --rm \
    -it \
    -v ~/.local/share/chezmoi:/root/.local/share/chezmoi \
    chezmoi-test
