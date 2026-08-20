---
name: resolve-chezmoi-diff
description: Resolve differences between installed home-directory files and the chezmoi source through explicit per-change decisions.
---

# Resolve Chezmoi Differences

Use this skill when the user asks to inspect or resolve `chezmoi diff`, `czd`, installed-vs-source configuration drift, or to synchronize selected changes between the home directory and the chezmoi repository.

## User-facing workflow

Keep the interaction decision-oriented:

1. Run the equivalent of the user's `czd` alias:

   ```bash
   chezmoi diff --exclude scripts
   ```

   Always exclude scripts unless the user explicitly asks to include them.

2. If there is no diff, report that the installed state and chezmoi source are synchronized.

3. Group the diff into coherent, actionable changes. For structured files such as JSON, present individual settings or small related groups rather than asking the user to approve an opaque whole-file replacement.

4. For every group, show the actual values and ask for one of:

   - **I** — copy the installed value into chezmoi/source
   - **C** — apply the chezmoi/source value to the installed file
   - **S** — skip; leave both sides unchanged

   Use a compact table or numbered list so the user can answer with something like:

   ```text
   1 I, 2 C, 3 S
   ```

5. Do not modify either side until the user has answered all relevant decisions. If the user supplies decisions in a transcript-style format, extract and confirm the mapping before editing.

## Important diff orientation

`chezmoi diff` displays the installed target as the `-` side and the chezmoi source as the `+` side. Do not infer the direction from the order in which values were previously summarized. Verify values directly when there is any ambiguity:

```bash
chezmoi source-path
chezmoi target-path
```

For a file, inspect both paths directly. Clearly label them as `Installed` and `Chezmoi source` before asking for a decision.

## Applying decisions safely

### I: installed -> chezmoi

Update only the selected source fields. Prefer a structured edit for JSON/YAML/TOML rather than replacing the entire source file. Do not use `chezmoi re-add` for a mixed-decision file unless every changed field in that file should be copied from installed; `re-add` can import unrelated drift.

### C: chezmoi -> installed

Apply only the selected target file or target path after the user explicitly chooses C:

```bash
chezmoi apply <target>
```

If chezmoi reports that the target changed and needs confirmation, use `--force` only after the user's explicit C decision for that target:

```bash
chezmoi apply --force <target>
```

Never use a broad `chezmoi apply` when the user selected C for only one file unless they explicitly request a wider apply.

### S: skip

Make no change to either side. Mention that the difference will remain in the next `czd`.

## Backups and safety

Before changing a nontrivial structured file, preserve the current contents if practical, for example in `/tmp` with restrictive permissions. Do not overwrite unrelated user edits. If the source or target changed while decisions were being collected, stop and re-run the diff rather than applying stale decisions.

Do not remove installed files, packages, runtime directories, logs, or node_modules merely because they appear in a diff unless the user explicitly asks for cleanup. Treat cleanup as a separate decision.

## Verification

After applying all decisions:

1. Re-run:

   ```bash
   chezmoi diff --exclude scripts
   ```

2. Report any remaining differences, identifying which were intentionally skipped.
3. Inspect the final installed values for the changed settings when useful.
4. Report source-repository status (`git status --short`) and do not commit unless asked.
5. State whether changes were made with normal apply or `--force`.

## Example response format

```text
I found 3 changes in ~/.config/example.json:

1. defaultModel
   Installed: deepseek-v4-flash
   Chezmoi:   gpt-5.6-luna
   Choose I / C / S:

2. retry.maxRetries
   Installed: 3
   Chezmoi:   99
   Choose I / C / S:

3. package list
   Installed: includes package-x
   Chezmoi:   absent
   Choose I / C / S:
```

After the answer, apply only the requested directions and finish with a fresh `chezmoi diff --exclude scripts` verification.
