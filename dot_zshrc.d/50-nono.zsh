# ── nono: run pi inside the sandbox by default ─────────────────────────────
#
# `pi` runs the real binary with `nono run --profile pi` (nono stays as the
# supervising parent, so you get the session summary, audit trail, and
# detach/attach — for scripts/pipes use `command nono wrap` directly).
#   - --allow-cwd        shares the working directory (skips the cwd prompt)
#   - diagnostics ON    the failure footer shows by default (denials + `nono why`
#                        hints). No save/profile-change prompt: the pi profile
#                        uses Landlock, which denies silently at the syscall
#                        level, so nono has nothing observable to prompt about —
#                        that prompt only exists in capability_elevation mode.
#                        Opt out per run with `--nono-no-diagnostics`.
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
#   `command nono run --profile pi --read <path> -- pi` or the --nono-* flags below.
# Usage: NONO_ALLOW=~/proj-x NONO_NETWORK_PROFILE=developer pi
#
# Per-invocation tweaks via --nono-* — each maps 1:1 onto a `nono run` flag and
# can appear anywhere before `--`; everything after `--` goes to pi untouched.
# Leading ~/ in a value is expanded by the wrapper (nono itself doesn't).
#   pi --nono-allow=~/proj-x          add a read+write dir
#   pi --nono-read=~/docs             add a read-only dir
#   pi --nono-block-net               block all network
#   pi --nono-network-profile=dev     proxy host-filter
#   pi --nono-profile=asdf            run with profile "asdf" (default: pi)
# Repeatable; unknown --nono-<flag> is passed through verbatim, nono validates.
# `--nono-profile=<name>` is intercepted (not appended): nono rejects a
# duplicate --profile, so it overrides the wrapper's default profile instead.
# (--nono-allow-cwd is not honored: always on.)

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

  # --nono-<flag>[=<value>] → `nono run --<flag>[=<value>]`.
  # Leading ~/ in a value is expanded here — nono doesn't expand ~ itself, and
  # magicequalsubst can't help (it's parse-time; $1 is already a string inside
  # the function), so we do the one substitution by hand.
  # --nono-profile=<name> is intercepted (substitutes the default profile)
  # because nono rejects a duplicate --profile argument.
  local -a nono_flags=() pi_args=()
  local nono_profile=pi a flag val

  while (( $# )); do
    case "$1" in
      --nono-profile=*)
        nono_profile="${1#--nono-profile=}"
        [[ -n "$nono_profile" ]] || { echo "pi: --nono-profile requires a name" >&2; return 2; }
        shift
        ;;
      --nono-*=*)
        a="${1#--nono-}"                          # allow=~/prj
        flag="${a%%=*}"
        if [[ "$flag" == profile ]]; then
          # only --nono-profile=… is recognized; any other profile-shaped
          # passthrough would duplicate --profile → reject loudly.
          echo "pi: use --nono-profile=<name>" >&2; return 2
        fi
        val="${a#*=}"
        val="${val/#\~\//$HOME/}"                  # expand leading ~/
        nono_flags+=( "--$flag=$val" )
        shift
        ;;
      --nono-*)
        flag="${1#--nono-}"
        [[ "$flag" == profile ]] && { echo "pi: --nono-profile requires =<name>" >&2; return 2; }
        nono_flags+=( "--$flag" )
        shift
        ;;
      --)
        pi_args+=("$@"); shift; break
        ;;
      *)
        pi_args+=("$1"); shift
        ;;
    esac
  done

  command nono run --profile "$nono_profile" --allow-cwd \
    "${nono_flags[@]}" -- "$bin" "${pi_args[@]}"
}