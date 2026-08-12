# Background-Job Test Suite for `bg-bash` (formerly `codex-bash.ts`)

A deduplicated, runnable test-case inventory synthesized from four parallel research
lanes (OpenAI Codex CLI, Claude Code, OpenCode+Cursor+Devin, and the three pi
background-task extensions) against the extension in this folder (`index.ts` — the
shipped successor of the `/tmp/codex-bash/codex-bash.ts` prototype) and its design
in `BACKGROUND.md`. Each case is observable behavior a regression would break; each
Origin names the harness/issue the invariant is derived from.

## Test layers & how to run

- **`test.mjs`** (unit, offline) — loads `index.ts` via jiti against a stub
  `ExtensionAPI`; deterministic, free, CI-runnable. `node test.mjs`.
- **`eval/`** (end-to-end, model-backed) — drives a real `AgentSession`, launches
  jobs through the real `bash` tool, and asserts on the live transcript: the
  delivery semantics the stub cannot see (BG-08 idle wake, BG-09 mid-turn passive
  queueing, BG-27 tool contract). Costs tokens; mildly nondeterministic.
  `cd eval && npm install && PI_PROVIDER=… PI_MODEL=… npx vitest run`.
- Cases marked **Verified (eval)** below have passed the real-session suite.

Naming: `BG-NN` (deduped from `CODEX-NN`/`CC-NN`/`OPC-NN`/`CUR-NN`/`DEV-NN`/`STE-NN`/
`SC-NN`/`DUR-NN`/`LIM-NN`/`ERR-NN`/`PIBG-NN`). "Origin" lines cite `BACKGROUND.md §X`
plus the issue/extension each case is owed to. **RED** cases guard known-failing
behavior (unimplemented features) and pin current behavior so the test flips when
the feature lands.

---

## P0 — Launch & foreground race

### BG-01  Fast foreground command returns output normally with zero residue
- Category: launch
- Catches: phantom jobs leaking into the registry + `.log` files onto disk for commands that finished inside the 2 s quick window; a bogus job id returned for a finished command; a stray completion notification (the watcher is only attached at promotion).
- Steps: `bash { command: "echo hi && sleep 1 && echo done" }`; then `jobs { action: "list" }`; then `ls $TMPDIR/pi-codex-bg | wc -l`.
- Expected: Tool returns `hi\ndone` synchronously with no job id; `jobs list` prints `No background jobs.`; the log dir contains 0 files (the foreground `finally` unlinks its log when `!handedToBackground`).
- Origin: codex-bash §12.1 quick-completion window + finally-block cleanup; patty 2 s quick window (§8.2); Codex short-lived path releases the id (§3.3). [CODEX-02, OPC-01a, PIBG-01]

### BG-02  `run_in_background: true` spawns instantly with id, PID and output path
- Category: run_in_background
- Catches: the flag blocking on the foreground race instead of returning immediately; a missing output path breaking the "Read the file" recovery pattern.
- Steps: Time `bash { command: "sleep 300", run_in_background: true, description: "long sleep" }`; then `jobs { action: "list" }`.
- Expected: Returns in <1 s with `Command running in background with ID: <id>. Name: long sleep.` + the log path; `jobs list` shows `<id> long sleep [running]` with a pid and `0s` duration.
- Origin: Claude `run_in_background` "you'll be notified" contract (§4.1); patty `bash_bg` / ismailsaleekh `bg_run` immediate-id spawn (§8.1, §8.2); OpenCode `task background:true` returns `<task id state="running">` immediately (§5.1). [CODEX-03, CC-01, OPC-01b, PIBG-04]

### BG-03  Sub-quick-window timeout is honored immediately (the §12.4 quick-race regression)
- Category: foreground-race
- Catches: re-introduction of the §12.4 latent bug — the quick race originally contained only `exit` and a 2 s timer, so a `timeout < 2 s` backgrounding request was ignored until the 2 s boundary, backgrounding at ~2004 ms instead of ~N ms, race-dependently. The pause promise must participate in the quick race.
- Steps: Time `bash { command: "sleep 60", timeout: 1 }`.
- Expected: Returns at ~1000 ms (±300 ms) — **never** ~2000 ms — with `Process backgrounded as <id> (auto-backgrounded after 1s; still running — use jobs action='output' id='<id>' to check)`; `jobs list` shows `[running]`.
- Origin: codex-bash §12.4 (bug found and fixed by testing); §12.3 measured +1002 ms at `timeout:1`. [CODEX-04, CC-03, CUR-01, PIBG-02]

### BG-04  Default 30 s auto-background promotes (MOVES, never kills) with an id + wait duration + later-check pointer
- Category: auto-background
- Catches: the move-vs-kill regression (OpenCode kills at 120 s, §5.1; the whole Claude design is promotion not termination); a returned result missing the job id orphans the process (Codex's silent failure, §3.4); drift in the §12.6.6 planned Codex-shaped rephrasing that could drop the duration or the "check output later" pointer.
- Steps: `bash { command: "sleep 120" }` (default `timeout` 30 s); at return immediately `jobs { action: "list" }` and `ps -p <pid>`; then `jobs { action: "output", id: <id> }`.
- Expected: Returns at ~30 s with `Process backgrounded as <id> (auto-backgrounded after 30s; still running — use jobs action='output' id='<id>' to check)` — id AND literal wait duration AND a named later-check mechanism all present; `jobs list` shows `[running]` with a live pid; `jobs output` returns the partial/`(no output yet)` log. (Variant at `timeout:2`: `sleep 10; echo finished-bg` → returns at ~2 s, survives, completes at ~10 s with tail `finished-bg`.)
- Origin: Claude Code §4.2 verbatim "Command did not complete within its 120s timeout and was moved to the background"; patty `bash` timeout auto-bg (§8.2); Devin CLI §7.1 "shows how long it waited … check the command's output later". [CODEX-01, CC-02, CUR-02, PIBG-03]

### BG-05  Per-call `timeout` bounds only the foreground race, never background jobs
- Category: run_in_background
- Catches: a "helpful" regression wiring the timeout into the background spawn — ismailsaleekh's per-task `timeoutSeconds` *does* kill background tasks (§8.1), but codex-bash's `timeout` is the auto-bg threshold only; silently killing a long job the agent explicitly backgrounded is the failure.
- Steps: `bash { command: "sleep 45", timeout: 1, run_in_background: true }`; check at 5 s; wait for completion.
- Expected: At 5 s the job is still `[running]` (the 1 s "timeout" ignored for background spawns); at ~45 s the completion notification arrives with `exit 0`.
- Verified (test.mjs): `sleep 30` + `timeout:1` + `run_in_background:true` returns instantly and is still `[running]` at 3 s.
- Origin: ismailsaleekh per-task `timeoutSeconds` (§8.1, contrast); codex-bash §12.1 "timeout = auto-background threshold" is foreground-only by design. [PIBG-20]

### BG-06  cwd of a backgrounded command does not carry over to later calls
- Category: edge
- Catches: a backgrounded `cd` leaking into subsequent tool calls (a naive implementation mutating `ctx.cwd` or reusing the child's cwd).
- Steps: `bash { command: "cd /tmp && pwd && sleep 3 && pwd", timeout: 1 }` → backgrounded; wait for completion; then `bash { command: "pwd" }`.
- Expected: Log shows `/tmp` twice; the later `pwd` returns the original session cwd, never `/tmp`.
- Verified (test.mjs): `cd / && pwd && sleep 30 && pwd` auto-backgrounded; a later `pwd` returns the session cwd (`/tmp`), not `/`. (Spec steps use `/tmp` as the target since the harness session cwd differs; the stub cwd *is* `/tmp`, so `/` is used to make the leak detectable.)
- Origin: Claude Code §4.2 verbatim "Session cwd remains <dir>; directory changes made by the backgrounded command do not apply to subsequent commands." [CC-04]

---

## P0 — Completion injection & delivery

### BG-07  Exactly one completion notification with the full payload and correct delivery
- Category: injection-delivery
- Catches: duplicate notifications (watcher refiring) or zero injection at all — the Codex failure this exists to fix (`ExecCommandEnd` is TUI-only, the model is never woken, §3.3); missing status/exit/command/output-path fields the model needs.
- Steps: `bash { command: "sleep 2; echo done-123" }` (or `run_in_background:true`); wait 5 s; count messages with `customType === 'bg-job-finished'` and inspect the one received.
- Expected: Exactly **1** message. Content: `Background job <id> completed (exit 0) after 2s.\nCommand: sleep 2; echo done-123\nOutput: <path>` + tail containing `done-123`. Delivery options are exactly `{ deliverAs: 'followUp', triggerTurn: true }`. No second message arrives (single `exit.then` watcher + `outputConsumed` latch).
- Origin: OpenCode §5.2 `injectBackgroundResult` wakes a new turn when idle via `runLoop()`; ismailsaleekh `notified` latch + 1 XML msg/task (§8.1); patty `outputConsumed` (§8.2); codex-bash §12.3 "exactly one completion notification … followUp, triggerTurn:true"; fixes Codex's zero injection (§3.3, §9.2). [CODEX-05, CC-07, OPC-02, PIBG-05]

### BG-08  Idle completion wakes a NEW agent turn with the full result (Cursor-trial reliability)
- Category: injection-delivery
- Catches: the "notification sent but never delivered / no wake" class — Cursor's controlled trial where auto-resume succeeded **0/4** and 3/4 shells were reaped ~80–100 s after turn end (§6.2, §1.5); and background processes being reaped after the launching turn ends.
- Steps: (a) Repeat BG-07 four times with distinct commands (`sleep 2; echo run-N`), idling after each; count woken turns. (b) `bash { command: "sleep 180", run_in_background: true }`; end the turn; wait 120 s; `jobs { action: "list" }` and `ps -p <pid>`.
- Expected: (a) 4/4 new turns each receive exactly one `bg-job-finished` with the correct `run-N` tail. (b) After 120 s the job is still `[running]` with a live PID (detached process group + `child.unref()`, §12.1) — nothing reaped at turn end. Any ratio < 4/4 or a dead PID at 120 s is a Cursor-style failure.
- Verified (eval): real-session idle wake — notification with `exit 0` + output tail delivered, followed by a new assistant turn. 3/3 runs (2025-06).
- Origin: OpenCode §5.2; Cursor §6.2 (0/4 trial, 80–100 s reaping); §1.5. [CUR-03, merging OPC-02]

### BG-09  Mid-turn completion must NOT interrupt the in-progress turn
- Category: coalescing
- Catches: a regression where the followUp becomes a `steer` (would abort the in-progress turn / kill the in-flight command); lost/merged messages when two jobs finish close together.
- Steps: One turn: `bash { command: "sleep 2; echo alpha", run_in_background: true }`, `bash { command: "sleep 4; echo beta", run_in_background: true }`, then immediately a foreground `bash { command: "sleep 3; echo mid-work" }`; collect follow-ups after the turn.
- Expected: The foreground call runs uninterrupted and returns `mid-work`; no abort fires; no `bg-job-finished` is delivered mid-call. Afterward exactly **two** distinct `bg-job-finished` messages arrive, alpha before beta, each exit 0 with its own tail. (codex-bash is per-task today — patty-style single-summary coalescing is §12.6.5, not yet implemented.)
- Verified (eval): real-session mid-turn — the foreground turn completes uninterrupted (no BG-MID in its reply), the queued notification arrives afterward with the correct tail. 3/3 runs (2025-06).
- Origin: OpenCode §5.2 mid-turn completions forked with `Effect.ignore` (passive, wait); Claude §9.2 "Queued at completion, delivered at next idle — passive, never interrupts"; issue #18544. [OPC-03, OPC-05, CC-20]

### BG-10  `outputConsumed` latch: reading output suppresses the wake; not reading delivers it
- Category: injection-delivery
- Catches: the notification wall (#18544) — a redundant wake after the model already consumed the output; a regression where `jobs output` no longer sets `outputConsumed`, or a suppressed notification when nothing was read.
- Verified (eval): a real-session job whose output was read via `jobs output` completes with NO `bg-job-finished` wake — vs BG-08's control, which wakes. 1/1 runs (2025-06).
- Steps: (a) `bash { command: "sleep 3; echo A", run_in_background: true }`; immediately `jobs { action: "output", id: <id> }` (sets `outputConsumed`); idle; count followUp messages. (b) `bash { command: "sleep 3; echo B", run_in_background: true }`; do NOT read; idle; count followUp messages.
- Expected: (a) **No** `bg-job-finished` message (already consumed — the UI toast may still fire; the assertion is on the message channel). (b) Exactly one `bg-job-finished` arrives with tail containing `B`. Both directions hold simultaneously.
- Origin: patty `outputConsumed` (§8.2); Claude notified-flag philosophy (§4.2); ismailsaleekh `notified` latch (§8.1); codex-bash §12.1. [CC-08, DEV-02, PIBG-07]

### BG-11  Failed and signal-killed jobs get honest statuses; foreground failures surface as tool errors
- Category: injection-delivery
- Catches: exit-code mapping mistakes (the `128+signum` `isSignalExit` convention), failed background jobs reported as `completed`, or failures delivered without the tail the agent needs to debug.
- Steps: (a) `bash { command: "echo boom; exit 3", run_in_background: true }`; (b) `bash { command: "sleep 2; kill -9 $$", run_in_background: true }`; (c) `bash { command: "exit 3" }` (foreground); (d) `bash { command: "sleep 2; exit 137", run_in_background: true }`.
- Expected: (a) one notification `Background job <id> failed (exit 3) …` with tail `boom`; `jobs list` shows `[failed]` exit 3; UI toast `✗ … failed`. (b) notification `killed (killed)` — signal → `code null` → `killed`; list `[killed]`. (c) foreground → tool error `Command exited with code 3`. (d) notification `failed (exit 137 (signal))` — the `>128` convention honored.
- Origin: patty `✗ deploy (5s, exit 1, job-3-2)` failed-job nudge (§8.2); ismailsaleekh XML status/exit-code fields (§8.1); codex-bash `isSignalExit` (§12.1); Codex `exit_code` in tool output (§3.1). [CODEX-12, CC-09, PIBG-06]

### BG-12  Live output streams during the foreground race, then stops on backgrounding
- Category: foreground-race
- Catches: broken `streamLog`/`onUpdate` wiring → no streaming box (the built-in bash renderer fallback is load-bearing, §12.2 fact 2); a poller timer leak not stopped on completion/backgrounding.
- Verified (test.mjs): `onUpdate` fired 3× with monotonic partial tails while a ~3 s command ran past the 2 s quick window; the final result carries all output. (This test exposed a real bug: the old spawn-time `child.unref()` let a bare-node event loop drain mid-foreground-call — node exits with "unsettled top-level await". Fixed by unref-at-promote: foreground calls hold the loop, background jobs still don't.)
- Steps: `bash { command: "for i in 1 2 3 4 5 6; do echo tick-$i; sleep 1; done", timeout: 5 }`; watch the output box during the call.
- Expected: Partial results grow on a ~250 ms cadence (tick-1…tick-5 visible before return); the tool then returns `Process backgrounded as … auto-backgrounded after 5s`; polling stops (no updates after return).
- Origin: Claude `Monitor` per-line watcher (§4.1, closest codex-bash analog is the 250 ms poller); codex-bash §12.1 live output; §12.2 fact 2. [CC-10]

---

## P0 — Recovery: list, kill, attach

### BG-13  `jobs list` format is pinned (id, bracketed status, pid=, true job-age, `$ `-prefixed command) and enables id recovery
- Category: list-recovery
- Catches: Cursor's state-file format changed 3× in two weeks (§6.1, §10.9 — undocumented features rot) — a format change here breaks model parsing and the compaction-recovery story; and "lost job age" (§12.5): Codex's `wall_time` is per-call wait, not job age, so the model can never learn how long a job has actually run — codex-bash must show true age.
- Verified (test.mjs): duration grows between two `list` calls on the same running job (0s → 2s) — true age, not per-call wall time.
- Steps: `bash { command: "sleep 8; echo fin", run_in_background: true }`; `jobs { action: "list" }`; wait 10 s; `jobs { action: "list" }`.
- Expected: First list: `<id> [running] pid=<pid> 0s\n  $ sleep 8; echo fin` (status one of `running|completed|failed|killed`). After ~4 s the running duration reads ~`4s` (`now - startedAt`), never `0s`/per-call wait. Second list: `[completed]` with duration `8s` (`endedAt - startedAt`).
- Origin: Codex §3.2 "`wall_time` is per-call wait, NOT job age" (verified `tctx.rs:123-124`); §10.4 "nobody lists job ages — codex-bash deliberately does"; Cursor §6.1/§10.9. [PIBG-08, CUR-05, CODEX-17]

### BG-14  Lost job id (compaction) recovered via `jobs list` + `output`
- Category: compaction-robustness
- Catches: the orphaned-job failure — Codex issues #8656/#3968: after context compaction the model no longer remembers numeric session ids and Codex has no list tool, so jobs become permanently unreachable (§3.3, §12.5).
- Steps: `bash { command: "sleep 30; echo recovered-ok", run_in_background: true }`; discard the returned id (simulate compaction); `jobs { action: "list" }`; copy the id; `jobs { action: "output", id: <id>, maxBytes: 500 }`; wait for completion.
- Expected: `jobs list` shows the command text so the agent can re-identify it; `jobs output` returns the live tail; the completion notification still arrives for the recovered job.
- Verified (test.mjs): id discarded at launch, re-identified from the list by command text (`recovery-ok`), `jobs output` returns the tail.
- Origin: Codex #8656/#3968 (§3.4); codex-bash §11.1 `bash_list` = "recovery after compaction — Codex's gap"; §12.5 deviation row. [CODEX-06, CC-06, PIBG-09, CUR-05]

### BG-15  Completed/failed jobs remain listed until explicit cleanup — no silent disappearance
- Category: list-recovery
- Catches: Codex's `refresh_process_state` removes exited entries from the store, so a poll of a finished id fails with `UnknownProcessId` even within the same session (§3.4); silent-eviction opacity generally. A terminal job must never vanish from the list without either a `bg-job-finished` notification or an explicit `cleanup`.
- Verified (test.mjs): a completed job stays listed; `/bg-clear` forgets it (list → `No background jobs.`).
- Steps: `bash { command: "sleep 2; exit 7", timeout: 1 }`; wait 3 s; `jobs { action: "list" }`; `jobs { action: "output", id: <id> }`; `jobs { action: "cleanup" }`; `jobs { action: "list" }` again.
- Expected: List shows `<id> [failed] … 2s` (exit 7); `output` returns the tail. After `cleanup`: `Cleaned up finished jobs.` and list → `No background jobs.` Anti-invariant: a terminal job never vanished without a notification or an explicit cleanup.
- Origin: Codex `pm.rs` `refresh_process_state`/`prune_processes_if_needed` removed exited entries (§3.4, verified); §11.4 "surface the eviction"; Codex silent 64-cap eviction (§3.4, §10.7). [CODEX-07]

### BG-16  Single-job kill with visible `[killed]` state + notification — no control-byte channel
- Category: kill
- Catches: Codex's #17821 gap (no single-job stop; `/stop` kills everything) and the fragile Ctrl-C-byte kill (`write_stdin` non-TTY accepts only `"\u0003"`, and models have been observed emitting the literal string — §10.2); killing only the leader while grandchildren keep running.
- Steps: `bash { command: "sleep 300 & wait", timeout: 1 }`; note the pid + `pgrep -P <pid>` (the `sleep 300` child); `jobs { action: "kill", id: <id> }`; re-check both pids; `jobs { action: "list" }`; wait for the notification.
- Expected: `kill` returns `Killed <id>. Output kept at <path>`. **Both** the bash leader and the `sleep 300` child are dead (SIGTERM to `-pid` group — `killProcessTree`, not leader-only). Status flips to `[killed]`. A `bg-job-finished` message arrives with `killed` in the exit line (`exitCode null` → `killed`). No `chars`/`\u0003` parameter is exposed anywhere — the literal-`"\u0003"` model pitfall is structurally avoided.
- Verified (test.mjs): `sleep 60 & wait` — live `pgrep -P` child before kill; after `jobs kill` both leader and grandchild are gone (`ps`/`pgrep` empty) and the status flips to `[killed]`.
- Origin: Codex `write_stdin` `\u{3}` kill (§3.1, verified `pm.rs`); issue #17821 (open single-job-stop request); patty/vanillagreen SIGTERM tree kill (§8.2, §8.3); ismailsaleekh `bg_kill` (§8.1); codex-bash `killProcessTree(-pid)` (§12.1). [CODEX-08, CODEX-09, CC-12, CUR-06, PIBG-10]

### BG-17  Unknown id / non-running / unknown action fail loudly (list-on-error trick)
- Category: edge
- Catches: silent/empty results on unknown ids (the model can't distinguish a dead id from a live one — Codex's orphan problem §3.3, #8656/#3968); an unknown action falling through to a crash; error-string drift that breaks model pattern-matching.
- Steps: (a) `jobs { action: "output", id: "bogus" }`; (b) `jobs { action: "kill", id: "bogus" }`; (c) `jobs { action: "attach", id: "bogus" }`; (d) after a job completes, `jobs { action: "kill", id: <completed-id> }`; (e) `jobs { action: "frobnicate" }`.
- Expected: (a)(b)(c) throw `Unknown job: bogus`; (d) throws `Job <id> is completed, not running.`; (e) throws `Unknown jobs action: frobnicate`. All exact strings; none crash the extension; the agent recovers via `jobs list`.
- Origin: Claude `TaskStop`/`TaskOutput` error-path enumerates running agents (§4.1/§10.3); Codex `UnknownProcessId` + silent `terminate_process` `false` (§3.4); codex-bash §12.1 error paths. [CODEX-10, CC-06, ERR-01, PIBG-19]

### BG-18  `jobs attach`: blocks to completion, immediate on finished jobs, abort-safe (no kill)
- Category: edge
- Catches: drift back to Codex's poll-with-empty-`write_stdin` pattern (the root of #8656/#3968); attach returning early, never resolving, or its abort path killing the job.
- Steps: (a) `bash { command: "sleep 2; echo attached-out", run_in_background: true }`; time `jobs { action: "attach", id: <id> }`. (b) Attach again (job already completed). (c) `bash { command: "sleep 60", run_in_background: true }`; attach; press Esc mid-attach.
- Expected: (a) Returns after ~2 s with `completed, exit 0` + `attached-out` — a blocking `Promise.race`, no poll loop. (b) Returns immediately (exit promise already resolved — no hang). (c) Returns `(still running; attach aborted)` + partial tail; the job stays `[running]` (attach abort must NOT kill the job).
- Origin: Codex `write_stdin` empty-chars polling (§3.1); Devin managed-Devins scheduled check-backs / CLI "check output later" (§7.1); patty steers sleep-users to `jobs attach` (§8.2); codex-bash §12.1 attach. [CODEX-18, CC-11, DEV-03, PIBG-11]

---

## P1 — Steering & UI

### BG-19  The abort trap, both halves: steering backgrounds + re-delivers (never kills); Esc genuinely cancels (kills)
- Category: cooperative-steering
- Catches: THE §12.1 subtlety — the turn's abort signal must kill the process **only if no pause was requested**. Two failure directions: (a) wiring `signal→kill` unconditionally kills the very command steering just backgrounded; (b) dropping the kill branch "to be safe" leaves orphan processes on genuine Esc. Also: steering hijacking extension-originated input, or firing with no active foreground.
- Steps: (a) `bash { command: "sleep 30", timeout: 60 }`; while it runs, type `please keep going`. (b) Repeat with a fresh `sleep 60` foreground and press Esc instead.
- Expected: (a) Input handler returns `{ action: 'handled' }`; the turn aborts; the user text is re-delivered via `sendUserMessage(text, { deliverAs: 'followUp' })`; `jobs list` shows the job `[running]` (alive — the abort must not have killed it); it completes later and the `bg-job-finished` arrives. Messages with `event.source === 'extension'` pass through (never hijacked); firing with no active foreground is a no-op (`{ action: 'continue' }`). (b) Esc with no pause: process group SIGTERM'd; `jobs list` → `No background jobs.`; the log file is gone (job dropped + unlinked in `finally`); no notification.
- Origin: codex-bash §12.1 abort-signal trap + cooperative steering; patty `input`-event steering + `ctx.abort()` + re-deliver (§8.2); §12.3 verified steering behavior; Codex has no steering (§3.5). [CODEX-13, CC-17, STE-01, PIBG-12, PIBG-13]

### BG-20  Ctrl+Shift+B manually backgrounds the running command (hint + notify); idle press is a no-op
- Category: ui-shortcuts
- Catches: the shortcut handler resolving the wrong/absent foreground slot (broken `activeToolCallId`/`foreground` map bookkeeping); a double-background crash; the `(ctrl+shift+b to run in background)` `belowEditor` widget never showing or never clearing; a crash on an idle press.
- Steps: `bash { command: "sleep 30", timeout: 60 }`; press `ctrl+shift+b`; after the tool returns, press `ctrl+shift+b` again.
- Expected: First press: `ui.notify("▶ Backgrounded — continuing.", "info")` fires; the bash call returns `Process backgrounded as <id>` (manual reason → **no** `auto-backgrounded after Ns` suffix); job `[running]` → notification later; the hint widget renders `belowEditor` while foreground and is removed after (`clearHint` in `finally`). Second press (no active foreground): no-op, no crash.
- Origin: Claude `Ctrl+B` backgrounds the running Bash command (§4.3); patty `ctrl+shift+b` (§8.2); codex-bash §11.2 recommendation 2 + §12.1 hint widget + `KeyId 'ctrl+shift+b'` (§12.2.5). [CODEX-14, CC-18, SC-01, PIBG-14]
- Note: the prototype also registers `ctrl+b` (Codex §3.5 tmux parity), but `ctrl+b` collides with `tui.editor.cursorLeft` (`defaultKeys: ["left","ctrl+b"]` in `@earendil-works/pi-tui keybindings.d.ts`) — see §"Recommended fixes" in the review. Drop `ctrl+b` before this case runs.

---

## P1 — Concurrency & survival

### BG-21  Concurrent jobs run uncapped, complete in order, each waking exactly once with distinct ids
- Category: concurrency
- Catches: accidental serialization (registry keyed wrong → second spawn waits); completion-order/notification mixups; concurrent jobs sharing mutable state (one job's exit marking another, or a notification cross-referencing the wrong id) — the classic shared-registry bug class. Pins codex-bash's deliberate no-cap deviation (§12.5) against an accidental introduction of patty's hard-16 (§8.2) or Codex's 64-cap LRU eviction (§3.4).
- Steps: One turn: `bash { command: "sleep 2; echo A", run_in_background: true }`, `bash { command: "sleep 5; echo B", run_in_background: true }`, `bash { command: "sleep 8; echo C", run_in_background: true }`; mid-run `jobs { action: "list" }`. Variant: spawn 25 `sleep 30` jobs in one turn; `jobs list`.
- Expected: All three `[running]` simultaneously with distinct ids/pids; three `bg-job-finished` messages arrive A→B→C with correct durations (2 s/5 s/8 s); none interrupted the launching turn; no message names another job's id. The 25-variant: count = 25, all `[running]`, no error, no eviction notice, no 17th-job-style rejection.
- Origin: Codex 64-cap LRU (§3.4); patty 16-hard-reject (§8.2); ismailsaleekh "no running-concurrency cap" + 1 msg/task (§8.1); codex-bash §12.5 "no cap yet". [CC-14, OPC-05, OPC-06, PIBG-17]
- Observed (eval, 2025-06): two jobs finishing while idle → 2 distinct `bg-job-finished` messages but **1** woken assistant turn — the second followUp coalesces into the first wake turn (the streaming-gate coalescing in `agent-session.js` `sendCustomMessage`). Per-task notifications are preserved; only the *wake* coalesces.

### BG-22  Background job survives subsequent tool calls and the launching turn (no boundary killing)
- Category: edge
- Catches: Cursor kills even `nohup … & disown` at tool-call boundaries (§6.2); guards accidental coupling of job lifecycle to the tool-call/turn boundary (e.g., a cleanup that SIGTERMs the group on the next bash call).
- Steps: `bash { command: "for i in 1 2 3 4 5; do echo tick-$i; sleep 1; done", run_in_background: true }`; then immediately run a foreground `bash { command: "echo marker" }` twice; then `jobs { action: "output", id: <id> }`.
- Expected: The foreground calls return `marker` normally; the bg job remains `[running]` throughout; its output shows `tick-1`…`tick-5` accumulated in order (the log fd kept growing across the intervening tool calls). No SIGTERM at any boundary.
- Origin: Cursor §6.2 (`nohup`/`disown` killed at tool-call boundaries); codex-bash §12.1 (detached group, kernel-write log fd). [CUR-04]

### BG-23  A long-running server keeps serving while backgrounded (detached group stays functional)
- Category: run_in_background
- Catches: the `detached: true`/`child.unref()` design regressing so the child is killed or its fds/socket closed when the tool call returns.
- Steps: `bash { command: "python3 -m http.server 8123", run_in_background: true }`; then `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8123/` from a foreground `bash`; then `jobs { action: "kill", id: <id> }` and curl again.
- Expected: First curl returns `200` while the job is `[running]` (process alive, socket bound, group intact after the tool returned). After `jobs kill` + ~1 s, the second curl fails (connection refused) and the job shows `[killed]`. If the server is unreachable while listed `[running]`, the detached-spawn/unref design is broken.
- Origin: Devin §7.1 ("dev servers, Docker builds… cloud VMs keep going"); codex-bash §12.1 spawn shape. [DEV-01]

### BG-24  Job ids are random, unique, and never reused
- Category: edge
- Catches: id collisions or reuse — a reused id would cross-link jobs. Codex guards with a `reserved_process_ids` set and production-random 1000–100 000 allocation (§3.4).
- Verified (test.mjs): 9 live ids, all `b[0-9a-f]{8}`, zero duplicates.
- Steps: Spawn 5 `run_in_background` jobs, collect ids; `jobs { action: "cleanup" }`; spawn one more; collect.
- Expected: All 6 ids match `^b[0-9a-f]{8}$` (`b` + `randomBytes(4).toString("hex")`), all distinct, and none reused after cleanup (ids are never re-allocated from a pool).
- Origin: Codex `allocate_process_id` (random 1000–100 000, reserved-set loop, verified `pm.rs`, §3.4); codex-bash `nextJobId` (§12.1). [CODEX-15]

---

## P1 — Limits & lifecycle

### BG-25  Output is bounded: truncated tails + `maxBytes` honored + default 20000
- Category: limits-output-cap
- Catches: unbounded output flooding the model context — Codex's `HeadTailBuffer` 1 MiB / ~10k-token cap exists precisely to prevent this (§3.4, verified `ue_mod.rs` `UNIFIED_EXEC_OUTPUT_MAX_BYTES = 1024*1024`, `DEFAULT_MAX_OUTPUT_TOKENS = 10_000`); malformed truncation emitting a partial garbage line.
- Steps: `bash { command: "seq 1 200000", run_in_background: true }`; wait for the notification; measure its body length and look for the truncation marker; then `jobs { action: "output", id: <id>, maxBytes: 200 }`; then `jobs { action: "output", id: <id> }` (no maxBytes).
- Expected: Notification tail ≤ ~20 000 chars containing `…[ truncated ]`, never 200 000 lines. `maxBytes:200` returns ~200 bytes starting `…[ truncated ]\n` followed by whole lines; default returns ≤ 20 000 chars. Both error-free on a completed job and both set `outputConsumed` (BG-10 behavior holds after reads).
- Origin: Codex `HeadTailBuffer` cap (§3.4); Claude ~30 000 chars inline (§4.3); ismailsaleekh `bg_logs` maxBytes ≤ 50 KB (§8.1); vanillagreen tail caps 2000/10000 (§8.3); codex-bash `OUTPUT_PREVIEW_CHARS = 20_000` (§12.1). [CODEX-11ab, CC-15, PIBG-15]

### BG-26  session_shutdown SIGTERMs every running job's process tree; restart loses the registry; orphan log files remain
- Category: lifecycle-shutdown
- Catches: orphans surviving session end (Codex/Cursor §3.3/§6.2; Claude "tasks killed on exit" §4.3); a crash while iterating jobs in mixed states; and the known orphan-log leak — `session_shutdown` clears the Map but never unlinks `.log` files, so `$TMPDIR/pi-codex-bg/*.log` accumulates across sessions.
- Steps: `bash { command: "sleep 500 & wait", run_in_background: true }`; note pid + log path; trigger `session_shutdown` (quit pi / emit the event in the harness); `ps -p <pid>` and `pgrep -f "sleep 500"`; restart pi; `jobs { action: "list" }`; `ls $TMPDIR/pi-codex-bg/`.
- Expected: The leader **and** the `sleep 500` grandchild are dead (group SIGTERM). Registry maps cleared without error (`jobs`/`foreground`/`activeToolCallId` reset; the handler only SIGTERMs `status === "running"`). After restart, `jobs list` prints `No background jobs.` (registry is in-memory — restart loses status, OpenCode §5.3 parity), **but** the pre-restart `.log` file still exists in `$TMPDIR/pi-codex-bg/` — an orphan not owned by any registry entry (the only reclaim path is a `jobs cleanup` before shutdown). Assert all three observations explicitly.
- Origin: Codex `terminate_all_processes` (§3.4, verified `pm.rs`); Claude "tasks killed on exit" (§4.3); patty/ismailsaleekh "shutdown kills all" (§8.1, §8.2); OpenCode process-local (§5.3); codex-bash §12.1 lifecycle; §8.1 `.pi/tasks` + atomic metadata as the durability contrast. [CODEX-16, CC-13, DUR-01, PIBG-18]

---

## P1 — Prompt contract

### BG-27  The model-facing bash description still carries the "you'll be notified" contract
- Category: prompt-contract
- Catches: §10.1 — "you'll be notified" is the universal behavioral contract, only honest if the harness actually delivers. Description drift that invites polling regresses to Codex's pure-pull pathology (§3.3 — the model learns the hard way nothing comes).
- Steps: Introspect the registered `bash` tool definition (extension API, `pi.getAllTools()`, or `grep -c "poll\|notified\|sleep" /tmp/codex-bash/codex-bash.ts`).
- Expected: `description` states the auto-background threshold and "the agent is notified when they finish"; `promptGuidelines` contain "do NOT call sleep or poll jobs merely to wait; you will be notified when it finishes" and "Do not use `sleep N` to wait"; `promptSnippet` says "avoid `sleep` to wait". All present — a grep returns ≥3 matches. (The earlier "Use jobs action='attach' to wait" guideline was dropped with the `attach` action in 2025-06; the guideline now points at `jobs action='output'`.)
- Verified (eval): the tool loaded in a real session carries `run_in_background` in its schema and a description containing "notified" and `run_in_background`. 3/3 runs (2025-06).
- Origin: OpenCode "DO NOT sleep, poll, or proactively check" (§5.1); Claude `run_in_background` "you'll be notified" (§4.1); ismailsaleekh guidelines "do not sleep/bg_status to wait" (§8.1); §10.1; codex-bash §12.1 verbatim strings (lines 313–317). [CC-19, OPC-04, PIBG-16]

---

## RED — Guards for known-unimplemented behavior (currently failing; flip when wired)

### BG-28 (RED)  Skip rules: sleep-leading / git-containing / unparseable-compound commands are KILLED at timeout, never backgrounded
- Category: edge
- Catches: pointless background jobs for `sleep`/`git`/compound commands (the wake arrives with nothing to do — the annoyance #18544 exists about). codex-bash currently has **no** skip implementation, so this guards the missing rule set.
- Steps: Three calls with `timeout: 2`: (a) `bash { command: "sleep 30" }`; (b) `bash { command: "git log; sleep 30" }`; (c) `bash { command: "cat <<'EOF'\nsleep 30\nEOF" }` (parser-unfriendly compound).
- Expected (Claude contract, §4.2): each is killed at timeout — tool result is the kill/error outcome, no job id, `jobs { action: "list" }` stays `No background jobs.`. **As-is, codex-bash auto-backgrounds all three → the test is RED** and flags the missing skip rules.
- Guard (test.mjs): a RED-guard pins the current no-skip behavior — `sleep 60` + `timeout:1` still returns `Process backgrounded as …`. Flips red the day skip rules land, forcing the suite to move to the green contract.
- Origin: Claude Code §4.2 skip rules verbatim (commands starting with `sleep`, containing `git` anywhere, unparseable compound commands killed at timeout); §9.3. [CC-05]

### BG-29 (RED)  Background log is tail-rotated at N MB; the process keeps running, the job stays `[running]`, `jobs output` still tails the recent end
- Category: limits-output-cap
- Catches: `MAX_LOG_BYTES = 50 * 1024 * 1024` is declared with the comment `"hard output cap; oversized bg jobs are killed"` but is **never referenced** anywhere in spawn/watcher paths (grep-confirmed: single hit at the declaration). A backgrounded `tail -f` / `yes` / chatty dev server in a loop runs forever and writes forever → `$TMPDIR/pi-codex-bg/*.log` grows unbounded and fills the disk. Guards both the current silent non-enforcement and a rotation-fails-to-fire regression. The intended design (decided against the surveyed kill-at-N harnesses) is **tail-rotate, not kill**: the built-in pi `bash` tool proves cap-on-read (no process kill) is enough for foreground work — codex-bash extends that to background work by keeping only the last N MB on disk so a long-lived chatty job can stay `[running]` without filling anything.
- Steps: `bash { command: "for i in $(seq 1 1000000); do echo line-$i; done; sleep 5", run_in_background: true }` (run with `timeout: 120` to avoid racing the auto-background); poll `stat -c%s $TMPDIR/pi-codex-bg/<id>.log` every 2 s during the run and after completion; `jobs { action: "list" }`; `jobs { action: "output", id: <id> }`.
- Expected (intended): The log file is **tail-rotated** at the configured cap (e.g. `MAX_LOG_BYTES = 50 MB`): once it exceeds the cap the head is discarded and only the last ~50 MB is kept, so `stat` shows the file size oscillating at/below the cap rather than growing to ~38 GB (1 000 000 lines × ~38 bytes). The job stays `[running]` throughout — **it is never killed for being chatty** (the point of backgrounding is "let it keep running while I work," so a dev server logging 200 MB over an hour shouldn't die). `jobs output` returns the recent tail (`line-999950` … `line-1000000`) with the `…[ truncated ]` marker; the completion notification (when the loop ends) carries the bounded tail. The process exits on its own; the cap only bounds disk. **As-is, `MAX_LOG_BYTES` is dead config, the log grows to ~38 GB, and the notification carries it truncated to `OUTPUT_PREVIEW_CHARS` → the test is RED and pins current behavior so it flips when rotation is wired.**
- Origin: codex-bash §12.1 `MAX_LOG_BYTES` comment vs. dead config (source-verified); pi built-in `bash` `OutputAccumulator` `maxRollingBytes` rolling tail + temp-file spill (cap-on-read, no process kill) as the design precedent (`output-accumulator.js`; `truncate.js` `DEFAULT_MAX_BYTES = 50*1024`, `DEFAULT_MAX_LINES = 2000`); contrast kill-at-N harnesses — Codex `HeadTailBuffer` 1 MiB clause §3.4; ismailsaleekh 20 MB → SIGTERM §8.1; patty 100 MB → kill §8.2; Claude 5 GB §4.3; vanillagreen 1 MB buffer §8.3. [CODEX-11c, CC-16, LIM-01]

---

## Suite gaps — behaviors NOT yet testable against `codex-bash.ts` (missing features, per §12.6)

Aggregated from all four lanes' gap notes. These are future test cases to add when the corresponding §12.6 work lands.

1. **Codex 64-job cap + LRU eviction with 8-MRU protected set and *visible* eviction** (§11.4, §12.6.4) — no cap exists; `prune_processes_if_needed` ordering (exited non-protected first, then LRU live; locked-process soft-cap overshoot, verified `pm.rs`) cannot be exercised. BG-15's anti-silent-eviction invariant is the only proxy.
2. **Patty-style coalescing** (§12.6.5) — one summary flush at `agent_end` (passive, no wake) + idle 400 ms steer-wake. codex-bash still emits one immediate followUp per job (BG-09 pins per-task as current behavior); no `agent_end`-flush or idle-wake test can run. (Idle-time coalescing WAS observed empirically — 2 completions while idle → 1 wake turn — via `eval/`; what remains unimplemented is patty's *agent_end* summary flush and its 400 ms idle steer-wake.)
3. **Cursor/vanillagreen `notify_on_output` sentinel + output wakes** (§6.1, §8.3, §12.6.8) — pattern-triggered steer wakes with 1.5 s settle debounce, the 20-wake/20KB budget + budget-exhausted notice, and durable exit-wake replay at `session_start` (current `session_start` only mkdirs the log dir). None implemented.
4. **Orphan liveness watcher** (vanillagreen, 30 s + PID-reuse probe, §8.3) — not implemented.
5. **patty stall detection** (45 s quiet → warning, §8.2) — no stall watcher exists.
6. **patty sleep≥2 s block** steering to `jobs attach`/monitor (§8.2) — only prompt text, no enforcement (BG-28 is the closest proxy).
7. **Codex `write_stdin` control-byte interactivity** (`\u0003` → SIGINT, non-TTY accepts only that byte, §3.1, §12.6.8) — file-fd pipes by design; `jobs kill` is the only signal path; the literal-`"\u0003"` pitfall is structurally avoided.
8. **Codex-shaped result phrasing** (`Process running with job ID …` / `Process exited with code N` + per-call `Wall time`, §12.6.6) — BG-04 asserts current `Process backgrounded as …` phrasing.
9. **`/ps` and `/stop` user commands** (§12.6.2) — user surface is shortcut-only today; Codex `/stop`-kills-all and #17821 workaround untestable.
10. **`yield_time_ms` clamping** (Codex 250–30 000 ms, empty polls 5 000–300 000, verified `ue_mod.rs`, §3.1) — codex-bash's `timeout` seconds param is unclamped: `timeout:0`/negative yields degenerate instant-background; no clamp to test.
11. **ismailsaleekh extras** — 3 s SIGTERM→SIGKILL grace, 100-task recent ring, EventBus channels, attested `pi --mode json` child variant with hard-disabled notifications, XML message shape (codex-bash sends plain text), telemetry wrapper (§8.1). None implemented.
12. **patty 24 h stale-log sweep** (§8.2) — no sweep; BG-26 documents but does not reclaim orphan logs.
13. **OpenCode background *subagents*** (`task background:true`, `subagent_type`, `subagent_depth` nesting, §5.1/§5.3) — codex-bash backgrounds commands only; no subagent tool, so nesting-depth and subagent-scope-kill have no analog.
14. **Devin managed Devins** (child sessions in isolated VMs, ACU limits, scheduled self-messages, confidence-score approval gating, REST v3/MCP event timeline, §7.1/§7.2) — none of the child-session, gating, or event-timeline machinery exists.
15. **Claude env toggles** `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` / `CLAUDE_AUTO_BACKGROUND_TASKS` (§4.2) — no env config exists; `DEFAULT_TIMEOUT_MS` is a hard constant, only the per-call `timeout` is configurable.
16. **Claude `Monitor` per-line watcher tool** (§4.1) — no equivalent tool, only the 250 ms foreground streaming poller (BG-12 is the foreground-race analog).
17. **Claude enumeration half of list-on-error** (§4.1/§10.3) — unknown-id errors say only `Unknown job: <id>`; they don't enumerate running jobs (BG-17 covers the explicit-error half but not the enumeration half).