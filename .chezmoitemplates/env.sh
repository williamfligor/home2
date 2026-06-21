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

if command -v nvim > /dev/null 2>&1; then
    export EDITOR="nvim"
    export VISUAL="nvim"
else
    export EDITOR="vim"
    export VISUAL="vim"
fi

export YSU_MESSAGE_POSITION="after"
