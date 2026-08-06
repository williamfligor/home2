# ── nono: run pi inside the sandbox by default ─────────────────────────────
#
# `pi` wraps the real binary with `nono wrap --profile pi`.
#   - --allow-cwd        shares the working directory (skips the cwd prompt)
#   - --no-diagnostics   suppresses the post-run denial footer + whitelist prompt
#   - recursion guard:   already inside a nono sandbox (NONO_CAP_FILE set) →
#                        run the binary directly, don't re-wrap
#
# Non-interactive shells don't source this, so programmatic `pi` invocations
# (scripts, crons) stay unwrapped — by design.

function pi() {
  local bin
  bin="$(whence -p pi 2>/dev/null)" || { echo "pi: not found in PATH" >&2; return 127; }
  [[ -n "$NONO_CAP_FILE" ]] && { command "$bin" "$@"; return; }
  command nono wrap --profile pi --allow-cwd --no-diagnostics -- "$bin" "$@"
}
