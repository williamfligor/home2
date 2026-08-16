# Bash Backgrounding Rewrite Plan

## Problem and direction

Long-running shell commands may legitimately take minutes or hours, but they may also hang early while waiting on a dependency, lock, network request, or deadlocked subprocess. The agent should be able to regain control of long-running work, inspect it efficiently, and decide whether to continue waiting, investigate, or stop it.

This plan separates:

1. Foreground output returned to the agent and displayed in context.
2. Durable full output stored in a task log.
3. Background-task state and lifecycle management.
4. Automatic monitoring and agent guidance.

No classic journal-style rotation is required initially. The design instead uses bounded in-context previews, full per-task output files, a hard total output ceiling, and explicit cleanup.

## 1. Separate context output from durable output

Every task has two output representations:

1. **Bounded in-context output**
   - Used only when output is intentionally returned to the agent or displayed as a foreground tool result.
   - Must never grow without limit.
   - Uses a bounded head-plus-tail representation.

2. **Full durable output**
   - Written to a file while the process runs.
   - Available for later inspection.
   - Never requires placing the entire output into the agent context.

The in-memory representation and the log file are separate concerns.

## 2. Foreground output behavior

For a foreground command:

- Capture stdout and stderr into a temporary full-output file.
- Maintain a bounded in-memory head/tail accumulator for the current tool result.
- Apply a hard in-context character limit, with a default around 30,000 characters.
- If the output exceeds that limit, return the beginning and end of the output with a marker such as:

```text
[first portion of output]

…truncated 184,231 characters…

[last portion of output]
```

The exact head/tail split should be defined, for example:

- 40% head
- 60% tail

Result metadata should include:

- Whether truncation occurred.
- The number of omitted characters.
- The full-output file path.
- The output limit used.

This allows the renderer to provide normal collapsed/expanded behavior without placing the full output into model context.

The full foreground output file should remain available for the configured cleanup lifetime rather than being deleted immediately after the tool returns.

## 3. Background output behavior

For any background task—whether explicitly backgrounded or automatically handed off:

- Write combined stdout and stderr to:

```text
.harness/tasks/<task_id>/output.log
```

- Do not inject log contents into agent context by default.
- Do not include a large output preview in the background handoff message, status notifications, or completion notifications.
- Require explicit inspection through `bash_output` when log contents are needed.

Background messages should contain task metadata and instructions for using `bash_status` and `bash_output`, not a large output tail.

A completion message should communicate:

- Task id.
- Command.
- Final state.
- Exit code or signal.
- Duration.
- Whether output was limited.
- How to inspect the log.

It should not include the full tail by default.

## 4. Output file lifecycle

Each task should have a directory such as:

```text
.harness/tasks/<task_id>/
  metadata.json
  output.log
```

Metadata should track:

- Task identity.
- Command and cwd.
- Start and end times.
- State.
- Exit information.
- Last output timestamp.
- Output bytes written.
- Whether the output ceiling was reached.
- Log path.

### Cleanup rules

- `bash_clear` removes finished task metadata and logs.
- A normal harness/session exit performs automatic cleanup of eligible task records and logs.
- Running-task behavior on session exit must be explicit:
  - either terminate running tasks and remove their logs, or
  - preserve them for recovery after restart.
- If crash recovery is supported, logs and metadata for surviving tasks remain available, and tasks whose process ownership cannot be verified become `unknown`.

This session-exit policy must be resolved before implementation.

## 5. Hard per-task output ceiling

In addition to the foreground in-context preview limit, every task needs a larger hard total-output ceiling.

When combined stdout/stderr reaches the ceiling:

1. Stop accepting additional output.
2. Write a final diagnostic note indicating that the output limit was exceeded.
3. Mark the task as output-limited.
4. Terminate the full process group.
5. Report a distinct failure reason.

The ceiling applies to both foreground and background tasks.

The limit counts combined stdout and stderr bytes, not separate per-stream limits. A configurable default should be selected; a large upper bound is possible, but the default should be materially smaller than several gigabytes unless there is a clear use case.

The implementation should reserve enough space for the final diagnostic note so a task never silently hits the limit without explaining why.

This ceiling is distinct from:

- The foreground in-context preview limit, approximately 30k characters.
- The bounded collapsed UI preview, approximately five lines.
- Any per-call `bash_output` read limit.

## 6. `bash_output` behavior

`bash_output` is the primary way to inspect background logs.

It should support:

- `task_id`.
- Line or byte offset.
- Maximum lines or bytes.
- Optional tail mode.
- Optional search/filtering later, if useful.

Its default result should itself be bounded and collapsed. It must never automatically inject the entire log into context.

The tool should clearly report:

- Which portion of the log was returned.
- Whether more output exists before or after it.
- Total recorded output size.
- Whether the task output was capped or truncated.

## 7. `bash_status` behavior

`bash_status` returns metadata by default, not output.

It should include:

- State.
- Duration.
- Exit code.
- Last output timestamp.
- Silent duration.
- Stall status.
- Total output bytes.
- Output-limit status.
- Log availability.
- Recommended next action.

A very small preview could be optional, but the default should be status-only so background output is not inserted into context unless requested.

## 8. Foreground/background timing integration

The output policy integrates with execution policy as follows:

- Foreground commands use the bounded in-memory head/tail result and a full temporary output file.
- If a foreground command is handed off:
  - promote or move its temporary file into the task's permanent log directory;
  - stop returning output in the foreground result;
  - continue writing only to the task log;
  - return task metadata to the agent.
- Explicitly backgrounded tasks start directly with their per-task log.
- Background tasks are inspected through tools rather than automatic output injection.

The handoff must not duplicate the same output into both the tool result and the background notification.

## 9. Prompt and notification changes

### System prompt

The system prompt should explain:

- Foreground results are bounded but have a full-output file.
- Background task output is not included automatically.
- Use `bash_status` for state and progress metadata.
- Use `bash_output` when logs are needed.
- Use `bash_wait` for bounded waiting.
- Do not use sleep-based polling.
- A task being alive does not necessarily mean it is making progress.
- Output-limit termination is different from ordinary command failure.

### Background handoff message

The automatic handoff message should contain:

- Task id.
- Command.
- Handoff reason.
- Duration.
- Last output timestamp.
- Current state.
- Log availability.
- Available tools.

It should not include a large output tail by default.

### Stall notification

A stall notification should contain:

- Task id.
- Silent duration.
- Total duration.
- Current state.
- Last output timestamp.
- Instructions to call `bash_status`, then `bash_output` if needed.

It should not claim that the task is definitely hung.

### Completion notification

A completion notification should contain:

- Task id.
- Final state.
- Exit code or signal.
- Duration.
- Output-limit status, if applicable.
- Instructions to use `bash_output` for logs.
- Instructions to use `bash_clear` when finished.

No output log should be included automatically.

## 10. Agent opt-in

The agent should be able to choose immediate backgrounding with:

```json
{ "background": true }
```

This should be recommended for:

- Known-long builds.
- Test suites with unpredictable duration.
- Servers and watchers.
- Package installation.
- Commands the agent does not need to block on.

A future optional control could allow an agent to request a shorter foreground observation period, but it should remain subject to a harness safety cap.

## 11. Implementation phases

### Phase 1: output capture abstraction

Create a shared capture layer that can:

- Write stdout/stderr to a file.
- Maintain a bounded foreground head/tail accumulator.
- Count bytes toward the hard task ceiling.
- Emit last-output timestamps.
- Add an output-limit diagnostic.
- Kill the process group on ceiling violation.

### Phase 2: foreground result metadata

Add:

- Bounded head/tail rendering.
- Truncation metadata.
- Full-output path metadata.
- Cleanup ownership for foreground temp files.

### Phase 3: persistent background task logs

Add:

- Per-task directories.
- Metadata persistence.
- Log promotion from foreground to background.
- `bash_clear` cleanup.
- Session-exit cleanup and crash-recovery behavior.

### Phase 4: companion tools

Implement:

- `bash_status` without output by default.
- `bash_output` with bounded reads and pagination.
- `bash_wait` with bounded blocking.
- `bash_kill`, `bash_list`, and `bash_clear`.

### Phase 5: notifications and prompts

Update:

- System prompt.
- Automatic handoff message.
- Stall message.
- Completion/failure messages.
- Output-limit failure message.

### Phase 6: tests

Add coverage for:

- Foreground output below the context cap.
- Foreground head/tail truncation.
- Full-output file availability.
- Foreground-to-background log promotion.
- Background output staying out of context by default.
- On-demand paginated log reads.
- Output-ceiling termination.
- Diagnostic note on output-limit termination.
- Cleanup through `bash_clear`.
- Cleanup on normal session exit.
- Recovery behavior after restart or crash.
- No duplicate output injection in handoff and completion notifications.

## 12. Decisions required before implementation

Before coding, confirm:

1. Whether the hard total output ceiling applies equally to foreground and background tasks.
    - Both
2. The default total output ceiling and its maximum allowed value.
    - 5 GB?
3. Whether foreground full-output files are exposed to the user/agent and how long they are retained.
    - follow default pi bash behavior
4. Whether background handoff and completion messages contain no output at all by default.
    -
5. Whether normal session exit kills running tasks or preserves them for recovery.
       - When pi session exits, so does all running tasks they are killed
6. Whether `stalled` is a terminal state or a recoverable condition.
      - It's a suggestion to the agent that they should check the output and CONSIDER if it's stuck or still making progress
7. Whether the full-output file should use bytes as the hard limit while reporting truncation in characters.
      - 5 GB hard limit - processes killed if output gets that big
8. Whether `bash_clear` clears one task, all finished tasks, or supports both modes.
      - Both
9. Whether this is a compatible extension of the existing tool names or a breaking rewrite to `bash` plus `bash_*` companions.
      - we are overriding the default bash re-using as much of it's implementation as possible (within reason)


---

Some  additional info to guide

## Output shown — agent vs. user (Pi collapsed/off model)

**Key framing:** Pi's UI has a per-tool **collapsed / off** toggle that the user controls at render time. **Collapsed** → a few lines (default ~6, or `rows - 20`), plus a hidden-line count and an expand hint. **Off (expanded)** → everything, up to a hard cap (built-in bash: **last 2000 lines or 50KB**, whichever is first). Crucially: **collapsed vs. off is a UI toggle that doesn't change what's stored** — the full log is always captured to the file; the toggle only changes what's *rendered*. The agent's context, meanwhile, gets its own bounded previews regardless of the UI toggle.

| Event | What the **agent sees** (injected / tool result) | What the **user sees (collapsed)** | What the **user sees (off / expanded)** |
|---|---|---|---|
| **Foreground `bash` completes** | Head+tail clip, truncated with `…truncated N chars…` (cap ~30k). | ~6 lines + `↳ N lines` + `Ctrl+O` expand hint. | Full output up to hard log cap (2000 lines / 50KB), scrollable. |
| **Background handoff** (healthy, promoted) | `task_id`, state `RUNNING`, elapsed; **no output body** (opt. last 1 line). | Collapsed header row only, no body. | Live streaming output continues in the background panel (unbounded until cap). |
| **Background stall** | `task_id`, state `STALLED`, silent duration, **small preview (~1–2 KB)** / last ~6 lines. | `⚠ stalled` badge + ~6 lines + count + expand hint. | Full live tail; user can scroll/expand to the point it went quiet, or `bash_kill`. |
| **Completion — success** | `task_id`, `COMPLETED`, exit `0`, duration, **last ~500 B / last line**. | ✅ + `↳ 1 line` style summary + expand hint. | Full scrollable output from the panel. |
| **Completion — failed** | `task_id`, `FAILED`, exit `N`, **head+tail ~2 KB** of the error tail. | ❌ + red exit code + ~6 lines of the error + count + expand hint. | **Full log openable** — user sees the entire error. |
| **Cancelled (`bash_kill`)** | `task_id`, `CANCELLED`, exit signal, short tail. | ⏹ stopped + few lines + expand hint. | Full log, scrollable to the kill point. |
| **`bash_output` (on-demand)** | Raw log from `offset`, up to `max_lines` (def 200). | Rendered as its own tool block, same collapsed/off toggle. | Full requested range. |

## The three distinct surfaces (the important clarification)

Pi's model makes it clear there are **three** output audiences, not two, and they must stay separate:

1. **The UI collapsed view** — a *render-time* decision by the user; captures ~6 lines + hidden-line count + expand hint, and collapses to nothing for a running handoff.
2. **The UI off/expanded view** — everything up to the harness's hard capture bound (2000 lines / 50KB), scrollable; this is the user's "ground truth."
3. **The agent's context** — bounded previews chosen *by policy per event* (handoff: none; stall/failed: ~1–2 KB; success: ~1 line), independent of the user's toggle. The agent never sees the full stream by default; it calls `bash_output` for more.

## Key points that follow

- **The toggle never loses data.** Because full output is always captured to the per-task log file, toggling collapsed↔off only changes rendering. The agent's bounded previews and `bash_output` reads draw from the same source of truth.
- **Collapsed ≈ agent-preview default, not identical.** Collapsed shows ~6 lines to *users*; the agent's injected previews are sized by *event value* (none on handoff, larger on failure) — don't conflate the two policies. If you want them aligned, you can derive agent previews from the same `collapsePreviewLines` cap.
- **Expose the caps as config** so operators tune one knob:
  ```jsonc
  "ui": { "bashCollapsedLines": 6, "bashMaxOutput": "2000 lines | 50 KB" },
  "agent": { "handoffPreview": "none", "stallPreviewKB": 2, "failPreviewKB": 2, "successPreviewLines": 1 }
  ```
- **A "summary" mode exists as a third UI option** (just `↳ 3 lines returned`, no body) — handy for the noisiest tools; the agent column is unaffected by it.

**Bottom line:** the user's collapsed/off toggle is a *UI-layer* view over a single always-captured log file; the agent gets independent, event-sized previews in context. Design them as separate policy surfaces fed by one store of truth, and your minimal/full cuts still stand — this adds the rendering dimension without changing the tool surface.
