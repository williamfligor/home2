# Migration: chezmoi → mise bootstrap

Goal: replace chezmoi as the machine bootstrap/dotfile mechanism with `mise bootstrap`,
keeping mise + dotfiles in the same repo. Target scope: **macOS + Linux, zsh only, no
windows, no bash**.

> Status: **IMPLEMENTED + Docker-validated (2026-09-06).** Plan was reviewed by a fresh-context
> reviewer (2026-09-06), then implemented as commits d32a2a1…531460a on `main` and validated
> end-to-end in Docker (`bash .test.sh` green: bootstrap + mise + nvim smokes). The repo is now
> the mise global config; the live-machine cutover below is all that remains.
> `[x]` = doc-verified via mise.jdx.dev; empirical results in the implementation log.

## Locked decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Repo role | **Same repo** — this repo (`home2`) is the global mise config + dotfiles source. Plan: `mise bootstrap --from-git williamfligor/home2 --yes` [x]. **Correction (implemented):** `--from-git` is documented-but-**unreleased** as of mise 2026.9.1 (current latest; the 2026.9.1 CLI has only `--from`/`--from-dir`). Its released realization — clone the repo into `$MISE_CONFIG_DIR` (~/.config/mise) so repo-root `mise.toml` is the global config, then `mise bootstrap --yes` — is what `install.sh` does. (2026.9.1's `--from <url>` is *one-shot*: it clones into `$MISE_DATA_DIR/bootstrap-repo`, applies dotfiles, but does **not** persist the config — `mise which node` fails afterward. Verified empirically → not suitable.) |
| 2 | Encryption | **None needed.** (`ssh/config` has no real secrets; keys are per-machine. Git identity already public today. See ssh handling below.) |
| 3 | OS-dependent handling | **mise platform environments** (`auto_env = true`) + `[tools] os=` + drop what we can. See below. |
| 4 | Skills (`bootstrap.repos` can't strip) | **`bootstrap.repos` for whole-repo skills; in-repo skills symlinked to `~/.agents/skills`.** `[bootstrap.repos]` is whole-repo clone only — no stripComponents/include/sparse [x]. **Correction (implemented):** the grill-me tarball task was dropped (never used); all skills now land in `~/.agents/skills` — `[bootstrap.repos]` clones (avoid-ai-writing, humanizer) + `[dotfiles]` symlink-each of the repo `skills/` dir (review-git-status-diff, uv-package-manager, video-to-recipe). |
| 5 | Per-script migration | See table below. |
| 6 | Dotfile format | **Symlink, file-level only.** Link files, never directories that accumulate runtime state (see granularity rule). |
| 7 | `.chezmoiignore` | **Not needed.** Symlink mode → only declared targets are linked; runtime state (`.pi`, `node_modules`, sqlite) is never declared. |
| 8 | Testing | Develop via Docker smoke test (`.test.sh`/`.Dockerfile`) — sandbox will be turned off so buildx works. |
| 9 | Dead artifacts | **Remove/replace**: `dot_bashrc.tmpl`, `.chezmoi.toml.tmpl`, `run_onchange_*.sh` (replace → tasks), windows branches, `.chezmoiexternal.toml` (replaced by #4). |
| 10 | **`dot_config/mise/config.toml` fate** (reviewer blocker) | **Merge into repo-root `mise.toml`, then delete the dotfile.** With `--from-git`, repo-root `mise.toml` becomes the global config [x]; keeping the dotfile would install a second overlapping `~/.config/mise/config.toml` with `[tools]` defined twice. |
| 11 | Fresh-machine auth (reviewer high) | **Keep repo public** (status quo — keys are per-machine, never committed). If it ever goes private: `install.sh` generates the ssh key *before* `mise bootstrap --from-git`, mirroring current `bootstrap.sh`. |
| 12 | Termux platform file (reviewer low) | **Verify** mise reports `os=android` under platform envs before promising `mise.android.toml` [docs list linux/macos/windows; Termux has known mise build issues]. Fallback: explicit `MISE_ENV=android` selection in Termux's `.miserc.toml`. |
| 13 | Minimum mise version | Pin `min_version` in repo-root config (bootstrap/dotfiles/auto_env are recent features; confirm against the version that ships them). |
| 14 | Symlink granularity rule (reviewer medium) | **Folder-first, file-level only where needed.** Whole-folder symlink for fully-owned static dirs (`~/.config/mise/tasks`, `config/zsh`, `~/.zshrc.d`, `bat`, `bottom`, `ghostty`, `git`, `zellij`, `yazi`, `~/.termux`, `~/Library/KeyBindings`). `symlink-each` (links individual files, preserves unmanaged neighbors) for trees that accumulate runtime writes or unmanaged neighbors (`~/.config/nvim` writes `lazy-lock.json` + `lazy/`; `~/.pi/agent` holds auth/sessions/npm/sqlite; `~/.config/nono/profiles` gains profiles via `nono profile promote`; `~/.local/bin` gains non-repo tools). Never whole-dir-link those. Root dotfiles + `~/.ssh/config` stay single-file links. Verified: re-applying a file-link → dir-link switch needs `--force` once; fresh machines apply cleanly. |

## OS-dependent handling (decision #3)

mise has first-class **platform environments**: with `auto_env = true`, config files like
`mise.linux.toml`, `mise.macos.toml`, `mise.macos-arm64.toml`, `mise.unix.toml` load
automatically based on the current OS/arch [x]. This replaces chezmoi's `{{ if eq .chezmoi.os }}`.

Rollout note [x]: `auto_env` is **disabled by default** today (warns from 2026.12, on by
default 2027.6). Set it explicitly now in `.miserc.toml` (early-init file, not `mise.toml`).

Recommended layout:

```
mise.toml          # shared: [tools], [dotfiles], [tasks.bootstrap], [bootstrap.*]
mise.macos.toml    # macOS-only: macos/xbar/ + macos/KeyBindings/ dotfiles, mac-only tools
mise.linux.toml    # Linux-only dotfiles/tools
mise.android.toml  # Termux-only (verify, then keep private_dot_termux) — fallback MISE_ENV=android
.miserc.toml       # auto_env = true
```

And the minimisation strategy, in order:

1. **Drop the OS dependency where possible.**
   - `dot_gitconfig.tmpl`'s `credential.helper` branch → keep a **single static helper**.
     **Corrected (reviewer): Linux does NOT ship a default credential helper** (my
     earlier claim was wrong); macOS's osxkeychain default is real but only for
     Apple's git. Removing the helper entirely = Linux prompts on every fetch.
     Fix: static `credential.helper = store` in `gitconfig` (matches today's Linux
     behavior; `store` ships with git on macOS too, though it shadows keychain there
     — acceptable on a single-user machine).
2. **Use platform env files for what genuinely differs.**
   - `Library/` (xbar, KeyBindings) → declare under `[dotfiles]` in `mise.macos.toml`.
   - mac-only tools (ice, xbar, ghostty, rectangle, stats already use `os = ["macos"]`)
     → keep the `os=` field.
3. **`[tools] os=` field** for OS-restricted tool installs (already in use).

## SSH handling (decision #2)

Manage the `config` **file only**, not the `~/.ssh` folder:
- `[dotfiles] "~/.ssh/config"` → symlink to repo `config` (file, not dir).
- `private_dot_ssh/sockets/` (+ `.keep`) → **drop from repo** — runtime ControlMaster
  state. Let a task `mkdir -p ~/.ssh/sockets` create it if needed.
- Content is not sensitive (hostnames/usernames/LAN IPs); keys stay per-machine. If the
  hostnames ever need to be private too, move the config to a per-machine
  `mise.local.toml`/task that never commits it.

## Skills migration (decision #4)

`bootstrap.repos` is a **whole-repo git clone only** — no `stripComponents`, no `include`
subtree filtering, no sparse checkout [x, verified in docs]. Mapping for the three
`.chezmoiexternal.toml` entries:

| Skill | Current (chezmoi external) | Target in mise |
|---|---|---|
| `avoid-ai-writing` | whole repo = skill, `stripComponents=1` | `[bootstrap.repos]` → `~/.agents/skills/avoid-ai-writing` (clone whole repo; no strip needed) |
| `humanizer` | whole repo = skill, `stripComponents=1` | `[bootstrap.repos]` → `~/.agents/skills/humanizer` |
| `grill-me` | subdirectory of `mattpocock/skills`, `stripComponents=4` + `include=["**/grill-me/**"]` | **Not** `bootstrap.repos` (would clone the entire multi-skill repo). Use `[tasks.bootstrap]` that curls the codeload tarball + `tar --strip-components=4` + select the `grill-me/` subtree. Must be **idempotent/refresh-safe** (replace on content change, mirroring today's 168h `refreshPeriod`). Alternative: clone whole repo + symlink `grill-me/` out (wasteful but simpler). |

## Per-script migration (decision #5)

| Artifact | Current role | Recommendation | Target in mise |
|---|---|---|---|
| `.data/bootstrap.sh` | curl chezmoi, ssh keygen, MACHINE_NAME, git identity | **Rewrite** as thin `install.sh`: `curl https://mise.run \| sh` then `mise bootstrap --from-git ... --yes`; ssh keygen + machine prompt → guarded `[tasks.bootstrap]`; **drop git-identity lines (already in `gitconfig`)** | `install.sh` + `[tasks.bootstrap]` |
| `run_onchange_after_01-mise.sh.tmpl` | install mise + `mise install --yes` (+ config-hash onchange trick) | **Eliminate** — `mise install` is built into `mise bootstrap` (step 15 of the documented order [x]); convergence replaces the hash trick | built-in |
| `run_onchange_after_03-autossh.sh` | build autossh from http-source when gcc present | **Guarded task** — but guard on **source-vs-binary mtime**, not mere binary existence (reviewer: existence check would skip rebuilds when the pinned `http:autossh` version bumps) | `[tasks.bootstrap]` |
| `run_onchange_after_99-pi-extensions.sh` | npm install for pi extensions | **post-tools step** — drop the `eval "$(mise activate bash)"` line when porting (mise tasks inherit mise's env) | `[bootstrap.hooks.post-tools]` |
| `run_always_after_chezmoi-prune.py` | quarantine orphaned files after apply | **Drop** (accepted: loses historical-orphan quarantine; convergence only handles declared targets — deliberate, not accidental) | n/a |
| `.test.sh` + `.Dockerfile` | docker smoke test via chezmoi apply | **Rework** to drive `mise bootstrap`; same checks (mise tools, nvim plugins, zsh) | rewritten `.test.sh` |
| **`.github/workflows/build-docker.yml`** (missed by first draft) | CI runs `bash .test.sh`; cache key = `hashFiles('.Dockerfile', 'dot_config/mise/config.toml')` | **Update** hash key (config.toml moves/merges per #10) alongside the test rework | CI row |
| `dot_config/mise/config.toml` | the tool definitions + `[settings]` (the single most important file) | **Merge into repo-root `mise.toml` and delete the dotfile** (decision #10) | `mise.toml` |
| `dot_local/bin/*` (15 executables, incl. `install-macos-apps`) | dotfile-managed helper scripts; 5 mac tools call `install-macos-apps` via `postinstall` | **Declare as symlinked dotfiles.** Ordering is safe: `mise bootstrap` applies dotfiles (step 9) **before** `mise install` (step 15) [x], so postinstall scripts resolve | `[dotfiles]` in `mise.macos.toml` / shared |
| `.chezmoiexternal.toml` | tarball archive pulls for skills | **Replaced** per #4 | `[bootstrap.repos]` + task |
| `.chezmoitemplates/aliases.sh`, `functions.sh`, `env.sh` | template-included shared config | **De-template** → static dotfiles sourced at runtime. **Also remove dead chezmoi aliases** (`cz`/`cza`/… in aliases.sh, `ccd()` → `chezmoi source-path` in functions.sh) | static dotfiles |
| `dot_zshrc.tmpl`, `dot_zshenv.tmpl` | templated zshrc/`zshenv` | **De-template** — drop `{{ template }}` + OS branches; static files sourcing the shared ones | static dotfiles |
| `dot_gitconfig.tmpl` | darwin/linux credential helper | **De-template** — static `credential.helper = store` (corrected, see OS section) | static dotfile |

## Target structure sketch

```
mise.toml            # merged [tools] + [settings] + [dotfiles] + [tasks.bootstrap] + [bootstrap.*] + min_version
mise.macos.toml      # macos/xbar/ + macos/KeyBindings/, mac-only tools, mac-only dotfiles
mise.linux.toml      # linux-only (if any)
mise.android.toml    # Termux-only (verify #12; fallback MISE_ENV=android)
.miserc.toml         # auto_env = true
tasks/               # mise tasks (bootstrap-ssh-key, clean-osx-network, install-macos-apps,
                     #   update-pi, update-pi-summary — file-tasks in config/mise/tasks/)
config/, local/, pi/, ssh/, termux/, macos/, skills/, zshrc.d/   # dotfile sources (no .tmpl)
install.sh           # curl mise + clone repo → ~/.config/mise + MISE_AUTO_ENV=true mise bootstrap --yes
```

Notes:
- Repo-root `mise.toml` is also picked up as a *project* config whenever cwd is inside
  the clone (e.g., while editing dotfiles) — benign, but documented.

## Rollout / rollback

- mise dotfiles **refuse conflicting targets unless `--force-dotfiles`** [x] → safe to run
  `mise bootstrap dotfiles apply --dry-run` against existing chezmoi state first (staging).
  Validated: dry-run prints the plan without applying; existing non-conforming files refuse.
- **Rollback point**: tag `pre-mise-migration` (at bb2fa80, the last pre-migration commit).
  To roll back a machine: `git checkout pre-mise-migration` and re-run the old `install.sh`.

### Cutover checklist (per machine; run when ready to leave chezmoi)

1. **Commit/push** the migration work on `main` (done — install.sh clones from it).
2. **Back up / purge chezmoi state**: `chezmoi purge` (removes managed files) or back up
   `~/.local/share/chezmoi` first. Then remove `~/.config/chezmoi`.
3. **Remove old clone**: the repo currently doubles as the chezmoi source at
   `~/.local/share/chezmoi`; after purge it can be deleted — `install.sh` clones it fresh
   into `~/.config/mise`. (If you want `install.sh` available after deletion, use the curl
   form in step 5 instead of a local `bash install.sh`.)
4. **Remove `cz` aliases** from the shell if present (they were deleted from the repo;
   interactive sessions may still have them until re-sourced).
5. **Bootstrap**: run install.sh from the checkout **before** deleting it, or use the
   published form: `curl -fsSL https://raw.githubusercontent.com/williamfligor/home2/main/install.sh | bash`
   (curl mise → clone into ~/.config/mise → `MISE_AUTO_ENV=true mise bootstrap --yes`). On macOS,
   confirm the .app bundles install (postinstall → `mise run install-macos-apps`).
6. **Validate**: `mise bootstrap dotfiles apply --dry-run` shows converged; `mise bootstrap
   status` ok; smoke via `bash .test.sh`.

Rollback during cutover: restore the purged files from backup and `git checkout
pre-mise-migration`.

### Post-cutover cleanup (optional, non-blocking)

- `~/.agents/skills/{avoid-ai-writing,humanizer}` (cloned by `[bootstrap.repos]`) and
  `skills/` (in-repo, symlinked) refresh by bumping pinned refs / re-vendoring.
- (The chezmoi-only `resolve-chezmoi-diff` skill and the unused grill-me skill were removed.)

## Implementation status (Docker-validated, 2026-09-06)

Everything below is committed on `main` and exercised by the green `bash .test.sh` run:

- `mise.toml` (global config: merged `[tools]`+`[settings]`+`[dotfiles]`, `[tasks.bootstrap]`,
  `[bootstrap.repos]`, `[bootstrap.hooks.post-tools]`, `min_version = "2026.9.1"`); platform
  files `mise.{macos,linux,android}.toml`; `.miserc.toml` (forward-compat).
- Dotfiles de-templated to static files; shared aliases/functions/env → `~/.config/zsh/*.sh`;
  dead `cz`/`cza`/`ccd()` removed; `dot_config/mise/config.toml` deleted (decision #10).
  Replaced with `mb*` aliases in `config/zsh/aliases.sh`: `mb` = `mise bootstrap`, `mbs` =
  `mise bootstrap dotfiles status`, `mbd` = diff, `mba` = apply, `mbu` = unapply, `mbadd` =
  add, `mbed` = edit (same-prefix naming as the old `cz`/`cza` aliases).
- Scripts ported (final task + hooks); skill repos via `[bootstrap.repos]`; grill-me task
  (later removed — see below).
- `install.sh`, rewritten `.test.sh`/`.Dockerfile` (which drives `install.sh` — the real
  fresh-machine script — against the local checkout), `.github/workflows` cache key,
  `.dockerignore`.
- `install.sh` clones the repo into `~/.config/mise` + `mise bootstrap --yes` — the released
  realization of `--from-git` (see decision #1); once a mise release ships `--from-git`,
  `install.sh` can switch to it unchanged.
- Verification greps: zero `.tmpl`/`.chezmoi*`/windows-branch/`cz`/`cza`/`ccd`/`run_onchange`/
  `chezmoi-prune` artifact patterns remain in tracked files (the word "chezmoi" itself only
  appears in this doc and in history comments).
- **Chezmoi source prefixes removed**: `dot_`/`private_dot_`/`private_` are pure chezmoi source-
  dir conventions that mise never reads (git can only track filenames + the exec bit — it
  cannot represent `0600`, so `private_`'s perm meaning is lost under symlink mode anyway).
  All 87 sources renamed to plain names (`dot_zshrc`→`zshrc`, `private_dot_pi/private_agent`→
  `pi/agent`, `Library/private_Application Support`→`Library/Application Support`, …); the
  exec bit on the PATH scripts (`local/bin/*`, now 13) and on `config/mise/tasks/*`
  (`100755`) is preserved — that's all git tracks. No per-file `0600` support in
  mise (only inline `content = …` writes `0600`; see decision #1/#11). `~/.ssh/config` stays
  `0644` (non-secret; SSH only rejects world-*writable* config; the real key `id_rsa` is `0600`
  from `ssh-keygen`).
- **Bootstrap setup steps promoted to mise file-tasks**: `bootstrap-ssh-key`,
  `build-autossh` (removed later — autossh no longer used) and `fetch-grill-me` (removed
  later — grill-me unused) moved from `local/bin` to `config/mise/tasks/` (as `#MISE`
  file-tasks,
  discovered from `~/.config/mise/tasks`), and `[tasks.bootstrap]` now runs them via
  `depends = [...]` (verified: `mise bootstrap` executes file-task deps after dotfiles
  apply). `install-macos-apps` also became a file-task (config/mise/tasks) since it's tightly
  mise-coupled: mac tool `postinstall` now runs `$HOME/.local/bin/mise run install-macos-apps
  <app>` (absolute mise path — no PATH dep; the task env provides uv + mise, and
  `MISE_TOOL_INSTALL_PATH` propagates so install_one works). `clean-osx-network` (one-off
  macOS network-location reset) also became a file-task; `configure_macos` (a `defaults write`
  script, unreferenced) was **removed** — its settings can be re-declared natively via
  `[bootstrap.macos.defaults]` if wanted. `local/bin` is now purely PATH helper scripts (12):
  the pi-ext-deps hook + 11 user helpers.
- **[dotfiles] consolidated to folder links**: 64 file-level entries → 21. Whole-folder
  symlinks for fully-owned static dirs (`~/.config/mise/tasks`, `~/.config/zsh`, `~/.zshrc.d`,
  `~/.config/{bat,bottom,ghostty,git,zellij,yazi}`, `~/.termux`, `~/Library/KeyBindings`);
  `symlink-each` for dirs with unmanaged neighbors / runtime writes (`~/.config/nvim`,
  `~/.config/nono/profiles`, `~/.pi/agent`, `~/.local/bin` — still file-level, unmanaged
  neighbors preserved); individual links only for $HOME-root dotfiles and `~/.ssh/config`.
  Verified: apply reconciles individual→dir links with `--force` once; fresh machines clean.
- **[tools] lazy set**: 15 niche/dev-toolchain tools marked `lazy = true` (installed on
  first invocation via shim, not at bootstrap): go (lazy_bins go/gofmt), rust, tree-sitter,
  ast-grep, dive, lazydocker, glab, jid, trippy (lazy_bins trip), whosthere, antigravity-cli,
  qmd, pandoc, difftastic, zmx. `lazygit` stays eager (user's call). Verified on 2026.9.1:
  `mise install` skips lazy tools and the shim triggers on-demand install. Core runtime
  (node, uv, pi-coding-agent, nono), shell tools (bat/eza/fd/fzf/rg/tmux/yazi/zellij/delta/gh/
  neovim/yq/glow/tlrc), zsh plugins, and the mac .app bundles stay eager.
- **Skills consolidated to ~/.agents/skills; grill-me removed**: the three in-repo pi agent
  skills (review-git-status-diff, uv-package-manager, video-to-recipe) moved from
  `pi/agent/skills/` to a repo-root `skills/` dir, symlinked into `~/.agents/skills` via
  `[dotfiles]` symlink-each (preserves the `[bootstrap.repos]` clones avoid-ai-writing and
  humanizer as unmanaged neighbors; repos apply before dotfiles). The `fetch-grill-me` task
  and its grill-me skill were removed (never used) — no more tarball/subdirectory hack. `~/.pi`
  is now runtime state only (agent config/extensions remain in `pi/agent`).

Open items still apply: Termux `mise.android.toml` requires `MISE_ENV=android` (mise has no
android platform env); `min_version` is pinned to the Docker-validated 2026.9.1 (tested floor,
not the historical minimum).

## Doc-verification log

Claims verified against mise.jdx.dev by the planner (reviewer had no web access; these were
re-checked): `mise bootstrap` order incl. `mise install` at step 15 and dotfiles (step 9)
before tools (step 15) [bootstrap.html, cli/bootstrap.html]; `[bootstrap.repos]` = whole-repo
clone only [bootstrap/repos.html]; dotfiles whole-file + `--force-dotfiles` + `dotfiles apply
--dry-run` + `bootstrap status` [bootstrap.html]; `.miserc.toml` early-init file and `auto_env`
rollout timeline [configuration/environments.html, settings.html]; platform env patterns
`{os_family}`/`{os}`/`{os}-{arch}` [configuration/environments.html].

Open verification: mise OS detection on Android/Termux (`mise.android.toml` naming, decision
#12); exact mise version that ships `bootstrap` dotfiles + `auto_env` (decision #13).

## Implementation-phase verification (2026-09-06, executed against mise 2026.9.1 in Docker)

These supersede/confirm the plan assumptions with empirical evidence:

- **`--from-git` target dir**: for a repo that IS the global config, `--from-git` clones into
  **`$MISE_CONFIG_DIR` (~/.config/mise)**, NOT `$MISE_DATA_DIR/bootstrap-repo` (that's the
  `--from` variant). Repo files land directly in ~/.config/mise; `mise.toml`, platform files,
  and `tasks/` load as globals from there. [x, bootstrap.html]
- **Global config filename**: `~/.config/mise/mise.toml` loads as the global config (verified),
  so repo-root `mise.toml` works with `--from-git` (decision #10 holds).
- **`.miserc.toml` NOT read by 2026.9.1**: empirically, `~/.config/mise/.miserc.toml`,
  `$MISE_DATA_DIR/.miserc.toml`, and project `.miserc.toml` are all ignored by 2026.9.1
  (settings there never apply). `MISE_AUTO_ENV=true` (env var) DOES work and enables platform
  env loading. → Ship `.miserc.toml` for forward-compat AND export `MISE_AUTO_ENV=true` in
  `env.sh` (+ install.sh) so platform files load on 2026.9.1. `auto_env` in `[settings]` of
  `mise.toml` is too late for discovery (docs confirm).
- **No android platform env**: documented `{os}` values are linux/macos/windows only —
  `mise.android.toml` can NEVER auto-load. `MISE_ENV=android` (decision #12 fallback) is the
  only path for Termux config. Termux may also report os=linux, so `mise.linux.toml` is kept
  EMPTY (placeholder) to avoid leaking linux config onto Termux.
- **`[dotfiles]` relative sources**: relative explicit sources resolve against the declaring
  config file's directory (verified: `source = "dot_x"` with repo-root config → clone dir).
  Works identically under `--from-git`. Whole-file entries + modes + `symlink-each` verified.
- **Directory-links rule**: `symlink-each` links each entry's basename as-is — the chezmoi
  `executable_` prefix would produce targets like `~/.local/bin/executable_background`.
  → Renamed all `executable_*` sources to plain names (git +x preserved): `dot_local/bin/*`
  (15), `dot_config/mise/tasks/{update-pi,update-pi-summary}`, xbar plugins, video-to-recipe
  scripts. `~/.local/bin` = one `symlink-each` entry.
- **Task discovery**: repo-root `tasks/` is scanned in PROJECT scope when cwd is inside the
  clone, but NOT in global scope (config-root tasks/ isn't a global task dir; verified:
  `tasks/executable_hello` in the global config dir was invisible to `mise tasks ls`; the
  global task dirs found were ~/.config/mise/tasks). → update-pi/update-pi-summary stay
  linked into `~/.config/mise/tasks` (global discovery, matches today).
- **Dotfiles conflict refusal verified**: apply refuses existing targets without
  `--force-dotfiles`, `--dry-run` prints the plan, `bootstrap status` exists — staging
  against an existing machine is safe (decision #8 / rollout section hold).
- **min_version**: pinned to `2026.9.1` (Docker-validated: `mise bootstrap`, `bootstrap
  dotfiles`, `MISE_AUTO_ENV` all present). This is the tested floor, not the historical minimum.