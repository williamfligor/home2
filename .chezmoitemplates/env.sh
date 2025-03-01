# Please color the ls...
export CLICOLOR=1

export LC_CTYPE=$LANG
export GREP_COLOR='1;32'


# Escape key timeout?
export KEYTIMEOUT=1

# Fix gopass/ncurses stuff
export GPG_TTY=$(tty)

# Ensure toolls in ~/.local/bin are in PATH
export PATH="$HOME/.local/bin/:$PATH"
export PATH="$HOME/.local/bin/golang/bin/:$PATH"
export PATH="$HOME/.local/bin/git-fuzzy/bin/:$PATH"
export PATH="$HOME/.local/bin/nvim/bin/:$PATH"
export PATH="$HOME/go/bin/:$PATH"
export PATH="$HOME/.cargo/bin:$PATH"

if command -v nvim > /dev/null 2>&1; then
    export EDITOR="nvim"
    export VISUAL="nvim"
else
    export EDITOR="vim"
    export VISUAL="vim"
fi

export YSU_MESSAGE_POSITION="after"
