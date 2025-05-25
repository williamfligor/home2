# Yazi support
function y() {
	local tmp="$(mktemp -t "yazi-cwd.XXXXXX")" cwd
	yazi "$@" --cwd-file="$tmp"
	IFS= read -r -d '' cwd < "$tmp"
	[ -n "$cwd" ] && [ "$cwd" != "$PWD" ] && builtin cd -- "$cwd"
	rm -f -- "$tmp"
}

# using ripgrep combined with preview
# find-in-file - usage: fif <searchTerm>
fif() {
    if [ ! "$#" -gt 0 ]; then
        echo "Need a string to search for!";
    return 1; fi
    rg --files-with-matches --no-messages "$1" | fzf --preview "highlight -O ansi -l {} 2> /dev/null | rg --colors 'match:bg:yellow' --ignore-case --pretty --context 10 '$1' || rg --ignore-case --pretty --context 10 '$1' {}"
}

# fzf fuzzy funding within files
fzzy() {
    fzf --multi --ansi --query "${*:-}" \
        --bind "start:reload:rg --line-number --no-heading --color always {q}" \
        --color "hl:-1:underline,hl+:-1:underline:reverse" \
        --prompt 'notes-selector:fzf> ' \
        --delimiter : \
        --preview 'bat --color=always {1} --highlight-line {2}' \
        --preview-window 'up,60%,border-bottom,+{2}+3/3,~3' \
        --bind 'enter:become:sort -u {+f1}' \
        --bind 'tab:toggle+change-preview-window(~0:+1)+change-preview:echo "SELECTED FILES:"; sort -u {+f1} | sed "s/^/  - /"' \
        --bind 'focus:+change-preview-window(+{2}+3/3)+change-preview:bat --color=always {1} --highlight-line {2}'
}

ccd() {
    cd $(chezmoi source-path)
}

capply() {
    chezmoi apply --exclude=encrypted
}
