# Please color the ls...
export CLICOLOR=1

export LC_CTYPE=$LANG
export GREP_COLOR='1;32'


# Escape key timeout?
export KEYTIMEOUT=1

# Fix gopass/ncurses stuff
export GPG_TTY=$(tty)

# Ensure tools in ~/.local/bin are in PATH
export PATH="$HOME/.local/bin:$PATH"

# Mise activation with shims
eval "$(mise activate zsh --shims)"

# Platform env files (mise.macos.toml / mise.linux.toml) auto-load from the
# current OS. Mise 2026.9.1 does not read .miserc.toml, so set it here (and in
# install.sh) — see ./.miserc.toml and MIGRATION.md implementation log.
export MISE_AUTO_ENV=true

if command -v nvim > /dev/null 2>&1; then
    export EDITOR="nvim"
    export VISUAL="nvim"
else
    export EDITOR="vim"
    export VISUAL="vim"
fi

export YSU_MESSAGE_POSITION="after"

# nono: don't ask to save profile rules on sandbox exit, but keep printing
# the denial list (the save prompt is separate from the diagnostic footer).
export NONO_NO_SAVE_PROMPT=1
