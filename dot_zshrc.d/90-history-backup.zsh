# Lazy zsh history backup: at most once per hour, only when file has changed.
#
# Stores backups in ~/.cache/zsh-history-backups/zsh_history-YYYYMMDD-HHMMSS
# Keeps the 30 most recent backups.
#
# Per-prompt cost: one builtin stat call + one variable read (no fork).
# The cp only runs when ≥1 hour has passed AND history was modified.

zmodload zsh/stat 2>/dev/null
zmodload zsh/datetime 2>/dev/null

# Standalone file — ensure add-zsh-hook is available (used after function def)
autoload -Uz add-zsh-hook

__zsh_history_backup() {
  local histfile="${HISTFILE:-$HOME/.zsh_history}"
  local backup_dir="${XDG_CACHE_HOME:-$HOME/.cache}/zsh-history-backups"

  # Nothing to back up if history file doesn't exist or is empty
  [[ -f "$histfile" && -s "$histfile" ]] || return

  # Hourly gate: skip if less than 3600s since last backup
  local time_file="$backup_dir/.last_backup_time"
  local now=${EPOCHSECONDS:-$(command date +%s)}
  if [[ -f "$time_file" ]]; then
    local last_time
    last_time=$(<"$time_file")
    (( last_time + 3600 > now )) && return
  fi

  mkdir -p "$backup_dir" || return

  local mtime_file="$backup_dir/.last_backup_mtime"
  local last_mtime=0
  [[ -f "$mtime_file" ]] && last_mtime=$(<"$mtime_file")

  # Use zsh/stat builtin (no fork, fast) to get mtime
  local hist_mtime=-1
  if zmodload -e zsh/stat; then
    hist_mtime=$(builtin stat +mtime "$histfile" 2>/dev/null)
  fi

  # Fallback: external stat if zsh/stat isn't available (macOS/Linux)
  if [[ $hist_mtime -lt 0 ]]; then
    hist_mtime=$(stat -c %Y "$histfile" 2>/dev/null || stat -f %m "$histfile" 2>/dev/null)
  fi

  [[ $hist_mtime -gt 0 ]] || return

  # Only copy if mtime changed since last backup
  if (( hist_mtime > last_mtime )); then
    cp "$histfile" "$backup_dir/zsh_history-$(date +%Y%m%d-%H%M%S)"
    printf '%s' "$hist_mtime" >| "$mtime_file"
    printf '%s' "$now" >| "$time_file"
    # Prune: keep the 30 most recent backups
    ls -t "$backup_dir"/zsh_history-* 2>/dev/null | tail -n +31 | xargs rm -f 2>/dev/null
  fi
}
add-zsh-hook precmd __zsh_history_backup
