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
#
# Temporary grants & network toggles via NONO_* env vars — no wrapper change:
#   NONO_ALLOW=/path              add a read+write dir (verified)
#   NONO_BLOCK_NET=1              block all network
#   NONO_NETWORK_PROFILE=<name>   proxy host-filter: developer/minimal/enterprise/...
#   NONO_ALLOW_DOMAIN=<host>      extra proxy-allowlisted host(s)
#   NONO_DENY_DOMAIN=<host>       proxy-blocked host(s)
#   NONO_UPSTREAM_PROXY=<h:p>     enterprise proxy; NONO_UPSTREAM_BYPASS=<hosts>
#   NONO_CREDENTIAL=<route>       activate a credential route (e.g. opencode-go)
#   NONO_ENV_CREDENTIAL=...
#   Note: there is NO NONO_READ env form — read-only grants need
#   `command nono run --profile pi --read <path> -- pi`.
# Usage: NONO_ALLOW=~/proj-x NONO_NETWORK_PROFILE=developer pi

function pi() {
  local bin
  bin="$(whence -p pi 2>/dev/null)" || { echo "pi: not found in PATH" >&2; return 127; }
  [[ -n "$NONO_CAP_FILE" ]] && { command "$bin" "$@"; return; }
  command nono wrap --profile pi --allow-cwd --no-diagnostics -- "$bin" "$@"
}
