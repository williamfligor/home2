# enable color support of ls and also add handy aliases
if [ -x /usr/bin/dircolors ]; then
    test -r ~/.dircolors && eval "$(dircolors -b ~/.dircolors)" || eval "$(dircolors -b)"
    alias ls='ls --color=auto'

    alias grep='grep --color=auto'
    alias fgrep='fgrep --color=auto'
    alias egrep='egrep --color=auto'
else
    export LSCOLORS=gxBxhxDxfxhxhxhxhxcxcx
fi

if command -v nvim > /dev/null 2>&1; then
    alias vi="nvim"
    alias vim="nvim"
fi

alias mv="mv -i";
alias cp="cp -i";
alias rm="rm -i";

alias l="ls -laFbh"
alias ldf='ls -laFbh | grep "^d" && ls -la | grep "^-" && ls -la | grep "^l"'
alias lg="lazygit"
alias gs="git status"

alias speedtest="wget -O /dev/null http://cachefly.cachefly.net/100mb.test";


# ZMX
alias zs='zmx-ssh'
alias zl='zmx-local'

# pi
alias pino="pi --no-session"
alias piw="pi --web-on"

# mise bootstrap dotfiles (replaces the chezmoi cz/cza/ccd era)
# full preview-and-capture workflow: status / diff / apply / unapply / add / edit
alias mb='mise bootstrap'
alias mbs='mise bootstrap dotfiles status'
alias mbd='mise bootstrap dotfiles diff'
alias mba='mise bootstrap dotfiles apply'
alias mbu='mise bootstrap dotfiles unapply'
alias mbadd='mise bootstrap dotfiles add'
alias mbed='mise bootstrap dotfiles edit'
