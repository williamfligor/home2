# ── nono: run pi inside the sandbox by default ─────────────────────────────
#
# `pi` runs the real binary with `nono run --profile pi` (nono stays as the
# supervising parent, so you get the session summary, audit trail, and
# detach/attach — for scripts/pipes use `command nono wrap` directly).
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
#
# Per-invocation sandbox tweaks via `--nono-*` flags on the pi command itself.
# Each maps 1:1 onto a `nono run` flag; everything else goes to pi unchanged:
#   pi --nono-profile asdf            run with profile "asdf" instead of "pi"
#   pi --nono-allow ~/proj-x          read+write dir grant (repeatable)
#   pi --nono-read ~/docs             read-only dir grant (repeatable)
#   pi --nono-allow-file ~/.netrc     grant a single file (read+write)
#   pi --nono-block-net               block all network
#   pi --nono-listen-port 8000        allow listening on a TCP port
#   pi --nono-open-port 5173          allow bidirectional localhost TCP
#   pi --nono-env-credential <route>  load a credential route as env vars
#   pi --nono-credential github       inject credentials via reverse proxy
#   pi --nono-network-profile dev     proxy host-filter for outbound traffic
#   pi --nono-allow-domain api.foo    proxy-allowlist a host (or URL w/ path glob)
#   pi --nono-deny-domain *.ads.x     proxy-block a host (wildcards ok)
#   pi --nono-workdir /path           set $WORKDIR for profile expansion
#   pi --nono-silent --nono-dry-run   quiet / preview the sandbox without running
#   pi --nono-verbose                 verbose nono output
#   pi --nono-detached                start pi in the background; `nono attach` later
#   = form works too: --nono-allow=~/proj-x
#   Flags listed above with a value also accept space form; any other
#   --nono-<flag> is passed through as --<flag> (boolean), so unknown and
#   future nono flags keep working — nono itself does the validation.
#   (Unknown *value-taking* flags only work via the = form until listed.)
#   --nono-allow-cwd / --nono-no-diagnostics are intentionally unavailable:
#   the wrapper enables them unconditionally.
#   `--` stops parsing: everything after it goes to pi untouched.

function pi() {
  local bin
  bin="$(whence -p pi 2>/dev/null)" || { echo "pi: not found in PATH" >&2; return 127; }

  # Recursion guard: already inside a nono sandbox → run pi directly.
  if [[ -n "$NONO_CAP_FILE" ]]; then
    local a
    for a in "$@"; do
      if [[ "$a" == --nono-* ]]; then
        echo "pi: already inside a nono sandbox; --nono-* flags have no effect" >&2
        break
      fi
    done
    command "$bin" "$@"
    return
  fi

  # --nono-<flag> → `nono run --<flag>`.
  # Only the value-arity table is maintained: flags listed here consume a
  # value (space form). Everything else is treated as a boolean flag and
  # passed through — unknown or future nono flags keep working, nono itself
  # validates them. `=` form (--nono-allow=/path) never needs the table.
  local -A takes_value=(
    allow 1 read 1 write 1
    allow-file 1 read-file 1 write-file 1
    allow-unix-socket 1 allow-unix-socket-bind 1 allow-unix-socket-dir 1
    allow-unix-socket-dir-bind 1 allow-unix-socket-subtree 1 allow-unix-socket-subtree-bind 1
    bypass-protection 1 suppress-save-prompt 1 workdir 1
    listen-port 1 open-port 1 allow-connect-port 1
    network-profile 1 allow-domain 1 deny-domain 1
    upstream-proxy 1 upstream-bypass 1 proxy-port 1 proxy-ca-validity 1
    credential 1 allow-endpoint 1 sandbox-policy 1
    detach-timeout 1 skip-dir 1 startup-timeout 1
    env-credential 1 env-credential-map 2
    allow-command 1 block-command 1
    theme 1 log-file 1 extends 1 config 1
  )

  local -a nono_flags=()
  local -a pi_args=()
  local a name n i
  local nono_profile=pi

  while (( $# )); do
    a="$1"; shift
    case "$a" in
      --)
        # literal passthrough: keep the `--` itself and everything after it
        pi_args+=("$a" "$@")
        break
        ;;
      --nono-profile=*)
        nono_profile="${a#--nono-profile=}"
        [[ -n "$nono_profile" ]] || { echo "pi: --nono-profile requires an argument" >&2; return 2; }
        ;;
      --nono-profile)
        (( $# )) || { echo "pi: --nono-profile requires an argument" >&2; return 2; }
        nono_profile="$1"; shift
        ;;
      --nono-*)
        name="${a#--nono-}"
        if [[ "${name%%=*}" == allow-cwd || "${name%%=*}" == no-diagnostics ]]; then
          echo "pi: --nono-${name%%=*} is always enabled by the pi wrapper" >&2
          return 2
        fi
        if [[ "$name" == *'='* ]]; then
          # --nono-X=v → --X=v (mechanical; works for any flag, known or not)
          nono_flags+=( "--${a#--nono-}" )
        elif [[ -n "$name" ]]; then
          n="${takes_value[$name]:-}"
          if [[ -n "$n" ]]; then
            (( $# >= n )) || { echo "pi: --nono-$name requires $n argument(s)" >&2; return 2; }
            nono_flags+=( "--$name" )
            for (( i = 0; i < n; i++ )); do nono_flags+=( "$1" ); shift; done
          else
            # boolean flag, known or not: pass through, nono validates it
            nono_flags+=( "--$name" )
          fi
        else
          echo "pi: --nono- is not a valid flag" >&2
          return 2
        fi
        ;;
      *)
        pi_args+=("$a")
        ;;
    esac
  done

  command nono run --profile "$nono_profile" --allow-cwd --no-diagnostics \
    "${nono_flags[@]}" -- "$bin" "${pi_args[@]}"
}
