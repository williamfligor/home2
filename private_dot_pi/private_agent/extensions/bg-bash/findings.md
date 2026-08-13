# Code Review: bg-bash extension

Reviewed all files in `private_dot_pi/private_agent/extensions/bg-bash` (index.ts, test.mjs, TESTCASES.md, eval/, plus the stray `.pi/subagents/missions` artifact). Verified the extension against the installed pi 0.80.3 API surface (ExtensionAPI, ToolDefinition, InputEvent, sendCustomMessage delivery semantics) — the API usage is correct. The 53-case smoke suite passes. Findings below are from code inspection plus empirical reproduction against the live extension via jiti.

## Findings

**[P1] `readTail` truncation drops the entire tail when the window is dominated by one long line** — `index.ts:339-340`

```js
const nl = s.indexOf("\n");
s = "…[ truncated ]\n" + (nl >= 0 ? s.slice(nl + 1) : s);
```

When the 20KB read window is a single line ending in `\n` (minified output, base64, a big JSON/blob — any output whose last line exceeds the window), the first newline is the *last* character, and `s.slice(nl + 1)` yields `""`. The whole window is discarded. Reproduced deterministically: a backgrounded command writing `1999900` chars + `ENDMARKER\n` returns `"…[ truncated ]\n"` (15 chars, zero actual output) from `jobs output` (5/5 runs), the completion notification tail (10/10), and the foreground fast-completion result (5/5). The model silently sees none of the command's output — this breaks the core BG-25 "bounded tail followed by whole lines" contract for any log with a long final line, and it also hits the live streaming poller (`streamLog`, line 407) and the notification read (line 435). The multi-line test cases (`seq 1 400000`) pass only because short lines put the first newline near the window start.

The "drop the partial first line" intent should only slice when there is content after that newline:

```js
const nl = s.indexOf("\n");
s = "…[ truncated ]\n" + (nl >= 0 && nl < s.length - 1 ? s.slice(nl + 1) : s);
```

**[P2] Completion/foreground result is read before the log stream's pending writes reach disk** — `index.ts:296-298` (resolve after `log.close()`), read at `index.ts:435` (watcher), `725` (quick path), `758` (main path)

`log.close()` calls `stream.end()`, which flushes asynchronously; `resolve()` runs immediately, and the `.then` readers `readTail` the file in the same microtask — before libuv has written the pump's buffered data. Observed empirically: at read time the on-disk file held 20014 of 2000000 bytes, so the result/notification tail was cut at an arbitrary byte offset of the command's final output. This is most visible with a large final pipe chunk, but any output whose last chunk is still buffered at close time is affected (the quick path then unlinks the log, so the missing bytes are permanently gone). Await the stream's `finish` before reading (e.g., resolve the exit promise after the flush, or `await once(log.stream, "finish")`).

**[P3] Cooperative steering drops images attached to the user's input** — `index.ts:858`

`pi.sendUserMessage(event.text, { deliverAs: "followUp" })` re-delivers only the text. `InputEvent` carries `images`, and the `transform` result supports them (the inline-bash example passes `event.images` through). If the user pastes an image while a foreground command is running, the re-delivered follow-up turn loses it.

**[P3] `jobs kill` suppresses the completion notification that TESTCASES.md BG-16 promises** — `index.ts:798`

`jobs kill` sets `outputConsumed = true` (comment: "suppress redundant completion notice later"), so the watcher never emits `bg-job-finished`. TESTCASES.md BG-16 ("Expected … A `bg-job-finished` message arrives with `killed` in the exit line") documents the opposite. The suppression is defensible (the agent initiated the kill), but the spec and implementation disagree; one of them is stale and the divergence will confuse future regression work.

**[P3] Stray dev artifact committed under the extension** — `.pi/subagents/missions/ce596cb2-…json`

A failed workflow-run mission file (`status: "failed"`, ENOENT cwd error) sits inside the shipped extension directory. It carries no code, but it's runtime debris from development and shouldn't be part of the extension snapshot.

## Verdict

**needs attention** — the P1 `readTail` slicing bug silently loses the model-facing output for a common output class and is deterministic; it should be fixed before this ships.

## Human Reviewer Callouts (Non-Blocking)

- **This change introduces a new dependency:** `eval/package.json` adds `vitest ^3.2.0` (dev-only, model-backed eval harness; not part of the runtime extension).
- **This change introduces backwards-incompatible public schema/API/contract changes:** overrides the built-in `bash` tool definition (schema gains `description`; timeout semantics change from kill/error to auto-background) and registers a new `jobs` tool + `/bg`, `/bg-stop`, `/bg-clear` commands and `ctrl+shift+b` shortcut; also emits `customType: "bg-job-finished"` custom messages with `triggerTurn` delivery.
- **This change includes irreversible or destructive operations:** `jobs kill`/`/bg-stop` SIGTERM process groups; `session_shutdown` SIGTERMs every running job and escalates to SIGKILL after 3s; foreground job logs are unlinked on completion.
- **This change modifies auth/permission behavior:** none.
- **This change adds a database migration:** none.
- **This change changes a dependency (or the lockfile):** none.
