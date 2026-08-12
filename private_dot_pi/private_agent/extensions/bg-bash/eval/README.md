# bg-bash eval suite (model-backed)

End-to-end delivery-semantics evals for the bg-bash extension. Where `test.mjs`
drives the extension through jiti against a stub `ExtensionAPI` (fast, offline,
deterministic — run it in CI), this suite drives a **real `AgentSession`**: the
extension is loaded into an isolated temp project, background jobs are launched
through the real `bash` tool, and assertions are made on the live transcript —
the delivery behaviors a stub cannot see:

| eval | spec case | what it proves |
|---|---|---|
| BG-27 | tool contract | the loaded `bash` tool carries `run_in_background` + "you'll be notified" |
| BG-08 | idle wake | an idle completion wakes a **new** turn on its own (no second prompt) |
| BG-09 | mid-turn passive | a mid-turn completion queues and never interrupts the in-progress turn |
| coalescing | observational | N completions while idle → how many wake turns (observed: 2 jobs → 1 turn) |

## Run

```bash
cd eval
npm install
PI_PROVIDER=opencode-go PI_MODEL=deepseek-v4-flash npx vitest run
```

`PI_PROVIDER`/`PI_MODEL` also read from the environment. Model-backed → costs
tokens and is mildly nondeterministic; run more than once if a delivery test
fails before debugging the extension.

## Notes

- The harness mirrors pi's own `packages/evals` (real `createAgentSessionServices`
  / `createAgentSessionFromServices`, isolated temp cwd + agent dir, extension
  seeded into `.pi/extensions` then reloaded — the same mechanism as
  `packages/evals/src/extensions.eval.ts`'s `hello.ts`).
- Requires the pi install to be discoverable (`PI_INSTALL` env, `require.resolve`,
  `which pi`, or the mise fallback in the eval file).
- A `session.dispose()` in cleanup does **not** emit `session_shutdown`, so a bg
  job still running at test end fires its notification on a stale ctx. The tests
  avoid this by letting jobs complete inside the test; the 400 ms settle in
  `cleanup()` absorbs stragglers.
