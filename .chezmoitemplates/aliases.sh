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

# chezmoi aliases
alias cz="chezmoi"
alias cza="chezmoi apply"
alias czad="chezmoi add"
alias czadd="chezmoi add"
alias czs="chezmoi status"
alias czd="chezmoi diff"
alias czra="chezmoi re-add"
alias czm="chezmoi merge"
alias czma="chezmoi merge-all"
alias czet="chezmoi execute-template"

# ZMX
alias zl='zmx-local-new'
alias zla='zmx-local-attach'
alias zs='zmx-ssh-new'
alias zsa='zmx-ssh-attach'
