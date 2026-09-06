---
name: review-git-status-diff
description: Review and resolve a Git working tree using git status and git diff with explicit per-file or per-hunk decisions.
---

# Review Git Status and Diff

Use this skill when the user asks to inspect `git status`, `git diff`, local changes, working-tree cleanup, staging decisions, or help deciding what to commit.

## Goals

Make the working tree understandable before making changes. Separate:

- staged changes
- unstaged changes
- untracked files
- ignored files only when requested
- commits ahead of or behind the upstream branch

Never discard, reset, clean, checkout over, or commit user changes without explicit instruction.

## Initial inspection

Run commands that distinguish all Git states:

```bash
git status --short --branch
git diff --stat
git diff --check
git diff --cached --stat
git ls-files --others --exclude-standard
```

For a manageable diff, inspect both forms:

```bash
git diff
git diff --cached
```

For a large diff, do not dump everything into the conversation. Use `--stat`, `--name-status`, targeted path diffs, and saved output files. Report the output path if full output is captured.

Also check branch context when relevant:

```bash
git branch --show-current
git log --oneline --decorate -5
git status --short --branch
```

## Decision-oriented review

Group changes by file or coherent hunk. For each group, show:

- path
- status (`M`, `A`, `D`, `??`, staged/unstaged)
- concise purpose or diff summary
- whether it is tracked, staged, or untracked
- any concerns such as generated files, secrets, build artifacts, or unrelated work

Ask for an explicit action per group. Use this vocabulary:

- **K** — keep in the working tree, do not stage or discard
- **T** — stage this file or hunk for the next commit
- **D** — discard this change (destructive; confirm the exact path first)
- **U** — leave an untracked file untracked
- **R** — remove an untracked/generated file (destructive; confirm the exact path first)
- **I** — inspect this item in more detail before deciding
- **S** — skip and leave it unchanged

If the user wants a simpler flow, offer a compact set of choices such as `keep / stage / discard / skip`, but define the meaning before acting.

Example:

```text
1. M  src/config.ts — staged: no; changes runtime defaults
   Choose T (stage), K (keep unstaged), D (discard), I (inspect), or S (skip)

2. ?? tmp/output.log — untracked generated artifact
   Choose U (leave), R (remove), I (inspect), or S (skip)
```

Do not infer that every modified file belongs to the current task. Ask about unrelated-looking changes instead of staging them automatically.

## Staging safely

Stage only paths or hunks the user selected:

```bash
git add -- path/to/file
```

For mixed-purpose files, inspect and use patch mode only with the user's approval:

```bash
git add --patch -- path/to/file
```

Do not use `git add -A` or `git add .` unless the user explicitly requests staging everything.

After staging, verify:

```bash
git diff --cached --stat
git diff --cached --check
git status --short
```

## Discarding safely

Discarding tracked changes is destructive. Before doing it:

1. identify the exact path or hunk;
2. tell the user it will be lost from the working tree;
3. obtain explicit confirmation if the instruction was not already unambiguous.

Use narrow commands:

```bash
git restore -- path/to/file
```

For staged changes, use only the requested scope:

```bash
git restore --staged -- path/to/file
```

Do not use `git reset --hard`, `git clean -fd`, or broad checkout commands for routine cleanup. For untracked files, never use `git clean` without an explicit dry run and confirmation:

```bash
git clean -nd -- path/to/file
```

## Untracked and generated files

`git diff` does not show untracked contents. For an untracked file selected for review:

```bash
sed -n '1,240p' path/to/file
```

or use the file-reading tool. Check whether it is generated, contains secrets, or belongs in `.gitignore` before suggesting staging or removal. Do not add secrets, credentials, runtime state, dependencies, `node_modules`, build output, or logs without explicit approval.

## Commit boundary

This skill does not commit by default. If the user asks to commit:

1. verify the exact staged file list;
2. run `git diff --cached --check`;
3. summarize the staged diff and commit message;
4. commit only the approved staged changes;
5. verify with `git status --short --branch` and `git log -1 --oneline`.

Do not amend, rebase, force-push, or push unless explicitly requested.

## Verification and final report

End with:

```bash
git status --short --branch
git diff --stat
git diff --cached --stat
```

Report:

- current branch
- staged paths
- unstaged paths
- untracked paths
- discarded paths, if any
- commands run and their results
- any remaining ambiguity or risk

If no action was requested, make no modifications and only report findings.
