/**
 * bg-bash.ts — a pi extension that makes the `bash` tool auto-background
 * long-running commands (Claude-Code / Codex-style), so the agent can keep
 * working while a build, dev server, or test suite runs.
 *
 * What it does:
 *   - Overrides the built-in `bash` tool (registerTool wins on name collision;
 *     tool-execution.js falls back to the built-in bash renderer when
 *     renderCall/renderResult are absent, so the command chip + streaming box
 *     render like stock bash for free).
 *   - A foreground command races completion against an auto-background timer
 *     (default 30 s, env PI_BG_TIMEOUT_MS, per-call `timeout` in seconds).
 *   - On timeout (or Ctrl+Shift+B, or the user typing while it runs = cooperative
 *     steering) the command is promoted to a tracked background job and the tool
 *     returns immediately with a job id; the agent keeps its turn.
 *   - `run_in_background: true` spawns straight to the background.
 *   - `jobs` tool: list / output (tail) / kill. (No attach — the completion push
 *     makes a blocking wait an anti-pattern. No cleanup — see /bg-clear.)
 *   - On completion: pi.sendMessage({customType:'bg-job-finished',…},
 *     {deliverAs:'followUp', triggerTurn:true}) — the agent is woken with the
 *     result when idle (the ecosystem-consensus behavior); queued passively
 *     (never interrupts) when mid-turn.
 *   - Output is captured in an in-memory TAIL RING (PI_BG_RING_MB, default
 *     2 MB) per job: stdout+stderr are buffered (last N MB), and the model
 *     only ever reads a short bounded tail. No process kill for being chatty
 *     — a long-running dev server that logs 200 MB over an hour should stay
 *     up; its ring just holds the most recent 2 MB. No on-disk log, no
 *     /tmp accumulation, no rotation races — the ring is an array of buffers
 *     that evicts from the front when it exceeds the cap.
 *   - On session shutdown: running jobs are SIGTERM'd (process group) and
 *     escalated to SIGKILL after a grace; the in-memory registry is cleared.
 *
 * Slash commands: /bg (list), /bg-stop (kill all running), /bg-clear (forget
 * finished jobs).
 *
 * Verified against pi 0.80.3. No external deps; no tmux; no native addons.
 *   pi -e <path-to>/bg-bash.ts
 *   # or drop into ~/.pi/agent/extensions/bg-bash.ts for auto-discovery
 *
 * Design + survey: BACKGROUND.md. Test suite: TESTCASES.md.
 */

import { createBashToolDefinition, type AgentToolResult, type AgentToolUpdateCallback, type ExtensionAPI, type ExtensionContext, type Theme, type ToolDefinition, type ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import { Container, Text, type Component, type KeyId, type Text as TextComponent } from "@earendil-works/pi-tui";
import { Type, type Static } from "typebox";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";

// ---------- configuration ----------

/** Parse a positive-number env var; fail fast at load so a typo like
 * `PI_BG_RING_MB=2mb` or an empty `PI_BG_RING_MB=` doesn't silently produce
 * `NaN` — which the previous `Number(env ?? default)` returned, making the
 * ring's eviction cap unreachable and the ring unbounded (in RAM). */
function positiveNumberEnv(env: string | undefined, fallback: number, name: string): number {
  if (env === undefined || env === "") return fallback;
  const n = Number(env);
  if (!Number.isFinite(n) || n <= 0)
    throw new Error(`bg-bash: ${name} must be a positive number, got: ${JSON.stringify(env)}`);
  return n;
}

const DEFAULT_TIMEOUT_MS = positiveNumberEnv(process.env.PI_BG_TIMEOUT_MS, 30_000, "PI_BG_TIMEOUT_MS"); // auto-background threshold (ms)
const QUICK_COMPLETION_MS = 2_000; // skip all machinery if it finishes this fast
const POLL_INTERVAL_MS = 250; // live-output throttle interval (coalesces chunk bursts into ≤4 renders/sec)
const OUTPUT_PREVIEW_CHARS = 20_000; // how much we tail into the model result / UI
const RING_BYTES = positiveNumberEnv(process.env.PI_BG_RING_MB, 2, "PI_BG_RING_MB") * 1024 * 1024; // in-memory tail-ring cap per job (RAM)
// Collapsed-view line cap for every bg-bash output surface (handoff box, jobs
// output, completion notifications). Stock bash's own preview — foreground
// results and streaming partials — is fixed at 5 lines in pi core and is not
// reachable from an extension.
const PREVIEW_LINES = positiveNumberEnv(process.env.PI_BG_PREVIEW_LINES, 5, "PI_BG_PREVIEW_LINES");
const SHUTDOWN_GRACE_MS = 3_000; // SIGTERM → SIGKILL escalation window at session shutdown

// We register a fresh `bash` tool (same name -> overwrites the built-in via
// agent-session _refreshToolRegistry Map.set). We deliberately OMIT
// renderCall/renderResult: tool-execution.js falls back to the built-in bash
// renderer by tool name, so the command chip + streaming output box render
// exactly like stock bash, for free, with no TS generic friction.

const bashSchema = Type.Object({
  command: Type.String({ description: "The bash command to run." }),
  timeout: Type.Optional(
    Type.Number({
      description:
        "Auto-background threshold in seconds. If the command runs longer than this, it is moved to the background and this tool returns immediately with a job id. Default: 30 (override with the PI_BG_TIMEOUT_MS env var, in ms).",
    }),
  ),
  run_in_background: Type.Optional(
    Type.Boolean({
      description: "Start the command in the background immediately, skipping the foreground race.",
    }),
  ),
  description: Type.Optional(
    Type.String({ description: "Optional human-readable label for the background job." }),
  ),
});
type BashParams = Static<typeof bashSchema>;

const jobsSchema = Type.Object({
  action: Type.String({ description: '"list" | "output" | "kill"' }),
  id: Type.Optional(Type.String({ description: "Job id (required for output/kill)." })),
  maxBytes: Type.Optional(Type.Number({ description: "Max bytes to tail for output (default 20000)." })),
});
type JobsParams = Static<typeof jobsSchema>;

/** Renderer metadata attached to bash results. `backgrounded` marks a handoff
 * to a background job so the custom renderResult can draw a distinct box. */
interface BgBashDetails {
  backgrounded?: boolean;
  jobId?: string;
  pid?: number;
  reason?: "spawned" | "timeout" | "manual";
}

// ---------- runtime state ----------

type JobStatus = "running" | "completed" | "failed" | "killed";

/** What a job's process ended with; `spawnError` is set when bash never exec'd. */
interface ExitResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  spawnError?: Error;
}

interface Job {
  id: string;
  name?: string;
  command: string;
  pid: number;
  ring: RingBuffer;
  status: JobStatus;
  exitCode: number | null;
  startedAt: number;
  endedAt?: number;
  isBackground: boolean;
  outputConsumed: boolean; // suppress redundant completion notice if already read
  exit: Promise<ExitResult>;
}

interface ForegroundSlot {
  requestPause: (reason: "manual" | "timeout") => void;
}

interface Registry {
  jobs: Map<string, Job>;
  foreground: Map<string, ForegroundSlot>; // keyed by toolCallId; insertion order = recency
}

const reg: Registry = { jobs: new Map(), foreground: new Map() };
let autoBackgroundEnabled = true;

// ---------- bounded, in-memory tail ring ----------
//
// stdout+stderr chunks are buffered in-memory (an array of Buffer slices that
// evicts from the front once it exceeds `cap`). The model only ever reads a
// short bounded tail. Killing the process for being chatty is wrong — a dev
// server that logs 200 MB over an hour should stay up; its ring just holds the
// most recent `cap` bytes. Replacing the previous on-disk tail-rotating pump:
// no file, no /tmp accumulation, no flush ordering, no dead-stream reopen, no
// rotation race window, no disk-fill risk. The cost is `cap` RAM per job
// (default 2 MB) — bounded and reclaimed when the job entry is dropped
// (foreground finish, /bg-clear, session shutdown). The process is never killed
// for being chatty; the ring just evicts old data.

class RingBuffer extends EventEmitter {
  readonly cap: number;
  private chunks: Buffer[] = [];
  /** Current total bytes held; the source of truth alongside `chunks`. */
  byteLength = 0;

  constructor(cap: number) {
    super();
    this.cap = cap;
  }

  /** Append a chunk; evict front chunks (and trim an oversize single chunk)
   * until `byteLength <= cap`. Emits 'data' so `streamLog` can push live tails. */
  write(chunk: Buffer): void {
    this.chunks.push(chunk);
    this.byteLength += chunk.length;
    while (this.byteLength > this.cap && this.chunks.length > 1) {
      const drop = this.chunks.shift()!;
      this.byteLength -= drop.length;
    }
    // A single chunk larger than the cap: keep only its tail (the loop above
    // can't evict the last chunk; trim it in place).
    if (this.byteLength > this.cap && this.chunks.length === 1) {
      const over = this.byteLength - this.cap;
      this.chunks[0] = this.chunks[0].subarray(over);
      this.byteLength = this.cap;
    }
    this.emit("data");
  }

  /** The last `min(byteLength, maxBytes)` bytes as a UTF-8 string. A byte window
   * may split a multibyte char at the boundary; the resulting replacement char
   * (U+FFFD) is tolerated by the built-in bash renderer's readTail too. */
  tailString(maxBytes: number): string {
    const len = Math.min(this.byteLength, maxBytes);
    if (len <= 0) return "";
    let need = len;
    const parts: Buffer[] = [];
    for (let i = this.chunks.length - 1; i >= 0 && need > 0; i--) {
      const c = this.chunks[i];
      if (c.length <= need) {
        parts.unshift(c);
        need -= c.length;
      } else {
        parts.unshift(c.subarray(c.length - need));
        need = 0;
      }
    }
    return Buffer.concat(parts, len).toString("utf8");
  }
}

// ---------- helpers ----------

function nextJobId(): string {
  return `b${randomBytes(4).toString("hex")}`;
}

function text(s: string): { type: "text"; text: string } {
  return { type: "text", text: s };
}

function spawnPiped(args: {
  command: string;
  cwd: string;
  cap: number;
}): { pid: number; ring: RingBuffer; exit: Job["exit"]; child: ChildProcess } {
  const ring = new RingBuffer(args.cap);
  const child = spawn("bash", ["-c", args.command], {
    cwd: args.cwd,
    detached: true, // new process group/session — survives independently, killable as -pid
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  });
  // Synchronous spawn failure (e.g. shell missing): surface as a normal tool
  // error instead of registering an un-killable pid:undefined job. Attach a
  // noop 'error' listener BEFORE bailing: spawn failures emit 'error'
  // asynchronously on the next tick, and with no listener Node rethrows it
  // as an uncaught exception that crashes the agent process. The ring is
  // in-memory and GC'd on scope exit, so the failure path leaks nothing.
  if (child.pid == null) {
    child.once("error", () => {});
    throw new Error(`Failed to spawn bash: ${args.command}`);
  }
  // stdout+stderr → ring. No backpressure bridge needed: the ring never blocks
  // (it evicts rather than applying backpressure), so the pipes are never
  // paused and `write` is synchronous in all cases.
  child.stdout?.on("data", (d: Buffer) => ring.write(d));
  child.stderr?.on("data", (d: Buffer) => ring.write(d));

  const exit = new Promise<ExitResult>((resolve) => {
    child.on("error", (err: Error) => resolve({ code: null, signal: null, spawnError: err }));
    child.on("close", (code, signal) => {
      // Best-effort: reap any stragglers in the group if killed by signal.
      if (signal && child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          /* group may already be gone */
        }
      }
      // No flush needed: 'close' fires only after stdout/stderr have ended,
      // so every 'data' chunk is already in the ring. Every reader (watcher,
      // foreground result, jobs output) reads the ring directly.
      resolve({ code: code ?? null, signal: signal ?? null });
    });
  });
  // NOTE: deliberately NOT unref'd here. A foreground call must hold the Node
  // event loop — with an unref'd child (which also unrefs its stdio pipes), a
  // bare-node embedding drains the loop and exits mid-command (observed on
  // `sleep 1` inside the 2s quick window; real pi hides this because the TUI
  // keeps the loop busy). Background jobs are unref'd at promote/spawn-bg so
  // they never keep the process alive.
  return { pid: child.pid, ring, exit, child };
}

/** Signal the whole detached process group (fall back to just the leader). */
function killProcessTree(pid: number, sig: NodeJS.Signals = "SIGTERM"): void {
  try {
    process.kill(-pid, sig);
  } catch {
    try {
      process.kill(pid, sig);
    } catch {
      /* already dead */
    }
  }
}

/** SIGTERM has already been sent to `job.pid`; resolve once `job` exits, or
 * escalate to SIGKILL after the grace window. pi's ExtensionRunner.emit() awaits
 * each session_shutdown handler and its callers await emitSessionShutdownEvent,
 * so awaiting this inside the shutdown handler blocks the shutdown flow only as
 * long as needed: well-behaved jobs resolve on natural exit (clearing the
 * timer); only SIGTERM-trapping detached jobs (a dev server doing graceful
 * shutdown) hold the full grace, then are force-killed rather than orphaned.
 * This replaces an unref'd fallback timer that a draining event loop (headless /
 * bare-node embeds) could starve, leaking the detached group past the session. */
function escalateKill(job: Job): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve();
      }
    };
    const timer = setTimeout(() => {
      try {
        killProcessTree(job.pid, "SIGKILL");
      } catch {
        /* already dead */
      }
      done();
    }, SHUTDOWN_GRACE_MS);
    job.exit.then(() => done());
  });
}

/** Tail the ring to a bounded string (drops a partial first line when truncated). */
function readTail(ring: RingBuffer, maxBytes = OUTPUT_PREVIEW_CHARS): string {
  const total = ring.byteLength;
  if (total === 0) return "";
  const s = ring.tailString(maxBytes);
  if (total > maxBytes) {
    const nl = s.indexOf("\n");
    // Only drop the partial first line when there is content after the
    // newline. A window dominated by one long line (minified output, base64,
    // a big JSON/blob) ends with its newline at the LAST character; slicing
    // past it would discard the entire tail (P1).
    return "…[ truncated ]\n" + (nl >= 0 && nl < s.length - 1 ? s.slice(nl + 1) : s);
  }
  return s;
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${s % 60}s`;
}

function formatList(): string {
  const jobs = [...reg.jobs.values()];
  if (jobs.length === 0) return "No background jobs.";
  const now = Date.now();
  return jobs
    .map((j) => {
      const dur = j.endedAt ? formatDuration(j.endedAt - j.startedAt) : formatDuration(now - j.startedAt);
      const name = j.name ? ` ${j.name}` : "";
      const ec = j.exitCode !== null ? ` exit=${j.exitCode}` : "";
      return `${j.id}${name} [${j.status}] pid=${j.pid}${ec} ${dur}\n  $ ${j.command}`;
    })
    .join("\n");
}

/** Insertion order of a Map = recency, so the last key is the most-recent foreground slot. Handles concurrent foreground calls without a shared mutable scalar. */
function lastForegroundToolCallId(): string | null {
  let last: string | null = null;
  for (const k of reg.foreground.keys()) last = k;
  return last;
}

function showHint(ctx: ExtensionContext): void {
  if (!ctx.hasUI) return;
  try {
    ctx.ui.setWidget("bg-hint", ["(ctrl+shift+b to run in background)"], { placement: "belowEditor" });
  } catch {
    /* setWidget shape may vary by version; non-fatal */
  }
}

function clearHint(ctx: ExtensionContext): void {
  if (!ctx.hasUI) return;
  try {
    ctx.ui.setWidget("bg-hint", undefined, { placement: "belowEditor" });
  } catch {
    /* ignore */
  }
}

/** Push growing tails as partial tool results (live output box). Driven
 * directly off the ring's 'data' event and throttled to POLL_INTERVAL_MS so a
 * burst of chunks coalesces into ≤4 renders/sec — matching the cadence of the
 * old statSync poller, without flooding the renderer on a chatty producer.
 * The unref'd timer never holds the loop alive (background jobs must not); a
 * dropped trailing flush is not a correctness issue — foreground results and the
 * completion watcher read the ring directly. */
function streamLog(
  ring: RingBuffer,
  onUpdate: AgentToolUpdateCallback<BgBashDetails | undefined> | undefined,
): { stop: () => void } {
  let stopped = false;
  let dirty = false;
  let pending: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    pending = null;
    if (stopped || !dirty) return;
    dirty = false;
    onUpdate?.({ content: [text(readTail(ring))], details: undefined });
  };
  const onData = () => {
    if (stopped) return;
    dirty = true;
    if (pending === null) {
      pending = setTimeout(flush, POLL_INTERVAL_MS);
      pending.unref();
    }
  };
  ring.on("data", onData);
  return {
    stop: () => {
      stopped = true;
      if (pending) clearTimeout(pending);
      ring.off("data", onData);
    },
  };
}

/** Wire a background (or about-to-be-backgrounded) job's exit -> terminal state + agent notification (when idle) / passive queue (when mid-turn). */
function startBackgroundWatcher(args: { job: Job; ctx: ExtensionContext; pi: ExtensionAPI }): void {
  args.job.exit.then((r) => {
    if (args.job.status !== "running") return;
    if (r.code === 0) args.job.status = "completed";
    else if (r.code === null) args.job.status = "killed"; // signal death (incl. kill -9) or spawn-error path
    else args.job.status = "failed"; // any non-zero exit, regardless of 128+signum convention (a script can `exit 137`)
    args.job.exitCode = r.code;
    args.job.endedAt = Date.now();

    if (args.job.outputConsumed) return; // the agent already read the output; don't notify (the #18544 notification-wall guard)

    const tail = readTail(args.job.ring);
    // Collapsed-view contract: a notification must never dump the whole tail
    // into the chat. Show the last 5 lines plus a pointer to jobs output for
    // the rest (the ring is the only store; there is no file to expand into).
    const tailPreview = (() => {
      if (!tail) return "";
      const lines = tail.split("\n");
      if (lines.length <= PREVIEW_LINES) return `\n\n----\n${tail}`;
      const shown = lines.slice(-PREVIEW_LINES).join("\n");
      return `\n\n----\n… (${lines.length - PREVIEW_LINES} earlier lines — jobs action='output' id='${args.job.id}' to read more)\n${shown}`;
    })();
    const exitLine = r.spawnError
      ? `spawn error: ${r.spawnError.message}`
      : r.code === null
        ? r.signal
          ? `killed (signal ${r.signal})`
          : "killed"
        : `exit ${r.code}`;
    const msg =
      `Background job ${args.job.id} ${args.job.status} (${exitLine}) after ${formatDuration(
        args.job.endedAt - args.job.startedAt,
      )}.\nCommand: ${args.job.command}` +
      tailPreview;
    // The `triggerTurn` branch (agent-session sendCustomMessage) starts a new
    // LLM turn when the agent is idle; when mid-turn, `deliverAs:'followUp'`
    // queues passively and never interrupts. N jobs finishing while idle =>
    // the first starts a turn, the rest queue into it (accidental coalescing).
    args.pi.sendMessage(
      { customType: "bg-job-finished", content: msg, display: true },
      { deliverAs: "followUp", triggerTurn: true },
    );
    if (args.ctx.hasUI) {
      args.ctx.ui.notify(
        `${args.job.status === "failed" ? "✗" : args.job.status === "killed" ? "⨯" : "✓"} ${args.job.id} ${args.job.status}`,
        args.job.status === "failed" || args.job.status === "killed" ? "error" : "info",
      );
    }
  });
}

// ---------- the bash tool ----------

// Background-handoff result box. Replaces the stock "Took 0.0s" footer (a tool
// call that returns in ~0ms next to a long-running command) with a clear status
// line. Only the handoff path uses custom rendering; every other result
// delegates to the stock bash renderer untouched.

/** Minimal slice of ToolRenderContext the background box needs. */
type BgRenderContext = {
  state: Record<string, unknown>;
  lastComponent: Component | undefined;
  invalidate: () => void;
};

function renderBackgroundResult(
  result: AgentToolResult<BgBashDetails | undefined>,
  options: ToolRenderResultOptions,
  theme: Theme,
  context: BgRenderContext,
): Component {
  const d = result.details;
  // Stop the stock renderer's 1s "Elapsed" re-render interval, which it started
  // during the foreground streaming phase of an auto-backgrounded command.
  const state = context.state as { interval?: ReturnType<typeof setInterval> };
  if (state.interval) {
    clearInterval(state.interval);
    state.interval = undefined;
  }
  const component = context.lastComponent instanceof Container ? context.lastComponent : new Container();
  component.clear();
  const output = (result.content ?? [])
    .map((c) => ("text" in c ? c.text : ""))
    .join("\n")
    .trim();
  const lines = output.split("\n");
  if (output) {
    const preview = !options.expanded && lines.length > PREVIEW_LINES;
    const shown = preview
      ? `${theme.fg("muted", `… (${lines.length - PREVIEW_LINES} earlier lines — Ctrl-O to expand)`)}\n${theme.fg("toolOutput", lines.slice(-PREVIEW_LINES).join("\n"))}`
      : theme.fg("toolOutput", output);
    component.addChild(new Text(`\n${shown}`, 0, 0));
  }
  const verb =
    d?.reason === "timeout"
      ? "Auto-backgrounded"
      : d?.reason === "manual"
        ? "Backgrounded"
        : "Running in background";
  component.addChild(new Text(`\n${theme.fg("toolTitle", `▶ ${verb} — job ${d?.jobId ?? "?"} (pid ${d?.pid ?? "?"})`)}`, 0, 0));
  component.invalidate();
  return component;
}

function makeBashTool(_pi: ExtensionAPI): ToolDefinition<typeof bashSchema, BgBashDetails | undefined> {
  // Stock bash renderer, wrapped: normal results keep the exact stock rendering
  // (chip + streaming box + real "Took" duration); handoff results get the
  // distinct background box above instead of a misleading "Took 0.0s".
  const stockBash = createBashToolDefinition(process.cwd());
  return {
    name: "bash",
    label: "bash",
    description:
      "Run a bash command. Commands that run longer than the timeout (default 30s) are automatically moved to the background and this tool returns immediately with a job id; the agent is notified when they finish. Use /bg-off to disable automatic backgrounding and cooperative steering; explicit run_in_background=true remains available. Check / inspect / stop background jobs with the `jobs` tool.",
    promptSnippet:
      "Run shell commands; long-running commands auto-background after ~30s — use /bg-off to disable automatic backgrounding; use jobs to inspect/stop background jobs; avoid `sleep` to wait",
    promptGuidelines: [
      "Prefer run_in_background:true for commands expected to be long-running (dev servers, watchers, test suites, builds).",
      "After a command auto-backgrounds, continue with independent useful work — do NOT call sleep or poll jobs merely to wait; you will be notified when it finishes. Use jobs action='output' to inspect, jobs action='kill' to stop.",
      "Use /bg-off when automatic backgrounding and cooperative steering are not wanted; explicit run_in_background:true remains available. Use /bg-on to restore the default.",
    ],
    parameters: bashSchema,

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const command = params.command?.trim();
      if (!command) throw new Error("Command is empty.");

      if (params.run_in_background) {
        return spawnBackground({ toolCallId, command, name: params.description, ctx, pi: _pi });
      }
      return runForeground({
        toolCallId,
        command,
        timeoutMs: autoBackgroundEnabled ? (params.timeout ? params.timeout * 1000 : DEFAULT_TIMEOUT_MS) : undefined,
        backgroundingEnabled: autoBackgroundEnabled,
        signal,
        onUpdate,
        ctx,
        pi: _pi,
      });
    },

    renderResult(result, options, theme, context) {
      if (result.details?.backgrounded && !options.isPartial) {
        return renderBackgroundResult(result, options, theme, context);
      }
      const stockRender = stockBash.renderResult;
      if (stockRender) {
        // The stock bash renderer is typed against its own details type; ours is
        // runtime-compatible (stock only reads truncation/fullOutputPath, which we
        // never set — non-background results carry `details: undefined`).
        return stockRender(result as never, options, theme, context);
      }
      // Safety net: no stock renderer available.
      return new Text((result.content ?? []).map((c) => ("text" in c ? c.text : "")).join("\n"), 0, 0);
    },
  };
}

function spawnBackground(args: {
  toolCallId: string;
  command: string;
  name?: string;
  ctx: ExtensionContext;
  pi: ExtensionAPI;
}): AgentToolResult<BgBashDetails | undefined> {
  const id = nextJobId();
  const { pid, ring, exit, child } = spawnPiped({ command: args.command, cwd: args.ctx.cwd, cap: RING_BYTES });
  child.unref(); // run_in_background: spawned straight to background
  void child; // child's lifetime is held by the `exit` promise closure; kill uses pid via killProcessTree
  const job: Job = {
    id,
    name: args.name,
    command: args.command,
    pid,
    ring,
    status: "running",
    exitCode: null,
    startedAt: Date.now(),
    isBackground: true,
    outputConsumed: false,
    exit,
  };
  reg.jobs.set(id, job);
  startBackgroundWatcher({ job, ctx: args.ctx, pi: args.pi });
  return {
    content: [
      text(
        `Command running in background with ID: ${id}.${args.name ? ` Name: ${args.name}.` : ""}\nUse the jobs tool (action='output', id='${id}') to read its output.`,
      ),
    ],
    details: { backgrounded: true, jobId: id, pid, reason: "spawned" },
  };
}

async function runForeground(args: {
  toolCallId: string;
  command: string;
  timeoutMs: number | undefined;
  backgroundingEnabled: boolean;
  signal: AbortSignal | undefined;
  onUpdate: AgentToolUpdateCallback<BgBashDetails | undefined> | undefined;
  ctx: ExtensionContext;
  pi: ExtensionAPI;
}): Promise<AgentToolResult<BgBashDetails | undefined>> {
  const { toolCallId, command, timeoutMs, backgroundingEnabled, signal, onUpdate, ctx, pi } = args;
  const id = nextJobId();

  const { pid, ring, exit, child } = spawnPiped({ command, cwd: ctx.cwd, cap: RING_BYTES });

  // pause bridge: Ctrl+Shift+B, the timeout timer, or cooperative steering
  // resolve `pausePromise` to move the command into the background.
  let pauseRequested = false;
  let handedToBackground = false;
  let pauseResolve!: (r: "manual" | "timeout") => void;
  const pausePromise = new Promise<"manual" | "timeout">((r) => {
    pauseResolve = r;
  });
  const requestPause = (reason: "manual" | "timeout") => {
    pauseRequested = true;
    pauseResolve(reason);
  };

  // Abort-signal trap (the crucial subtlety):
  //   - No pause requested -> a genuine cancel (Esc): kill the process group.
  //   - Pause already requested -> cooperative steering / Ctrl+Shift+B / timeout
  //     is moving the command to the background, so we must NOT kill it.
  const onAbort = () => {
    if (!pauseRequested) killProcessTree(pid, "SIGTERM");
  };
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort);
  }

  const slot: ForegroundSlot = { requestPause };
  reg.foreground.set(toolCallId, slot);

  const job: Job = {
    id,
    command,
    pid,
    ring,
    status: "running",
    exitCode: null,
    startedAt: Date.now(),
    isBackground: false,
    outputConsumed: false,
    exit,
  };
  reg.jobs.set(id, job);

  // Auto-background timer. unref so it never keeps the process alive on its own.
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
  if (backgroundingEnabled) {
    timeoutTimer = setTimeout(() => {
      if (!autoBackgroundEnabled || !reg.foreground.has(toolCallId)) return; // disabled, already finished, or backgrounded
      requestPause("timeout");
    }, timeoutMs ?? DEFAULT_TIMEOUT_MS);
    timeoutTimer.unref();
  }

  let progressPoller: { stop: () => void } | undefined;
  let hintTimer: ReturnType<typeof setTimeout> | undefined;
  let hintShown = false;

  const cleanup = () => {
    progressPoller?.stop();
    if (hintTimer) clearTimeout(hintTimer);
    if (timeoutTimer) clearTimeout(timeoutTimer);
    if (signal) signal.removeEventListener("abort", onAbort);
  };

  const finishForeground = (r: ExitResult, output: string) => {
    // A spawn error (bash never exec'd) is a tool error, not a clean result.
    // Any non-zero foreground exit is a tool error (a script can `exit 137`;
    // we don't guess signal deaths from the 128+signum convention). A genuine
    // Esc/abort cancel (abort fired with no pause requested) SIGTERMs the
    // process group, so the child exits with code null — surface it as a tool
    // error (partial output appended) so the model can't mistake the partial
    // output for a clean success, matching stock bash's "Command aborted"
    // throw. Other signal deaths (a command that self-kills, e.g. `kill -9 $$`)
    // keep the partial-output return.
    if (r.spawnError) throw new Error(`Failed to spawn bash: ${r.spawnError.message}`);
    const aborted = !!signal && signal.aborted && !pauseRequested;
    if (aborted) throw new Error(`${output ? `${output}\n` : ""}Command aborted`);
    if (r.code !== null && r.code !== 0) throw new Error(output || `Command exited with code ${r.code}`);
    return { content: [text(output || "(no output)")], details: undefined };
  };
  const reapForegroundJob = () => {
    reg.jobs.delete(id);
  };

  const promoteToBackground = (reason: "manual" | "timeout") => {
    if (handedToBackground) return;
    handedToBackground = true;
    child.unref(); // background jobs must not hold the process alive
    reg.foreground.delete(toolCallId);
    job.isBackground = true;
    startBackgroundWatcher({ job, ctx, pi });
    if (reason === "timeout" && ctx.hasUI) {
      ctx.ui.notify(`▶ ${id} auto-backgrounded after ${Math.round((timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000)}s`, "info");
    }
  };

  try {
    // The hint + live-output streamer arm after the quick window, so fast
    // commands exit before it fires (no "(ctrl+shift+b…)" flash, no streamer
    // for sub-2s runs). It's a delayed side effect — NOT a race contender — so
    // a single `exit` vs `pausePromise` race decides the outcome, and a
    // `timeout` set below QUICK_COMPLETION_MS still wins: pausePromise resolves
    // at 1s, well inside the 2s window (the §12.4 case).
    if (backgroundingEnabled) {
      hintTimer = setTimeout(() => {
        progressPoller = streamLog(ring, onUpdate);
        showHint(ctx);
        hintShown = true;
      }, QUICK_COMPLETION_MS);
      hintTimer.unref();
    }

    // One race: natural completion vs backgrounding (manual or timeout).
    const race = await Promise.race<
      | { kind: "completed"; r: ExitResult }
      | { kind: "backgrounded"; reason: "manual" | "timeout" }
    >([
      exit.then((r) => ({ kind: "completed" as const, r })),
      pausePromise.then((reason) => ({ kind: "backgrounded" as const, reason })),
    ]);

    if (race.kind === "backgrounded") {
      promoteToBackground(race.reason);
      const suffix =
        race.reason === "timeout"
          ? ` (auto-backgrounded after ${Math.round((timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000)}s; still running — use jobs action='output' id='${id}' to check)`
          : "";
      return {
        content: [
          text(`Process backgrounded as ${id}${suffix}\nCommand: ${command}\nPID: ${pid}`),
        ],
        details: { backgrounded: true, jobId: id, pid, reason: race.reason },
      };
    }
    // Completed in the foreground: read output, then drop the job (ring is GC'd).
    const output = readTail(ring);
    reapForegroundJob();
    return finishForeground(race.r, output);
  } finally {
    cleanup();
    if (hintShown) clearHint(ctx);
    reg.foreground.delete(toolCallId);
    if (!handedToBackground) {
      // Genuinely cancelled in the foreground: the job entry was dropped on
      // finish; the ring is GC'd with it. Nothing more to do.
    }
  }
}

// ---------- the jobs tool (list / output / kill) ----------

function renderJobsResult(
  result: AgentToolResult<undefined>,
  options: ToolRenderResultOptions,
  theme: Theme,
): Component {
  const output = (result.content ?? [])
    .map((c) => ("text" in c ? c.text : ""))
    .join("\n")
    .trim();
  const lines = output ? output.split("\n") : [];
  const collapsed = !options.expanded && lines.length > PREVIEW_LINES;
  const shown = collapsed
    ? `${theme.fg("muted", `… (${lines.length - PREVIEW_LINES} earlier lines, Ctrl-O to expand)`)}\n${theme.fg("toolOutput", lines.slice(-PREVIEW_LINES).join("\n"))}`
    : theme.fg("toolOutput", output);
  const component = new Container();
  if (output) component.addChild(new Text(`\n${shown}`, 0, 0));
  component.invalidate();
  return component;
}

function makeJobsTool(_pi: ExtensionAPI): ToolDefinition<typeof jobsSchema, undefined> {
  return {
    name: "jobs",
    label: "Background Jobs",
    description:
      "Manage background bash jobs started by the bash tool. Actions: 'list' (all jobs with status/pid/duration/command), 'output' (tail a job's output, bounded by maxBytes), 'kill' (terminate a running job's whole process group). Use /bg-clear to forget finished jobs.",
    parameters: jobsSchema,
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const action = (params.action ?? "").trim();
      const id = params.id?.trim();

      if (action === "list") {
        return { content: [text(formatList())], details: undefined };
      }

      const job = id ? reg.jobs.get(id) : undefined;
      if (action === "output") {
        if (!job) throw new Error(`Unknown job: ${id}`);
        // Reading a running job is only a partial snapshot; keep the eventual
        // completion notification enabled so callers do not have to poll until
        // the process exits just to learn that it finished. A completed job's
        // final output was explicitly requested, so suppress its redundant
        // notification.
        if (job.status !== "running") job.outputConsumed = true;
        return { content: [text(readTail(job.ring, params.maxBytes) || "(no output yet)")], details: undefined };
      }
      if (action === "kill") {
        if (!job) throw new Error(`Unknown job: ${id}`);
        if (job.status !== "running") throw new Error(`Job ${job.id} is ${job.status}, not running.`);
        job.outputConsumed = true;
        killProcessTree(job.pid, "SIGTERM");
        return { content: [text(`Killed ${job.id}.`)], details: undefined };
      }
      throw new Error(`Unknown jobs action: ${action}`);
    },
    renderCall(args) {
      return new Text(`jobs ${args.action ?? ""}${args.id ? ` ${args.id}` : ""}`, 0, 0) as TextComponent;
    },
    renderResult(result, options, theme) {
      return renderJobsResult(result, options, theme);
    },
  };
}

// ---------- shortcuts + cooperative steering ----------

function backgroundMostRecentForeground(): boolean {
  if (!autoBackgroundEnabled) return false;
  const toolCallId = lastForegroundToolCallId();
  if (!toolCallId) return false;
  const slot = reg.foreground.get(toolCallId);
  if (!slot) return false;
  slot.requestPause("manual");
  return true;
}

function registerShortcuts(pi: ExtensionAPI): void {
  const handler = (ctx: ExtensionContext) => {
    if (backgroundMostRecentForeground()) {
      ctx.ui.notify("▶ Backgrounded — continuing.", "info");
    }
  };
  // Only ctrl+shift+b: ctrl+b collides with the editor's `cursorLeft` binding
  // (`defaultKeys: ["left","ctrl+b"]` in @earendil-works/pi-tui keybindings),
  // which would break cursor-left in the input editor for everyone.
  pi.registerShortcut("ctrl+shift+b" satisfies KeyId, {
    description: "Background the running command",
    handler,
  });
}

function registerCooperativeSteering(pi: ExtensionAPI): void {
  pi.on("input", async (event, ctx) => {
    // Don't hijack messages we (or other extensions) injected ourselves.
    if (event.source === "extension") return { action: "continue" };
    // /bg-on and /bg-off remain usable while a foreground command is running;
    // toggling the mode should not itself background or abort that command.
    const command = event.text.trim();
    if (reg.foreground.size > 0 && (command === "/bg-on" || command === "/bg-off")) {
      setAutoBackgroundEnabled(command === "/bg-on", ctx);
      return { action: "handled" };
    }
    // Only intercept when a foreground command is actively running or the mode
    // is enabled. In off mode, user input must not trigger cooperative steering.
    if (!autoBackgroundEnabled || reg.foreground.size === 0) return { action: "continue" };
    // Move the most-recent running command to the background...
    backgroundMostRecentForeground();
    // ...abort the current turn so the bash tool returns its "backgrounded" result...
    try {
      ctx.abort?.();
    } catch {
      /* no active operation to abort */
    }
    // ...and re-deliver the user's message as a fresh follow-up turn.
    try {
      // Re-deliver text AND any images the user pasted (InputEvent.images
      // would otherwise be silently dropped; sendUserMessage accepts an
      // (TextContent | ImageContent)[] content array).
      const content = event.images?.length
        ? [{ type: "text", text: event.text }, ...event.images]
        : event.text;
      pi.sendUserMessage(content, { deliverAs: "followUp" });
    } catch {
      /* session may have ended between abort and resubmit */
    }
    return { action: "handled" }; // we took the input; don't let pi process it normally
  });
}

// ---------- slash commands ----------

function setAutoBackgroundEnabled(enabled: boolean, ctx: ExtensionContext): void {
  autoBackgroundEnabled = enabled;
  if (!enabled) clearHint(ctx);
  if (ctx.hasUI) {
    ctx.ui.notify(
      enabled
        ? "Automatic backgrounding enabled."
        : "Automatic backgrounding disabled. Explicit run_in_background remains available.",
      "info",
    );
  }
}

function registerCommands(pi: ExtensionAPI): void {
  pi.registerCommand("bg", {
    description: "List background bash jobs and show whether automatic backgrounding is enabled.",
    async handler(_args, ctx) {
      if (ctx.hasUI) {
        ctx.ui.notify(`${autoBackgroundEnabled ? "Automatic backgrounding is ON." : "Automatic backgrounding is OFF."}\n\n${formatList()}`, "info");
      }
    },
  });
  pi.registerCommand("bg-on", {
    description: "Enable automatic backgrounding and cooperative steering (the default).",
    async handler(_args, ctx) {
      setAutoBackgroundEnabled(true, ctx);
    },
  });
  pi.registerCommand("bg-off", {
    description: "Disable automatic backgrounding and cooperative steering; explicit run_in_background remains available.",
    async handler(_args, ctx) {
      setAutoBackgroundEnabled(false, ctx);
    },
  });
  pi.registerCommand("bg-stop", {
    description: "Kill ALL running background bash jobs.",
    async handler(_args, ctx) {
      let n = 0;
      for (const job of reg.jobs.values()) {
        if (job.status === "running") {
          job.outputConsumed = true;
          killProcessTree(job.pid, "SIGTERM");
          n++;
        }
      }
      if (ctx.hasUI) ctx.ui.notify(n ? `Killed ${n} running job(s).` : "No running background jobs.", "info");
    },
  });
  pi.registerCommand("bg-clear", {
    description: "Forget finished/failed background jobs and free their in-memory output rings.",
    async handler(_args, ctx) {
      let n = 0;
      for (const [jid, j] of reg.jobs) {
        if (j.status !== "running") {
          reg.jobs.delete(jid);
          n++;
        }
      }
      if (ctx.hasUI) ctx.ui.notify(n ? `Cleared ${n} finished job(s).` : "No finished jobs to clear.", "info");
    },
  });
}

// ---------- lifecycle ----------

function registerLifecycle(pi: ExtensionAPI): void {
  pi.on("session_shutdown", async () => {
    // SIGTERM every still-running job and start each escalation race. The race
    // (see escalateKill) resolves on natural exit, or SIGKILL after the grace so
    // a SIGTERM-trapping detached job can't orphan. Clearing the registry
    // synchronously keeps shutdown observably complete for callers that don't
    // await the handler (the test harness); the trailing await is what makes
    // real pi — which awaits session_shutdown handlers — hold long enough for
    // the SIGKILL escalation to fire before the loop drains. Rings are GC'd with
    // their job entries, so there's nothing to sweep on disk.
    const kills: Promise<void>[] = [];
    for (const job of reg.jobs.values()) {
      if (job.status === "running") {
        job.outputConsumed = true; // suppress a teardown notification
        try {
          killProcessTree(job.pid, "SIGTERM");
        } catch {
          /* already gone */
        }
        kills.push(escalateKill(job));
      }
    }
    reg.jobs.clear();
    reg.foreground.clear();
    if (kills.length) await Promise.all(kills);
  });
}

// ---------- entry ----------

export default function bgBash(pi: ExtensionAPI): void {
  autoBackgroundEnabled = true;
  registerLifecycle(pi);
  registerShortcuts(pi);
  registerCooperativeSteering(pi);
  registerCommands(pi);
  pi.registerTool(makeBashTool(pi));
  pi.registerTool(makeJobsTool(pi));
}