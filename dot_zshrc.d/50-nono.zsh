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
#
# Git worktree auto-grant: when launched inside a git work tree, the wrapper
# auto-grants the worktree toplevel (r+w) and, for a *linked* worktree, the
# main repo's .git (the "common dir" — shared objects/refs that live outside
# the worktree). Without this, git in a linked worktree fatals with
# `not a git repository: <main>/.git/worktrees/<name>`. In a plain (non-linked)
# repo this just widens the grant from the cwd to the whole repo toplevel.
#
# Project nono manifest (.pi/nono.json or .pi/nono.jsonc): a repo can declare
# its own grants (extra paths/groups/network) and the wrapper uses the file
# directly as the profile — nono takes `--profile <FILE>`, parses JSONC, and
# resolves `extends`. Searched upward from cwd (stopping above $HOME).
# Profile precedence:
#   1. --nono-profile=<name or path>   explicit (highest)
#   2. .pi/nono.json(.jsonc)          nearest, walking up from cwd
#   3. "pi"                           built-in user profile (default)
# Trust: `extends` can only name a profile already installed on this machine,
# so a repo can only widen within profiles you've already trusted. Override a
# repo manifest deliberately with `pi --nono-profile=pi ...`.

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
  local nono_profile="" a flag val

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
        shift; pi_args+=("$@"); break
        ;;
      *)
        pi_args+=("$1"); shift
        ;;
    esac
  done

  # Project nono manifest: if the user didn't set --nono-profile=, search
  # upward from cwd for .pi/nono.json(.jsonc) and use it directly — nono's
  # `--profile <NAME_OR_PATH>` accepts a file path, parses JSONC natively, and
  # resolves `extends` against installed profiles. A repo can thus declare its
  # own grants (extra paths/groups/network) without a per-invocation flag.
  # Trust: `extends` can only name profiles already installed on this
  # machine, so a repo can't escalate beyond what the user has trusted.
  if [[ -z "$nono_profile" ]]; then
    local d="${PWD:A}" manifest=""
    while [[ "$d" != "$HOME" && "$d" != "/" && -z "$manifest" ]]; do
      if   [[ -f "$d/.pi/nono.json"  ]]; then manifest="$d/.pi/nono.json"
      elif [[ -f "$d/.pi/nono.jsonc" ]]; then manifest="$d/.pi/nono.jsonc"; fi
      d="${d:h}"
    done
    if [[ -n "$manifest" ]]; then
      echo "pi: using project nono profile: $manifest" >&2
      nono_profile="$manifest"
    else
      nono_profile=pi
    fi
  fi

  # Git worktree handling: when inside a git work tree, auto-grant the
  # worktree toplevel (r+w). For a *linked* worktree its git metadata lives
  # in the main repo's .git (the "common dir"), OUTSIDE the worktree cwd —
  # without that grant git fatals with `not a git repository`. Grant it too.
  # ($top/.git is covered by the $top grant, so the common-dir grant is only
  # needed when common != top/.git, i.e. a linked worktree.)
  local -a wt_flags=()
  local top common
  if git rev-parse --is-inside-work-tree &>/dev/null; then
    top="$(git rev-parse --show-toplevel 2>/dev/null)"
    [[ -n "$top" ]] && wt_flags+=(--allow "${top:A}")
    common="$(git rev-parse --git-common-dir 2>/dev/null)"
    if [[ -n "$common" && -d "$common" && "${common:A}" != "${top:A}/.git" ]]; then
      wt_flags+=(--allow "${common:A}")
    fi
  fi

  command nono run --profile "$nono_profile" --allow-cwd "${wt_flags[@]}" \
    "${nono_flags[@]}" -- "$bin" "${pi_args[@]}"
}