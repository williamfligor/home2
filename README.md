# home2 — personal dotfiles & machine bootstrap

Declarative personal dotfiles + machine setup, managed by [`mise bootstrap`](https://mise.jdx.dev/bootstrap/) — the repo itself is the global mise config.

## Bootstrap

```sh
curl -fsSL https://raw.githubusercontent.com/williamfligor/home2/main/install.sh | bash
```

`install.sh`:
1. installs mise into `~/.local/bin` (if absent),
2. clones this repo into `~/.config/mise` so the repo-root `mise.toml` **is** the global mise config (dotfiles, tools, hooks, final task),
3. runs `MISE_AUTO_ENV=true mise bootstrap --yes` (dotfiles → tools → post-tools hook → final task: per-machine ssh key).

This is the released realization of the documented-but-unreleased `mise bootstrap --from-git`; once a mise release ships that flag, install.sh can switch to it unchanged (see MIGRATION.md decision #1).

**Before you run it on an existing machine:** back up / move aside any existing `~/.config/mise` that isn't a clone of this repo (install.sh refuses to touch it), and note the cutover steps in [MIGRATION.md](MIGRATION.md#cutover-checklist).

## Layout

```
mise.toml            global config: [tools] (some lazy), [settings], [dotfiles],
                     [tasks.bootstrap], [bootstrap.repos], [bootstrap.hooks.post-tools]
mise.macos.toml      macOS: .app bundles (postinstall → mise run install-macos-apps) + macOS dotfiles
mise.linux.toml      Linux placeholder (empty on purpose — see MIGRATION.md)
mise.android.toml    Termux — requires MISE_ENV=android (mise has no android platform env)
.miserc.toml         early-init auto_env (forward-compat)
zshrc zshenv gitconfig dircolors p10k.zsh tmux.conf   $HOME-root dotfiles
config/ zshrc.d/    ~/.config/… dotfile sources (folder links)
local/bin/          PATH helper scripts (symlink-each into ~/.local/bin)
config/mise/tasks/  mise file-tasks (bootstrap steps, mac helpers, pi update)
skills/             in-repo agent skills (symlink-each into ~/.agents/skills)
pi/ ssh/ termux/    pi agent config, ssh config, Termux dotfiles
macos/              macOS dotfile sources (xbar/ + KeyBindings/)
MIGRATION.md        full migration record, decisions, cutover checklist, verification log
```

Dotfiles are folder-level symlinks for fully-owned static dirs, `symlink-each` for dirs that hold unmanaged neighbors or runtime writes (nvim, ~/.pi, ~/.local/bin, ~/.agents/skills), and individual links for $HOME-root files and `~/.ssh/config`.

## Daily usage

```sh
mise bootstrap        # converge everything (or: mb)
mbs / mbd / mba       # dotfiles status / diff / apply (mise bootstrap dotfiles …)
mise run clean-osx-network …   # run a file-task
mise skills sync      # when tool-attached skills land (packslip)
```

Shell activates mise via `~/.zshenv` → `~/.config/zsh/env.sh` (`mise activate zsh --shims`, `MISE_AUTO_ENV=true`).

## Notes / caveats

- Repo is **public**; ssh keys are generated per-machine at bootstrap and never committed. (If the repo ever goes private, generate `~/.ssh/id_rsa` before cloning — MIGRATION.md decision #11.)
- No encryption; git only tracks filenames + the executable bit (no `0600` semantics — the real ssh key is `0600` from `ssh-keygen`).
- Termux needs `MISE_ENV=android`; Termux may report os=linux, so `mise.linux.toml` stays empty.
- `~/.pi`, `~/.config/nvim/lazy-lock.json` etc. are runtime state — not managed, never linked as whole dirs.

See [MIGRATION.md](MIGRATION.md) for the chezmoi → mise bootstrap migration record and the per-machine cutover checklist.