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

if [ ! -f $HOME/.local/bin/chezmoi ]
then
    if [[ "$OSTYPE" == "darwin"* ]]; then
        curl -L -f -o ~/.local/bin/chezmoi https://github.com/twpayne/chezmoi/releases/download/v2.58.0/chezmoi-darwin-arm64
    else
        curl -L -f -o ~/.local/bin/chezmoi https://github.com/twpayne/chezmoi/releases/download/v2.58.0/chezmoi-linux-amd64
    fi

    chmod +x ~/.local/bin/chezmoi
fi

git config --global user.email "williamtfligor@gmail.com"
git config --global user.name "William Fligor"

# Fixes for gopass gpg keys
export GPG_TTY=$(tty)
if command -v gpg-connect-agent &> /dev/null
then
    gpg-connect-agent updatestartuptty /bye
fi

export PATH="$HOME/.local/bin:$PATH"
