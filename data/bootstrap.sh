#!/bin/bash

set -xe

mkdir -p ~/.config/bootstrap/
mkdir -p ~/.local/bin/

if [ -z ${MACHINE_NAME+x} ]; then
    read -p 'Enter Machine Name: ' MACHINE_NAME
fi

if [ ! -f $HOME/.ssh/id_rsa ]
then
    mkdir -p ~/.ssh/
    ssh-keygen -t rsa -b 2048 -C "$MACHINE_NAME" -f $HOME/.ssh/id_rsa -N ""
fi

# Install Chezmoi
curl -sfL https://git.io/chezmoi | sh

git config --global user.email "williamtfligor@gmail.com"
git config --global user.name "William Fligor"

export PATH="$HOME/.local/bin:$PATH"
