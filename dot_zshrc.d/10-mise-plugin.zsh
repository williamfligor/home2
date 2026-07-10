# Helper: source a zsh plugin from a mise http: backend install by name.
# Uses the symlink path directly instead of forking `mise where` on every shell start.
mise-plugin() {
  local name="$1" file="${2:-$1.plugin.zsh}"
  local base="$HOME/.local/share/mise/installs/http-$name"
  for symlink in latest rel_latest vlatest; do
    local dir="$base/$symlink"
    if [[ -d "$dir" && -f "$dir/$file" ]]; then
      source "$dir/$file"
      return
    fi
  done
}
