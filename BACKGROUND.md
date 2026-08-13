# Background Jobs Across Agent Harnesses — Tool Calls, Injections & Behavior

A survey of how the major agent harnesses and the largest pi extensions handle background
(long-running) jobs: what the model-facing tools look like, what gets injected into the
model's context and when, and the overall lifecycle behavior.

Surveyed: **OpenAI Codex CLI**, **Claude Code**, **OpenCode**, **Cursor**, **Devin**,
**pi-background-tasks** (ismailsaleekh), **pi-patty-bg-tasks** (patty-io),
**@vanillagreen/pi-background-tasks**. Sources: primary source code (fetched/read directly,
dates noted), official docs, and research briefs from six parallel research agents
(Aug 2026). Claims that are community-sourced or inferred are explicitly labeled.

---

## 1. Executive summary

1. **No harness injects a per-turn "running jobs" status summary.** Nothing in the surveyed
   field injects a list of active jobs, their durations, or aggregate state into the model
   context on a timer or per turn. Every harness injects **only on terminal events**
   (completion, failure, new output), and several inject nothing at all.
2. **Codex is the pure-pull outlier.** Its model has no list tool, no kill tool, and
   receives **zero** background-process injection: completion events (`ExecCommandEnd`) are
   consumed by the TUI only. The model must remember numeric `session_id`s and poll with
   `write_stdin`. Known failure modes follow from this: ids are lost on context compaction
   (jobs become unreachable), eviction at the 64-process cap is silent, and nothing wakes
   the model between turns.
3. **Everyone else converges on push-on-completion with a "you'll be notified" contract.**
   The tool description language is load-bearing in every harness ("You do not need to
   check the output right away — you'll be notified when it finishes" / "DO NOT sleep,
   poll for progress…"). The real design axis is *delivery*: passive-queued at the next
   idle point (Claude Code), coalesced summary at turn end + wake-when-idle (pi-patty),
   waking new turns (OpenCode, vanillagreen), or intended-but-fragile wake (Cursor).
4. **The pi ecosystem has already solved most of Codex's gaps** — explicit kill tools,
   list tools, completion push, coalescing, budgets, durable replay — and adds two
   concepts nobody in the harness world has: **coalesced summaries** (patty) and
   **wake budgets + durable replay** (vanillagreen).
5. **Cursor is the cautionary tale**: undocumented background shells, a file format that
   changed 3× in two weeks, and wake-on-completion that measurably fails in the field
   (0/4 auto-resume trials in a controlled test; shells reaped ~80–100 s after turn end).

---

## 2. The design space

| Axis | Choices observed | Who |
|---|---|---|
| **Launch surface** | Unified yield-based tool (`yield_time_ms` → auto-background) | Codex |
| | Flag on the main shell tool (`run_in_background: true`) | Claude Code, pi-patty |
| | Dedicated launch tool | ismailsaleekh (`bg_run`), patty (`bash_bg`), vanillagreen (`bg_task spawn`) |
| | Background *subagents*, not commands | OpenCode (`task background:true`), Devin (managed child Devins) |
| **Job identity** | Numeric `session_id` (random 1,000–100,000) | Codex |
| | Opaque `task_id` / id string | Claude Code, pi extensions |
| | Session id (child session) | OpenCode |
| **Monitor** | Poll tool by id | Codex `write_stdin`, `bg_logs`, `jobs output`, `TaskOutput` |
| | `Read` on output file | Claude Code (TaskOutput deprecated → Read) |
| | Push-per-line watcher | Claude `Monitor`, patty `monitor`, vanillagreen `notifyPattern` |
| **Kill** | Dedicated kill tool | Claude `TaskStop`, all three pi extensions |
| | Control-byte through stdin (`\u0003` = Ctrl-C) | Codex only (non-TTY sessions accept *only* that byte) |
| | None | OpenCode, Cursor |
| **List** | None for the model | Codex, Cursor, OpenCode |
| | None, but *errors list running jobs* | Claude Code (`TaskStop`/`TaskOutput` on unknown id) |
| | Explicit list tool/action | All three pi extensions |
| **Completion delivery** | None (pure pull) | Codex |
| | Passive, queued to next idle | Claude Code |
| | Coalesced at `agent_end` (passive) + steer-wake when idle | pi-patty |
| | Wake a new turn on completion | OpenCode (idle only), vanillagreen (aggressive) |
| | Intended wake, fragile in practice | Cursor |
| **Extra machinery** | Coalescing, stall detection, sleep-blocking | pi-patty |
| | Wake budgets, durable replay, output-pattern wakes, orphan watch | vanillagreen |
| | LRU eviction at cap (protected MRU set) | Codex |

---

## 3. OpenAI Codex CLI

*Verified against `openai/codex` `main` (fetched 2026-08-11/12; `process_manager.rs` last
touched 2026-08-11). Files: `codex-rs/core/src/tools/handlers/shell_spec.rs`,
`codex-rs/core/src/tools/handlers/unified_exec/{exec_command.rs,write_stdin.rs}`,
`codex-rs/core/src/unified_exec/{mod.rs,process_manager.rs,process.rs,async_watcher.rs}`,
`codex-rs/core/src/tools/context.rs`, `codex-rs/core/src/config/mod.rs`,
`codex-rs/tui/src/{slash_command.rs,chatwidget.rs,history_cell/exec.rs}`,
`codex-rs/core/src/session/turn.rs`.*

### 3.1 Model-facing tools (the complete shell surface)

Three tools. No list tool, no kill tool, no status tool.

**`exec_command`** — description: *"Runs a command in a PTY, returning output or a session
ID for ongoing interaction."*

| Param | Description (verbatim) |
|---|---|
| `cmd` (required) | Shell command to execute. |
| `workdir` | Working directory for the command. Defaults to the turn cwd. |
| `tty` | True allocates a PTY for the command; false or omitted uses plain pipes. |
| `yield_time_ms` | Wait before yielding output. Defaults to 10000 ms; effective range is 250–30000 ms. |
| `max_output_tokens` | Output token budget. Defaults to 10000 tokens; larger requests may be capped by policy. |
| `shell` | Shell binary to launch. Defaults to the user's default shell. |
| `login` | True runs the shell with -l/-i semantics; false disables them. Defaults to true. |
| `sandbox_permissions` | Per-command sandbox override (`use_default` / `with_additional_permissions` / `require_escalated`). |
| `justification`, `prefix_rule`, `additional_permissions` | Approval-related. |

Output schema: `{ chunk_id?, wall_time_seconds (required), exit_code?, session_id?,
original_token_count?, output (required) }` — `session_id` present when still running,
`exit_code` when it finished during the call.

**`write_stdin`** — description: *"Writes characters to an existing unified exec session
and returns recent output."* Params: `session_id` (required, number), `chars` (*"Bytes to
write to stdin. Defaults to empty, which polls without writing."*), `yield_time_ms`
(empty polls 5000–300000 ms; non-empty writes 250–30000 ms), `max_output_tokens`.
Same output schema as `exec_command`.

**`shell_command`** — synchronous, no sessions: `command` (required), `workdir`,
`timeout_ms` (default 10000), `login`. Kills at timeout; no backgrounding.

**Kill semantics** (from `process_manager.rs`): `const INTERRUPT: &str = "\u{3}"`.
Non-TTY sessions accept **only** the interrupt byte (→ `process.interrupt()`, SIGINT);
any other non-empty input returns `StdinClosed`. TTY sessions accept arbitrary bytes.

### 3.2 What the model sees (result format, verbatim from `tools/context.rs`)

```
Chunk ID: <id>                        ← only when output since last chunk
Wall time: <n>.XXXX seconds           ← per-call wait, NOT job age
Process exited with code <n>          ← only when finished during this call
Process running with session ID <n>   ← still running
Original token count: <n>             ← when truncated
Output:
<output text>
```

`wall_time` is measured from the start of *that call* (`Instant::now() - start`); the
model is never told how long a job has been running. Job age can only be inferred by
summing wall times across its own polls.

### 3.3 Injection behavior

**None.** There is no context fragment for running processes, no completion message, no
per-turn status. `ExecCommandEnd` / `ExecCommandOutputDelta` / `TerminalInteraction`
events are handled by the TUI only (`turn.rs` → `realtime_text_for_event` maps them to
`None` for realtime display; `history_cell/exec.rs` renders the terminal box). Turn
context is built from recorded conversation history. The `legacy_unified_exec_process_
limit_warning.rs` file exists in the tree but could not be found wired into any prompt
path — treat as vestigial. Sandbox/network denial text is returned as the tool result
itself, not injected separately.

Consequences:
- **Within a turn**, the model "waits" by polling `write_stdin` in a loop until
  `exit_code` appears.
- **Between turns**, nothing wakes the model. A finished job is discovered only if the
  model happens to poll later. After context compaction, session ids are unreachable
  (orphaned jobs — the subject of codex issues #8656 / #3968).

### 3.4 Capacity & eviction

- `MAX_UNIFIED_EXEC_PROCESSES = 64` concurrent sessions.
- On a new `exec_command` at the cap, `prune_processes_if_needed` evicts:
  1. **Protected set** = the 8 most-recently-used processes (never evicted).
  2. First preference: an already-*exited* non-protected process (cheap prune).
  3. Otherwise: the least-recently-used non-protected *live* process → silently
     `terminate()`d.
  4. If the only candidates hold interaction locks, the store may transiently exceed the
     soft cap rather than kill a locked process.
- Eviction is **silent** — no message to the model; discovered only when the next poll
  of that id fails.
- Per-process output: `HeadTailBuffer`, 1 MiB / ~10k token cap; per-call reads are
  incremental via `chunk_id` cursors.
- `session_id` allocation: random 1,000–100,000 in production; ids released on failure;
  a process whose launching `exec_command` call is still active cannot be terminated.

### 3.5 User surface

- Footer: `"{count} background terminal{plural} running · /ps to view · /stop to close"`.
- `/ps` — lists background terminals (up to 16 displayed): command (first line ≤80
  graphemes) + up to 3 recent output chunks; `• No background terminals running.` when
  empty. Human-only; renders from TUI-local state.
- `/stop` (alias `/clean`) — terminates **all** background terminals. No single-kill
  user command (issue #17821 is the open request).
- Config: `background_terminal_max_timeout` (ms, default 300000) bounds poll windows.

---

## 4. Claude Code

*Sources: official tools reference (code.claude.com/docs/en/tools-reference), interactive
mode / commands / env-vars docs, community source-reading of the bundled cli.js
(readingclaude.club/en/state/background), GitHub issues #21048 / #18544. Community-
sourced claims are labeled.*

### 4.1 Model-facing tools

**`Bash`** — inputs: `command`, `description`, `timeout` (ms; default 120000 bound by
`BASH_DEFAULT_TIMEOUT_MS`, ceiling `BASH_MAX_TIMEOUT_MS` = 600000), and
`run_in_background` whose description is a behavioral contract (verbatim from bundled
source):

> "Only use this if you don't need the result immediately and are OK being notified when
> the command completes later. You do not need to check the output right away — you'll be
> notified when it finishes. You do not need to use '&' at the end of the command when
> using this parameter."

**`TaskStop(task_id)`** — *"Stops a running background task by ID. It also accepts an
agent-team teammate or a named background agent by agent ID or name. When no task matches
the ID, the error lists the running background agents by ID and description."* — the
error-path listing is Claude's substitute for a list tool.

**`TaskOutput(task_id)`** — *"Retrieves output from a background task. Deprecated in
favor of `Read` on the task's output file path."* Same error-lists-running-agents
fallback. (Older releases: `BashOutput`/`KillShell`.)

**`Monitor`** — *"Runs a command in the background and feeds each output line back to
Claude, so it can react to log entries, file changes, or polled status mid-conversation.
Can also open a WebSocket and treat each incoming message as an event."*

**`Agent`** — also takes `run_in_background` (subagents run in background by default as
of v2.1.198; foreground when the result is needed before continuing).

### 4.2 Background mechanics & injection

- `run_in_background: true` returns a task ID immediately; output streams to a file.
- **Auto-background at timeout**: when a foreground command hits its timeout it is moved
  to the background instead of killed. The tool result states verbatim: *"Command did not
  complete within its 120s timeout and was moved to the background"* (seconds matching
  the applied timeout), followed by the task ID and output-file path. Directory changes
  in the moved command don't carry over: *"Session cwd remains \<dir>; directory changes
  made by the backgrounded command do not apply to subsequent commands."*
- **Never auto-backgrounds**: commands starting with `sleep`, commands containing `git`
  anywhere, and compound commands the parser can't fully parse (these are killed at
  timeout).
- **Completion injection**: a `<task-notification>` (task_id, status, output-file path)
  is pushed; user-visible as `⏺ Background command "…" completed (exit code 0)`.
  Delivery is **passive**: notifications have latency until the next idle point, they
  queue, and they never interrupt an in-progress turn. Completion is injected into the
  next turn's context rather than forcing a continuation. (Issue #18544 requests a
  setting to disable these notifications.)
- `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` disables all background functionality;
  `CLAUDE_AUTO_BACKGROUND_TASKS=1` additionally auto-backgrounds subagents (~2 min) and
  long MCP calls.

### 4.3 Limits & user surface

- Output: commands writing past **5 GB** are killed; valid results inline to ~30,000
  chars (then a file path + preview; file truncated past 64 MiB); failures to ~10,000
  chars (head/tail excerpt). `BASH_MAX_OUTPUT_LENGTH` widens the read-back window
  (default 30,000, ceiling 150,000).
- Cleanup: tasks killed on exit; headless (`claude -p`) background shells terminated
  ~5 s after the final result; subagent-owned shells die after 60 min
  (`CLAUDE_SUBAGENT_BG_SHELL_MAX_MS`).
- Concurrency: community source-reading reports a cap of roughly `min(16, cpu-2)` with
  excess tasks queued — **not confirmed by official docs**.
- User surface: `/tasks` (alias `/bashes`) to view/manage background work; `Ctrl+B`
  backgrounds the running Bash command (tmux: press twice); `Ctrl+X Ctrl+K` stops all
  background subagents (twice within 3 s). `/background` (`/bg`) detaches the *whole
  session* as a background agent — a different feature from background bash tasks.

---

## 5. OpenCode

*Source: `sst/opencode` `dev` branch — `packages/opencode/src/tool/{shell.ts,
shell/prompt.ts, task.ts, task.txt}`, `src/session/prompt.ts`, `src/effect/runner.ts`,
`packages/core/src/background-job.ts`; docs at opencode.ai. Note: there is **no
`session` tool** in core — the "session" tool exists in some community forks, not core.*

### 5.1 Model-facing tools

**`bash`** (tool id still `bash`; implementation moved to `shell.ts`):
```json
{ "command": "The command to execute",                                      // required
  "timeout": "Optional timeout in milliseconds",
  "workdir": "The working directory to run the command in. Defaults to the current directory. Use this instead of 'cd' commands." }
```
**Foreground only.** Default timeout 120,000 ms (`flags.bashDefaultTimeoutMs`); on expiry
the process is killed (3 s force-kill grace) and the result gains `<shell_metadata>shell
tool terminated command after exceeding timeout {ms} ms…</shell_metadata>`. No background
flag, no auto-background threshold. Output truncated at 2000 lines / 50 KB (configurable),
spilled to `<data-dir>/tool-output/tool_*` with `...output truncated...` + `Full output
saved to: {file}`; 7-day retention.

**`task`** (the actual background mechanism — background *subagents*, not commands):
```json
{ "description": "A short (3-5 words) description of the task",           // required
  "prompt": "The task for the agent to perform",                          // required
  "subagent_type": "The type of specialized agent to use for this task",  // required
  "task_id": "This should only be set if you mean to resume a previous task…",
  "command": "The command that triggered this task",
  "background": "Run the agent in the background. You will be notified when it completes. DO NOT sleep, poll, or proactively check on its progress" }
```
`background:true` requires `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true`. Result is
XML the model parses:

```xml
<task id="<sessionId>" state="running"><summary>Background task started</summary>
<task_result>The task is working in the background. You will be notified automatically when it finishes.
DO NOT sleep, poll for progress, ask the task for status, or duplicate this task's work —
avoid working with the same files or topics it is using.
Work on non-overlapping tasks, or briefly tell the user what you launched and end your response.</task_result></task>
```

### 5.2 Injection behavior

On completion, `injectBackgroundResult` appends a **new synthetic user message** to the
parent session containing `<task id="…" state="completed|error"><summary>Background task
completed/failed: {description}</summary><task_result|task_error>{text}</task_result>
</task>`, then calls `prompt()` → `loop()` → `runLoop()` — i.e., **completion wakes a new
model turn when the parent is idle**. Mid-turn completions are forked with
`Effect.ignore` and effectively wait (the synthetic message persists in history; a busy
session awaits its existing run — inferred from `Runner.ensureRunning` semantics).
No `SESSION_STATUS_CHANGED`-style event is injected into model context; status events go
to clients/TUI only. Subtask slash commands (e.g. `/review`) inject *"Summarize the task
tool output above and continue with your task."* when done.

### 5.3 Durability, limits, user surface

- Background jobs are **process-local**: restart or owner-scope closure loses status and
  interrupts live work. Sessions persist (SQLite) and resume via `/sessions`.
- No concurrency cap on background jobs (Map registry, unbounded); `subagent_depth`
  limits nesting (default 1).
- User surface: `/sessions` (aliases `/resume`, `/continue`), `/new`; **no `/jobs`
  command**. Child/subagent sessions appear in the session list; optional
  `subagent_done` sound/desktop notification when `attention.enabled`.

---

## 6. Cursor

*Sources: official Terminal docs (cursor.com/docs/agent/tools/terminal — thin; ~170
words, no tool schema), changelog entries, Cursor forum threads (community-attested
details are labeled; several behaviors are undocumented and unverifiable from official
sources).*

### 6.1 Model-facing tools

The terminal tool schema is **not published**. Community source-reading shows the
internal shell tool exposes:
- `block_until_ms` — set `0` for non-blocking / background execution;
- `notify_on_output` — a regex sentinel watcher that wakes the agent when matching output
  appears.

There is **no agent-facing list or kill tool** for background shells; agents poll state
files or use shell-level `kill`. Foreground commands running past roughly 10 minutes are
auto-converted into "Background Shells" (community-reported; **undocumented** — no
changelog entry announces the feature or timeout, and the state-file format changed 3×
in two weeks per forum reports).

### 6.2 Injection & behavior

- Background-shell logs are written to state files under
  `.cursor/projects/<project>/terminals/` with a header block (`pid:`, `cwd:`,
  `command:`, `started_at:`, `running_for_seconds:`) and footer (`exit_code:`,
  `elapsed_ms:`, `ended_at:`) in the newer format.
- On completion: the human gets a toast (and OS notifications); a client-side wake path
  exists (`_runWakeupAction`, `_maybeDispatchBackgroundCompletions`, `runIdleHooks`).
  **In a controlled community trial, auto-resume succeeded 0/4 times after an idle chat,
  and 3/4 shells were killed ~80–100 s after the turn ended.** Treat Cursor's wake-on-
  completion as intended-but-fragile.
- The `/loop` skill (official, changelog 3.5) runs a background shell with
  `block_until_ms: 0` + `notify_on_output` and feeds the payload prompt each time the
  sentinel prints.
- Background shells are tied to the session/agent lifecycle — no guarantee of survival
  after the turn ends; even `nohup … & disown` is killed at tool-call boundaries.
  Workaround used by the community: full detachment (`start_new_session=True` + log
  file) or cloud agents.

---

## 7. Devin

*Sources: docs.devin.ai, cognition.com blog, Devin REST v3 docs. Devin is a closed,
hosted product — model-facing tool schemas are **not public**. Documented facts are
labeled FACT; everything about model-side mechanics is labeled SPECULATION.*

### 7.1 Documented surface (FACT)

- Cloud sessions have a Workspace with three developer tools the *user* watches: **Shell**
  (live command execution, output logs, command history with previews and click-to-time-
  travel, read-only → writable terminal takeover), **IDE**, and **Browser**. Devin runs
  "diverse batches of actions concurrently" (browser + shell + reading in parallel).
- Long-running work is an explicit use case: dev servers, Docker builds, CI/CD,
  migrations, batch jobs; cloud VMs keep going after the laptop closes.
- **Devin CLI** documents backgrounding: *"If a command is still running after the
  default wait period, Devin moves it to the background and shows how long it waited
  along with the background shell ID. Devin can then continue working and check the
  command's output later."* (Not documented for cloud sessions.)
- Parallelism is session-level: Devin 2.0 spawns **managed Devins** (child sessions in
  isolated VMs) with ACU limits, message/terminate controls, and scheduled self-messages
  to check back on long-running children.
- Environment build steps have a 1-hour timeout; long-running servers belong in the
  session, not build steps.
- Approval gating is by **confidence score** (🟢🟡🔴), not per-command.

### 7.2 Injection behavior

Undocumented (SPECULATION): the cloud harness's command-output protocol (streaming vs.
final-output injection, truncation, poll semantics) is unpublished. The CLI's documented
"background shell ID, check output later" implies poll/read semantics. The REST v3 API
exposes sessions, chronological messages, and attachments (logs/screenshots); raw shell
transcripts are not exposed via REST. The official **Devin MCP server** exposes a session
**event timeline** (list/search event summaries and details) — the closest documented
route to command-level data.

---

## 8. pi extensions

### 8.1 `pi-background-tasks` (ismailsaleekh)

*Verified from local source copy v2.1.4: `src/extension.ts`, `src/core/registry.ts`,
`src/core/common.ts`.*

**Tools:** `bg_run` (`name`, `command`, `isAgent` required; `description?`,
`timeoutSeconds?`, `notifyOnCompletion?=true`, `triggerOnCompletion?=true` — spawn a
named shell task, return id + PID + output path immediately); `bg_run_pi_attested`
(attested `pi --mode json` child; notifications hard-disabled); `bg_status` (list /
snapshot by id prefix); `bg_logs` (`taskId`, `maxBytes?` ≤50 KB, `tail?=true`);
`bg_kill` (`taskId`). Delegate/Fusion workflows add `bg_delegate`, `bg_result`, and
`fusion_*` tools.

**Injection:** on terminal state (completed/failed/killed, incl. timeout and output-cap),
`notifyCompletion` sends one durable XML message per task via
`pi.sendMessage({customType:'background-task-notification', display:true, details:
snapshot}, {deliverAs:'followUp', triggerTurn: task.triggerOnCompletion})`:

```xml
<background-task-notification>
  <task-id>…</task-id><task-name>…</task-name><status>…</status>
  <exit-code>…</exit-code><error>…</error><output-file>…</output-file>
  <summary>Background task "…" …</summary>
  <guidance>Terminal state and output metadata are durable. Do not call bg_status to
reconfirm; use bg_logs only if output is needed.</guidance>
</background-task-notification>
```

`triggerOnCompletion` defaults **true for `bg_run`** (completion wakes a follow-up
agent turn) and **false for `/bg`** (user-launched: passive). A `notified` latch prevents
duplicates; prompt guidelines tell the model *"do not sleep/bg_status to wait; the
terminal notification will wake you."*

**Limits & lifecycle:** output cap 20 MB (`PI_BG_MAX_OUTPUT_BYTES`) → SIGTERM; log reads
≤50 KB; 100-task recent ring; 3 s SIGTERM→SIGKILL grace; optional per-task timeout;
session_shutdown kills all running; **no running-concurrency cap**; tasks live under
`.pi/tasks/<session-id>-<pid>/` with atomic metadata writes; agent-telemetry wrapper for
`isAgent:true` pi tasks; EventBus channels (`pi-background-tasks:request:v1` etc.) for
other extensions.

**User surface:** `/bg`, `/tasks`, `/bg-tasks`, `/bg-clear`, `/bg-update`, `/jobs`,
`/logs <id>`, `/kill <id>`; shortcuts `shift+down` (dock), `ctrl+alt+c`; footer status.

### 8.2 `pi-patty-bg-tasks` (patty-io)

*Verified from local source copy v1.1.6: `src/tools/bash.ts`, `src/notify.ts`,
`src/lifecycle.ts`, `src/input.ts`, `src/shortcuts.ts`, `src/spawn.ts`, `src/types.ts`.*

**Tools:** `bash` (override; `command`, `timeout` = auto-background threshold, default
120 s, `run_in_background`, `description`); `bash_bg` (`command`, `name?`, `timeout?`,
`notify?=true`); `jobs` (`action`: list|output|kill|attach|search|cleanup|stats);
`agent_bg` (`prompt`, `cwd?` — detached `pi -p` child with streamed progress);
`monitor` (`command`|`ws{url,protocols?}`, `description` required, `persistent?`,
`timeout_ms?` 300 s default / 3600 s max — each stdout line / ws frame is an event;
firehose auto-stop at 500 lines/10 s). `job_decide` exists in 1.1.6 (unforced) and is
removed in 2.0.

**Injection (coalesced):** finishes queue into buffers; mid-turn they flush **once at
`agent_end`** as `{deliverAs:'followUp', triggerTurn:false}` (passive, no wake); while
the agent is idle a 400 ms timer flushes as `{deliverAs:'steer', triggerTurn:true}`
(wakes). Message: customType `job-finished`, content:

```
4 background jobs finished (1 failed, 1 killed)
✓ npm test (5s, job-1-1)
✗ deploy (5s, exit 1, job-3-2) → jobs({ action: "output", jobId: "job-3-2" })
```

The `→ jobs output` nudge appears **only for failed** jobs (parity with Claude Code's
`notified`-flag philosophy); `outputConsumed` suppresses notices for jobs already read
via attach/output; monitors get `◉ desc — summary` lines. Manual-background notice
(customType `bg-manual`): *"Command was manually backgrounded by user. Output is being
captured. You can continue working — use the jobs tool to check on it later."*
**Cooperative steering** (`input` event): typing while a foreground command runs
backgrounds it, `ctx.abort()`s the turn, and re-delivers the message via
`pi.sendUserMessage(text, {deliverAs:'followUp'})`.

**Mechanics:** Claude-Code-style spawn — detached child, stdout+stderr written straight
to a file fd (no tmux, no JS in the data path), 2 s quick-completion window skipping the
backgrounding machinery, abort-signal handled so genuine Esc cancels kill but steering/
Ctrl+B/timeout background (never kill).

**Limits:** **16 concurrent jobs** (hard reject on the 17th); 100 MB log cap with
oversize auto-kill (persistent monitors exempt); stall detection (45 s quiet +
prompt-like tail → warning); `sleep ≥2s` blocked with steering to `jobs attach`/
`monitor`/`until` loops; SIGTERM tree kill; 24 h stale-log sweep; in-memory registry —
shutdown kills all.

**User surface:** `/bg`, `/bg-list`, `/bg-version`; `ctrl+shift+b` (background
foreground), `ctrl+shift+j` / `shift+down` (manager dock), `ctrl+shift+x` (kill newest);
live sidebar pills showing latest output line + duration.

### 8.3 `@vanillagreen/pi-background-tasks`

*Sources: npm v1.6.2; vstack monorepo README/DEVELOPMENT.md;
`extensions/{registrations.ts,wake-events.ts,constants.ts}`.*

**Tools:** `bg_task` (`action`: spawn|list|log|stop|clear; spawn params: `command`,
`cwd?`, `title?`, `notifyOnExit?=true`, `notifyOnOutput?=false`, `notifyPattern?`,
`notifyMode?` always|transition|first-match-only, `dedupeKey?`, `timeoutSeconds?=0`);
`bg_status` (`action`: list|log|stop, `pid?`). Also **intercepts the built-in bash
tool** for monitor-pattern commands (`watch`, `tail -f`, `journalctl -f`, sleep loops)
and auto-backgrounds them; `alt+.`/`/bg:next` arms the next bash call for backgrounding.

**Injection (per-task wakes, aggressive but budgeted):** customType
`vstack-background-tasks:event`. Exit wake (terminal state; **durable — replayed on the
next `session_start` if missed**): *"Background task {id} finished. Command:
{preview≤160}"*; delivery `{deliverAs:'followUp', triggerTurn:true}`. Output wake (new
matching output, 1.5 s settle debounce): *"Background task {id} emitted new output…"*;
delivery `{deliverAs:'steer', triggerTurn:true}` — **steer interrupts mid-turn**.
Budget-exhausted notice: *"Background task {id} output wake budget exhausted; further
output wakes suppressed. Inspect the full log with bg_task log id: …"* (steer+trigger).
Details payload carries `{eventType, eventAt, deliveredAt, sequence,
taskStatusAtEmit, outputTail ≤2000, matchedPattern?, task: snapshot}`.

**Limits:** output-wake budget **20 wakes / 20 KB cumulative per task** (exit wakes
exempt); in-memory 1 MB buffer with full log on disk; tail caps 2000/10000 chars;
timeout default off; 5 s force-kill grace; optional `systemd-run` / `nice`+`ionice`
resource controls; orphan liveness watcher (30 s + PID-reuse probe); wake ring 50;
shutdown stops tasks via systemd units where applicable.

**User surface:** `/bg` dashboard (+ `list|next|run|log|watch|stop|clear`),
`/bg log|watch <id>`; shortcuts `alt+.` (arm next bash), `alt+shift+h` (dashboard),
`alt+h` (mini-dashboard), `F5`; settings tab.

### 8.4 Side-by-side (pi extensions)

| | ismailsaleekh | patty | vanillagreen |
|---|---|---|---|
| Tools | bg_run, bg_status, bg_logs, bg_kill (+delegate/fusion) | bash(override), bash_bg, jobs, agent_bg, monitor | bg_task, bg_status (+bash interception) |
| Completion injection | 1 XML msg/task, followUp, triggerTurn=default-true (bg_run) | Coalesced summary, agent_end passive / idle steer-wake | Per-task exit wake, followUp+triggerTurn, durable replay |
| Output injection | none | none (monitor tool is explicit) | notifyPattern → steer+triggerTurn (budgeted) |
| Concurrency cap | none | 16 (hard) | none |
| Output cap | 20 MB (kill) | 100 MB (kill) | 1 MB buffer / disk log |
| Extras | telemetry wrapper, attestation, EventBus | stall detect, sleep-block, cooperative steering | wake budgets, replay, systemd, orphan watch |

---

## 9. Comparison tables (all surveyed)

### 9.1 Tool surface

| Harness | Launch | Monitor | Kill | List |
|---|---|---|---|---|
| Codex | `exec_command` (yield 10 s → session_id) | `write_stdin` empty chars (chunked) | `write_stdin` `"\u0003"` (Ctrl-C; non-TTY only this byte) | none for model; `/ps` user-only |
| Claude Code | `Bash`/`Agent` `run_in_background:true` | `TaskOutput` (deprecated → `Read` file) | `TaskStop` | none; errors list running tasks |
| OpenCode | `task` `background:true` (subagents) | — | — | `/sessions` (user) |
| Cursor | terminal tool, internal `block_until_ms:0`; ~10 min auto-bg | state files / `notify_on_output` | none (shell `kill`) | none |
| Devin | cloud Shell; CLI bg shell ID | CLI "check output later" | undocumented | command history (user) |
| ismailsaleekh | `bg_run` | `bg_logs` | `bg_kill` | `bg_status` |
| patty | `bash` override + `bash_bg` | `jobs output` / `monitor` | `jobs kill` | `jobs list` (+search/stats) |
| vanillagreen | `bg_task spawn` (+bash interception) | `bg_task log` / notifyPattern | `bg_task stop` | `bg_task list` |

### 9.2 Injection behavior

| Harness | What is injected | When / delivery | Wakes turn? |
|---|---|---|---|
| Codex | Nothing (model sees only its own tool results; `ExecCommandEnd` = TUI-only) | Poll-only | Never (pull model) |
| Claude Code | `<task-notification>` (task_id, status, output path); `⏺ Background command "…" completed (exit code 0)` | Queued at completion, delivered at next idle | Passive — never interrupts in-progress turns |
| OpenCode | Synthetic user msg: `<task id state="completed|error">…` | On subagent completion → `runLoop()` | Yes, when idle |
| Cursor | Toast/OS notification; client wake path | On shell exit / sentinel match | Intended; 0/4 success in community trial |
| Devin | Undocumented (progress + logs to user; MCP event timeline) | Unknown | Unknown |
| ismailsaleekh | XML `<background-task-notification>` per task | followUp at exit | `triggerOnCompletion` default true (bg_run) / false (/bg) |
| patty | Coalesced summary `"N background jobs finished (X failed…)"` + per-job lines | agent_end flush (passive) / idle 400 ms (steer) | Passive mid-turn, wake when idle |
| vanillagreen | Per-task exit + output wakes (budgeted) | exit: followUp; output: steer | Yes — aggressive (steer), budgeted |

### 9.3 Limits & user surface

| | Concurrency | Output cap | Auto-bg threshold | User surface |
|---|---|---|---|---|
| Codex | 64 (LRU evict; protected = 8 MRU) | 1 MiB / 10k tokens/session | 10 s | `/ps`, `/stop`=all; footer |
| Claude Code | ~min(16, cpu-2) (community) | 5 GB/task; ~30k chars inline | 120 s | `/tasks`, Ctrl+B, Ctrl+X Ctrl+K |
| OpenCode | unbounded (subagents) | 2000 lines / 50 KB, file spill | n/a (kills at 120 s) | `/sessions`; no `/jobs` |
| Cursor | undocumented (8 parallel subagents in 2.0) | undocumented | ~10 min (community) | `/loop`, `/shell`; toasts |
| Devin | parallel managed Devins (ACUs) | undocumented | CLI default wait | session UI, IDE, Slack; REST v3 + MCP |
| ismailsaleekh | none | 20 MB → kill; 50 KB reads | per-task timeoutSeconds | `/bg /jobs /logs /kill`; Shift+Down |
| patty | 16 (hard reject) | 100 MB → kill | 120 s | `/bg /bg-list`; Ctrl+Shift+B/J/X |
| vanillagreen | none | 1 MB buffer; 2 KB wake tail | off by default | `/bg` dashboard; alt+. alt+Shift+H F5 |

---

## 10. Cross-cutting patterns & anti-patterns

1. **"You'll be notified" is the universal behavioral contract.** Every push-based
   harness embeds it in the tool description so the model doesn't poll or sleep. It is
   only honest if the harness actually delivers: Codex's tool *descriptions* imply
   nothing about notifications, and its model learns the hard way that nothing comes.
2. **Kill is the sparsest surface; the pi ecosystem is the richest.** Only Claude and
   the pi extensions give the model a direct kill tool. Codex's Ctrl-C-byte is clever
   but fragile (models have been observed sending the literal string `"\u0003"`), and
   OpenCode/Cursor give the model nothing.
3. **The list-on-error trick.** Claude Code compensates for having no list tool by
   making `TaskStop`/`TaskOutput` errors enumerate running background agents. Cheap,
   effective, worth copying.
4. **Nobody lists job ages to the model.** Codex's `wall_time` is per-call wait;
   Cursor's state files record `running_for_seconds` but only for the human. Durations
   appear only inside *coalesced summaries* (patty: `✓ npm test (5s, job-1-1)`).
5. **Coalescing only exists in pi (patty).** The harnesses with per-job notifications
   (Claude, OpenCode) accept notification walls; patty's "one summary at agent_end"
   is the only designed fix, and it pairs passive mid-turn delivery with a single
   steer-wake when idle.
6. **Wake budgets + durable replay only exist in pi (vanillagreen).** The aggressive
   steer-on-output design requires a budget (20 wakes / 20 KB) and survives missed
   notifications by replaying at session start.
7. **Eviction policy exists only in Codex** (64-cap LRU with a protected MRU set) —
   and it is silent, which is its flaw. A visible eviction (surfaced via list/completion)
   preserves the policy without the opacity.
8. **PTY vs pipes is the one architectural fork.** Codex and Cursor are PTY-backed
   (interactive sessions, Ctrl-C works natively); Claude Code and the pi extensions
   (post-1.0 patty) are file-fd/pipes (detached, robust, no native deps). The pipe
   approach loses true interactivity but avoids native PTY dependencies and survives
   independently of the agent turn.
9. **Undocumented features rot.** Cursor's background shells changed format 3× without
   notice; Devin's model-side mechanics are unknowable. The pi extensions' value is
   precisely that their contracts are in source.

---

## 11. Recommendations for a pi extension (context: `codex-bash` work-in-progress)

Goal: Codex-style auto-backgrounding of the built-in `bash` tool in pi, with the best
of the surveyed field.

1. **Tool surface** — separate tools (consensus), Codex-shaped results:
   - `bash` (override): `{command, timeout (auto-bg threshold), run_in_background,
     description}`; result on yield: *"Process running with job ID <id> (auto-backgrounded
     after Ns; still running — use bash_output…)"*; on completion: *"Process exited with
     code N"* + per-call `Wall time`.
   - `bash_output {id, maxBytes?}` (tail, sets `outputConsumed` to suppress redundant
     notices), `bash_kill {id}`, `bash_list` (recovery after compaction — Codex's gap),
     optional `bash_wait {id, timeoutMs?}`.
2. **User surface** — `/ps` (list) and `/stop` (kill all), matching Codex; Ctrl+Shift+B
   manual backgrounding (Claude/patty parity).
3. **Completion delivery** — patty's rule: mid-turn completions coalesce and flush
   passively at `agent_end` (followUp, no wake); idle completions flush as a single
   steer wake. Keep the push (fixes Codex's orphan problem; it is the ecosystem
   consensus, not a divergence).
4. **Defaults** — auto-bg threshold configurable (10 s Codex / 120 s Claude); cap of 64
   jobs with LRU eviction (Codex policy) but **surface the eviction** in `bash_list` and
   the completion notice (fixes Codex's silence).
5. **Skips** — no per-turn status injection (nobody does it; token waste); no
   PTY/native deps (file-fd spawn, control-char interception if `write_stdin`-style
   interactivity is ever added); wake budgets/replay are second-iteration features.

---

## 12. Implementation progress: `codex-bash.ts`

A working prototype implementing the §11 design, built and verified during this survey
(Aug 2026). Current state: **working single-file extension, typecheck-clean and
load-tested, not yet installed**. Location: `/tmp/codex-bash/codex-bash.ts` (~470
lines of logic + doc comments). No dependencies, no tmux, no native addons.

### 12.1 What it does

- **Overrides the built-in `bash` tool** (verified: extension `registerTool` with the
  same name replaces the built-in — `agent-session.js` `_refreshToolRegistry` builds
  the registry from built-ins first, then `Map.set` for extension tools).
- **Spawns Codex/Claude-style**: `child_process.spawn("bash", ["-c", cmd], { detached:
  true, stdio: ["ignore", outFd, outFd] })` — stdout+stderr written straight to a log
  file fd (kernel writes, zero JS in the data path), detached process group so
  `killProcessTree(-pid)` works.
- **Foreground race**: completion vs a pause bridge. 2 s quick-completion window skips
  the backgrounding machinery; an auto-background timer (`DEFAULT_TIMEOUT_MS = 30_000`,
  overridable per-call via `timeout` seconds) or Ctrl+Shift+B/Ctrl+B resolves the pause
  promise → the command is promoted to a tracked background job and the tool returns
  `Process backgrounded as <id> (auto-backgrounded after Ns; still running — use jobs
  action='output'…)` while the agent keeps its turn.
- **Abort-signal trap** (the subtle part): the turn's abort signal kills the process
  **only if no pause was requested**. Genuine Esc cancel kills; cooperative steering /
  Ctrl+B / timeout background instead — aborting the turn to background a command must
  never kill the command just backgrounded.
- **`run_in_background: true`** starts straight to background, returning an id
  immediately.
- **Completion push**: the backgrounded child's exit finalizes the job and sends
  `pi.sendMessage({customType:'bg-job-finished', display:true, content}, {deliverAs:
  'followUp', triggerTurn:true})` — the agent is woken with the result (the
  ecosystem-consensus behavior Codex lacks).
- **`jobs` tool**: `{action: list|output|kill|attach|cleanup, id?, maxBytes?}` — list
  (status/pid/duration/command), bounded tail output (sets `outputConsumed` to suppress
  a redundant completion notice), single-job kill, wait-for-completion attach, cleanup.
- **Cooperative steering** (`input` event): typing while a foreground command runs
  backgrounds it, `ctx.abort()`s the turn, re-delivers the message via
  `pi.sendUserMessage(text, {deliverAs:'followUp'})`, returns `{action:'handled'}`.
- **Live output**: a 250 ms poller tails the log into `onUpdate` partial results (the
  stock bash renderer fallback draws the streaming box); a
  `(ctrl+shift+b to run in background)` hint renders via
  `setWidget(…, {placement:'belowEditor'})`.
- **Lifecycle**: `session_start` ensures the log dir (`$TMPDIR/pi-codex-bg/`);
  `session_shutdown` SIGTERMs every running job's process group.

### 12.2 SDK facts it was verified against (pi 0.80.3)

1. Extension tools overwrite built-ins by name (`agent-session.js`
   `_refreshToolRegistry`).
2. Registering `bash` **without** `renderCall`/`renderResult` falls back to the
   built-in bash renderer by tool name (`tool-execution.js` `getCallRenderer()`:
   `toolDefinition.renderCall ?? builtInToolDefinition.renderCall`) — the command chip
   + streaming output box render like stock bash for free. This is why the initial
   `createBashToolDefinition` spread was dropped: it also eliminated a TypeScript
   generic conflict from the built-in renderers' narrow schema.
3. `ExtensionContext` (tool ctx) exposes `abort()`, `signal`, `cwd`, `ui`, `isIdle()`
   (`dist/core/extensions/types.d.ts`).
4. `sendMessage`: `{triggerTurn?, deliverAs?: 'steer'|'followUp'|'nextTurn'}`;
   `sendUserMessage`: `{deliverAs?: 'steer'|'followUp'}`. `InputEvent.source`
   distinguishes `interactive|rpc|extension`.
5. `KeyId` from `@earendil-works/pi-tui` includes `ctrl+shift+b`/`ctrl+b`;
   `WidgetPlacement = 'aboveEditor' | 'belowEditor'`.
6. Tool `execute(toolCallId, params, signal, onUpdate, ctx)` signature, `AgentToolResult
   = {content, details, usage?, addedToolNames?, terminate?}`.

### 12.3 Test results (jiti harness — pi's actual extension loader)

Typechecks clean under `tsc --strict` against the installed 0.80.3 packages, loads via
`jiti` (same loader pi uses), and passed end-to-end: fast command returns output
normally; `run_in_background` launches instantly with a job id; `jobs list` shows
`[running]` → `[completed]`; exactly one completion notification is sent with
`{deliverAs:'followUp', triggerTurn:true}`; auto-background at `timeout:1` returned at
**+1002 ms**; manual background via the shortcut handler backgrounds a running command;
cooperative steering returns `{action:'handled'}`, re-delivers the user text as a
followUp, and the command completes in the background with a notification.

### 12.4 Bug found and fixed by testing

The original quick-completion race contained only `exit` and a 2 s timer — **not the
pause promise**. With a sub-2 s `timeout`, the auto-background fired at N seconds but
was ignored until the 2 s boundary, backgrounding at ~2004 ms instead of ~1000 ms (and
race-dependent). Fix: the pause promise participates in the quick race, so a
backgrounding request during the quick window is honored immediately. Invisible with
30 s defaults; a real latent bug for small timeouts.

### 12.5 Deliberate deviations from Codex (all intentional)

| Codex | codex-bash.ts | Why |
|---|---|---|
| No completion push (poll-only) | `sendMessage` followUp + triggerTurn | The ecosystem consensus; fixes orphaned jobs (#8656/#3968) |
| No model list/kill tools | `jobs` list / kill / attach | Id recovery after compaction; single-job kill (Codex has neither) |
| Foreground-yield only | `run_in_background: true` | Explicit opt-in, same as Claude Code / patty |
| No manual backgrounding | Ctrl+Shift+B / Ctrl+B + cooperative steering | Claude-Code parity, human control |
| Auto-bg at 10 s | 30 s default (per-call `timeout`) | Pending decision — §11 says 10 s for exact parity |
| PTY + `write_stdin` interactivity | file-fd pipes, no stdin | No native deps; sandbox-safe; interactivity deferred |
| Silent 64-cap LRU eviction | no cap yet | Cap + *visible* eviction is a §11 TODO |
| Per-job immediate notifications | per-job immediate (patty-style coalescing is a §11 TODO) | — |

### 12.6 Remaining work (from §11, not yet done)

1. Split `jobs {action:…}` into separate tools: `bash_output`, `bash_kill`,
   `bash_list`, `bash_wait` (consensus: harnesses use separate tools, not an enum).
2. User commands `/ps` and `/stop` (kill all), matching Codex's user surface.
3. Default auto-bg threshold decision (10 s Codex / 120 s Claude) — make it
   env-configurable either way.
4. 64-job cap with LRU eviction, protected-MRU set (Codex policy) but **surfaced** in
   `bash_list`/notices instead of silent.
5. Patty-style delivery: coalesce mid-turn completions to one passive flush at
   `agent_end`; single steer-wake when idle (current: one immediate followUp per job).
6. Codex-shaped result phrasing: `Process running with job ID …` / `Process exited
   with code N` + per-call `Wall time` (currently `Process backgrounded as …`).
7. Install: copy to `~/.pi/agent/extensions/codex-bash.ts` (note: this path may be
   chezmoi-managed — the file currently lives at `/tmp/codex-bash/codex-bash.ts`).
8. Optional future: chunked reads (`chunk_id` cursors), `write_stdin`-style
   interactivity via control-char interception (`\u0003` → SIGINT), durable replay on
   `session_start`, wake budgets.

---

## 13. Sources

Primary (read directly):
- Codex: `codex-rs/core/src/tools/handlers/shell_spec.rs`, `unified_exec/{mod,process_manager,process,async_watcher}.rs`, `tools/context.rs`, `tools/handlers/unified_exec/{exec_command,write_stdin}.rs`, `session/turn.rs`, `config/mod.rs`, `tui/src/{slash_command,chatwidget}.rs`, `tui/src/history_cell/exec.rs` — github.com/openai/codex `main` (2026-08-11/12).
- pi-background-tasks v2.1.4: `src/extension.ts`, `src/core/registry.ts`, `src/core/common.ts`.
- pi-patty-bg-tasks v1.1.6: `src/tools/bash.ts`, `src/notify.ts`, `src/lifecycle.ts`, `src/input.ts`, `src/shortcuts.ts`, `src/spawn.ts`, `src/types.ts`, `src/state.ts`.
- @vanillagreen/pi-background-tasks v1.6.2: `extensions/{registrations,wake-events,constants}.ts` (jsDelivr), vstack monorepo README/DEVELOPMENT.md.
- OpenCode `dev`: `packages/opencode/src/tool/{shell.ts,shell/prompt.ts,task.ts,task.txt}`, `src/session/prompt.ts`, `src/effect/runner.ts`, `packages/core/src/background-job.ts`.
- Claude Code: code.claude.com/docs/en/tools-reference, /interactive-mode, /commands, /env-vars, /headless, /statusline; readingclaude.club/en/state/background; github.com/anthropics/claude-code issues #21048, #18544.
- Cursor: cursor.com/docs/agent/tools/terminal, /changelog (1.5, 2.0, 3.5); forum threads 149225, 162544, 166335.
- Devin: docs.devin.ai (intro, session-tools, handoff, advanced-capabilities, skills, slash-commands, blueprint-reference, release-notes, api-reference); cognition.com/blog (introducing-devin, devin-2, devin-generally-available).
- pi extension SDK surface: `@earendil-works/pi-coding-agent@0.80.3` dist `.d.ts`/`.js` (extensions/types.d.ts, agent-session.js, tool-execution.js, loader.js, runner.js); pi docs extensions.md.

Research briefs: six parallel research agents (pi-extensions, codex, claude-code,
opencode, devin, cursor), each with web_search/web_fetch tooling, Aug 2026 — file refs
in-session (`research-<key>.md`).
