# enable color support of ls and also add handy aliases
if [ -x /usr/bin/dircolors ]; then
    test -r ~/.dircolors && eval "$(dircolors -b ~/.dircolors)" || eval "$(dircolors -b)"
    alias ls='ls --color=auto'

    alias grep='grep --color=auto'
    alias fgrep='fgrep --color=auto'
    alias egrep='egrep --color=auto'
fi

alias mv="mv -i";
alias cp="cp -i";
alias rm="rm -i";

alias l="ls -laFbh"
alias lg="lazygit"
alias gs="git status"
alias lg="lazygit"

alias speedtest="wget -O /dev/null http://cachefly.cachefly.net/100mb.test";

{{ if eq .chezmoi.os "darwin" -}}
alias ag="rg"
{{ end -}}

function ccd {
    cd $(chezmoi source-path)
}

function capply {
    chezmoi apply --exclude=encrypted
}
