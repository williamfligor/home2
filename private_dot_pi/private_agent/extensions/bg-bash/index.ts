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
 *   - Background log is TAIL-ROTATED at PI_BG_MAX_LOG_MB (default 50 MB): the
 *     process keeps running, the on-disk log is kept to the last N MB, and the
 *     model only ever sees a bounded tail. No process kill for being chatty —
 *     a long-running dev server that logs 200 MB over an hour should stay up.
 *     (This mirrors the built-in bash tool's cap-on-read philosophy, extended to
 *     background logs.)
 *   - On session shutdown: running jobs are SIGTERM'd (process group) and all
 *     log files are swept.
 *
 * Slash commands: /bg (list), /bg-stop (kill all running), /bg-clear (forget
 * finished jobs + reclaim their logs).
 *
 * Verified against pi 0.80.3. No external deps; no tmux; no native addons.
 *   pi -e <path-to>/bg-bash.ts
 *   # or drop into ~/.pi/agent/extensions/bg-bash.ts for auto-discovery
 *
 * Design + survey: BACKGROUND.md. Test suite: TESTCASES.md.
 */

import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { KeyId, Text as TextComponent } from "@earendil-works/pi-tui";
import { Text } from "@earendil-works/pi-tui";
import { Type, type Static } from "typebox";
import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdirSync, statSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

// ---------- configuration ----------

const DEFAULT_TIMEOUT_MS = Number(process.env.PI_BG_TIMEOUT_MS ?? 30_000); // auto-background threshold
const QUICK_COMPLETION_MS = 2_000; // skip all machinery if it finishes this fast
const POLL_INTERVAL_MS = 250; // live-output poll interval
const OUTPUT_PREVIEW_CHARS = 20_000; // how much we tail into the model result / UI
const MAX_LOG_BYTES = Number(process.env.PI_BG_MAX_LOG_MB ?? 50) * 1024 * 1024; // tail-rotate cap per job
const LOG_DIR = join(tmpdir(), "pi-bg-bash");
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
  logPath: string;
  log: PumpLog;
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

// ---------- bounded, tail-rotating log ----------
//
// Spawn pipes stdout+stderr into this pump (not a file fd) so JS can rotate:
// once the on-disk log reaches MAX_LOG_BYTES the stream is reopened with 'w'
// (which truncates), keeping only the most recent segment. Disk per job is
// bounded at ~MAX_LOG_BYTES; the model only ever reads a short tail. The
// process is never killed for being chatty.

class PumpLog extends EventEmitter {
  readonly path: string;
  private readonly cap: number;
  private stream: WriteStream;
  private bytesThisFile = 0;
  private rotating = false;

  constructor(path: string, cap: number) {
    super();
    this.path = path;
    this.cap = cap;
    mkdirSync(dirname(path), { recursive: true });
    this.stream = createWriteStream(path);
    this.stream.on("error", () => {
      /* best-effort; log failures must not crash the extension */
    });
    // Re-emit the current stream's drain so spawnPiped can resume a paused
    // producer when the writable has room again (backpressure bridge).
    this.stream.on("drain", () => this.emit("drain"));
  }

  /** Returns the writable's backpressure signal; `false` means "pause the producer". */
  write(chunk: Buffer): boolean {
    if (this.rotating) return true; // dropping during the truncate window; don't stall the producer
    if (this.stream.destroyed) {
      // Underlying stream died (e.g. disk error mid-flush). Reopen fresh so we
      // keep writing what we can rather than stalling or dropping forever.
      this.reopen();
      this.emit("drain"); // unblock a producer paused by the dead stream
    }
    let ok = true;
    try {
      ok = this.stream.write(chunk);
    } catch {
      /* stream closed underneath us; drop without stalling */
    }
    this.bytesThisFile += chunk.length;
    if (this.bytesThisFile >= this.cap) this.rotate();
    return ok;
  }

  private reopen(): void {
    try {
      this.stream = createWriteStream(this.path);
    } catch {
      return;
    }
    this.stream.on("error", () => {});
    this.stream.on("drain", () => this.emit("drain"));
    this.bytesThisFile = 0;
    this.rotating = false;
  }

  private rotate(): void {
    if (this.rotating) return;
    if (this.stream.destroyed) {
      // Stream already dead; nothing left to flush — swap immediately instead
      // of waiting for a finish/error event that will never fire.
      this.reopen();
      this.emit("drain");
      return;
    }
    this.rotating = true;
    const old = this.stream;
    // 'w' truncates on open. End the old stream, then reopen the same path
    // once it has fully flushed. Path stays constant so readers always hit the
    // live segment. Both `finish` and `error` reset the pump — a stream that
    // errors mid-flush (e.g. disk full) must not leave `rotating` stuck true,
    // which would silently drop every subsequent chunk for the job's life.
    const onOldDone = () => {
      old.removeListener("finish", onOldDone);
      old.removeListener("error", onOldDone);
      this.reopen();
      this.emit("drain"); // fresh empty stream: unblock any paused producer
    };
    old.once("finish", onOldDone);
    old.once("error", onOldDone);
    old.end();
  }

  close(): void {
    try {
      this.stream.end();
    } catch {
      /* ignore */
    }
  }
}

// ---------- helpers ----------

function nextJobId(): string {
  return `b${randomBytes(4).toString("hex")}`;
}

function logPathFor(id: string): string {
  return join(LOG_DIR, `${id}.log`);
}

function text(s: string): { type: "text"; text: string } {
  return { type: "text", text: s };
}

function spawnPiped(args: {
  command: string;
  cwd: string;
  id: string;
  cap: number;
}): { pid: number; log: PumpLog; exit: Job["exit"]; child: ChildProcess } {
  const log = new PumpLog(logPathFor(args.id), args.cap);
  const child = spawn("bash", ["-c", args.command], {
    cwd: args.cwd,
    detached: true, // new process group/session — survives independently, killable as -pid
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  });
  // Synchronous spawn failure (e.g. shell missing): surface as a normal tool
  // error instead of registering an un-killable pid:undefined job.
  if (child.pid == null) {
    log.close();
    throw new Error(`Failed to spawn bash: ${args.command}`);
  }
  child.stdout?.on("data", (d: Buffer) => {
    if (!log.write(d)) {
      child.stdout?.pause();
      log.once("drain", () => child.stdout?.resume());
    }
  });
  child.stderr?.on("data", (d: Buffer) => {
    if (!log.write(d)) {
      child.stderr?.pause();
      log.once("drain", () => child.stderr?.resume());
    }
  });

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
      log.close();
      resolve({ code: code ?? null, signal: signal ?? null });
    });
  });
  // NOTE: deliberately NOT unref'd here. A foreground call must hold the Node
  // event loop — with an unref'd child (which also unrefs its stdio pipes), a
  // bare-node embedding drains the loop and exits mid-command (observed on
  // `sleep 1` inside the 2s quick window; real pi hides this because the TUI
  // keeps the loop busy). Background jobs are unref'd at promote/spawn-bg so
  // they never keep the process alive.
  return { pid: child.pid, log, exit, child };
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

/** Tail the log file to a bounded string (drops a partial first line when truncated). */
function readTail(path: string, maxBytes = OUTPUT_PREVIEW_CHARS): string {
  try {
    const size = statSync(path).size;
    if (size === 0) return "";
    const len = Math.min(size, maxBytes);
    const start = size - len;
    const buf = Buffer.alloc(len);
    // openSync/readSync/closeSync kept local to avoid importing sync fs helpers
    // we already don't use elsewhere.
    const { openSync, readSync, closeSync } = require("node:fs");
    const fd = openSync(path, "r");
    readSync(fd, buf, 0, len, start);
    closeSync(fd);
    let s = buf.toString("utf8");
    if (start > 0) {
      const nl = s.indexOf("\n");
      s = "…[ truncated ]\n" + (nl >= 0 ? s.slice(nl + 1) : s);
    }
    return s;
  } catch {
    // file may be momentarily absent during rotation
    return "";
  }
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

/** Poll the log and push growing tails as partial tool results (live output box). */
function streamLog(
  logPath: string,
  onUpdate: ((p: { content: { type: "text"; text: string }[]; details: undefined }) => void) | undefined,
): { stop: () => void } {
  let size = 0;
  let stopped = false;
  const tick = () => {
    if (stopped) return;
    try {
      const s = statSync(logPath);
      if (s.size !== size) {
        size = s.size;
        onUpdate?.({ content: [text(readTail(logPath))], details: undefined });
      }
    } catch {
      /* file may be briefly absent during rotation */
    }
  };
  const handle = setInterval(tick, POLL_INTERVAL_MS);
  handle.unref();
  return {
    stop: () => {
      stopped = true;
      clearInterval(handle);
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

    const tail = readTail(args.job.logPath);
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
      )}.\nCommand: ${args.job.command}\nOutput: ${args.job.logPath}` +
      (tail ? `\n\n----\n${tail}` : "");
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

function makeBashTool(_pi: ExtensionAPI): ToolDefinition<typeof bashSchema, undefined> {
  return {
    name: "bash",
    label: "bash",
    description:
      "Run a bash command. Commands that run longer than the timeout (default 30s) are automatically moved to the background and this tool returns immediately with a job id; the agent is notified when they finish. Set run_in_background=true to start in the background right away. Check / inspect / stop background jobs with the `jobs` tool.",
    promptSnippet:
      "Run shell commands; long-running commands auto-background after ~30s — use jobs to inspect/stop them; avoid `sleep` to wait",
    promptGuidelines: [
      "Prefer run_in_background:true for commands expected to be long-running (dev servers, watchers, test suites, builds).",
      "After a command auto-backgrounds, continue with independent useful work — do NOT call sleep or poll jobs merely to wait; you will be notified when it finishes. Use jobs action='output' to inspect, jobs action='kill' to stop.",
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
        timeoutMs: params.timeout ? params.timeout * 1000 : DEFAULT_TIMEOUT_MS,
        signal,
        onUpdate,
        ctx,
        pi: _pi,
      });
    },
  };
}

function spawnBackground(args: {
  toolCallId: string;
  command: string;
  name?: string;
  ctx: ExtensionContext;
  pi: ExtensionAPI;
}) {
  const id = nextJobId();
  const { pid, log, exit, child } = spawnPiped({ command: args.command, cwd: args.ctx.cwd, id, cap: MAX_LOG_BYTES });
  child.unref(); // run_in_background: spawned straight to background
  void child; // retained on the Job for potential introspection; kill uses pid via killProcessTree
  const job: Job = {
    id,
    name: args.name,
    command: args.command,
    pid,
    logPath: log.path,
    log,
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
        `Command running in background with ID: ${id}.${args.name ? ` Name: ${args.name}.` : ""}\nOutput is being written to: ${log.path}`,
      ),
    ],
    details: undefined,
  };
}

async function runForeground(args: {
  toolCallId: string;
  command: string;
  timeoutMs: number;
  signal: AbortSignal | undefined;
  onUpdate: ((p: { content: { type: "text"; text: string }[]; details: undefined }) => void) | undefined;
  ctx: ExtensionContext;
  pi: ExtensionAPI;
}) {
  const { toolCallId, command, timeoutMs, signal, onUpdate, ctx, pi } = args;
  const id = nextJobId();

  const { pid, log, exit, child } = spawnPiped({ command, cwd: ctx.cwd, id, cap: MAX_LOG_BYTES });

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
    logPath: log.path,
    log,
    status: "running",
    exitCode: null,
    startedAt: Date.now(),
    isBackground: false,
    outputConsumed: false,
    exit,
  };
  reg.jobs.set(id, job);

  // Auto-background timer. unref so it never keeps the process alive on its own.
  const timeoutTimer = setTimeout(() => {
    if (!reg.foreground.has(toolCallId)) return; // already finished/backgrounded
    requestPause("timeout");
  }, timeoutMs);
  timeoutTimer.unref();

  let progressPoller: { stop: () => void } | undefined;
  let hintShown = false;

  const cleanup = () => {
    progressPoller?.stop();
    clearTimeout(timeoutTimer);
    if (signal) signal.removeEventListener("abort", onAbort);
  };

  const finishForeground = (r: ExitResult, output: string) => {
    // A spawn error (bash never exec'd) is a tool error, not a clean result.
    // Any non-zero foreground exit is a tool error (a script can `exit 137`;
    // we don't guess signal deaths from the 128+signum convention). Signal
    // death (code null) — e.g. an Esc cancel — returns the partial output.
    if (r.spawnError) throw new Error(`Failed to spawn bash: ${r.spawnError.message}`);
    if (r.code !== null && r.code !== 0) throw new Error(output || `Command exited with code ${r.code}`);
    return { content: [text(output || "(no output)")], details: undefined };
  };
  const reapForegroundJob = () => {
    reg.jobs.delete(id);
    try { log.close(); const { unlinkSync } = require("node:fs"); unlinkSync(log.path); } catch { /* best-effort */ }
  };

  const promoteToBackground = (reason: "manual" | "timeout") => {
    if (handedToBackground) return;
    handedToBackground = true;
    child.unref(); // background jobs must not hold the process alive
    reg.foreground.delete(toolCallId);
    job.isBackground = true;
    startBackgroundWatcher({ job, ctx, pi });
    if (reason === "timeout" && ctx.hasUI) {
      ctx.ui.notify(`▶ ${id} auto-backgrounded after ${Math.round(timeoutMs / 1000)}s`, "info");
    }
  };

  try {
    // Quick completion window: skip the whole backgrounding dance for fast
    // commands. The pause promise is in this race too, so a timeout or manual
    // background request that arrives during the quick window is honored
    // immediately (matters when `timeout` is set below QUICK_COMPLETION_MS —
    // the §12.4 latent bug).
    const quick = await Promise.race<{ kind: "completed"; r: ExitResult } | null | "paused">([
      exit.then((r) => ({ kind: "completed" as const, r })),
      new Promise<null>((r) => {
        const t = setTimeout(() => r(null), QUICK_COMPLETION_MS);
        t.unref();
      }),
      pausePromise.then(() => "paused" as const),
    ]);
    if (quick !== null && quick !== "paused") {
      // Finished fast: read the output BEFORE unlinking the log (order matters).
      const output = readTail(log.path);
      reapForegroundJob();
      return finishForeground(quick.r, output);
    }

    // Still running past the quick window: stream live output + show the hint.
    progressPoller = streamLog(log.path, onUpdate);
    showHint(ctx);
    hintShown = true;

    // Race: natural completion vs backgrounding (manual or timeout).
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
          ? ` (auto-backgrounded after ${Math.round(timeoutMs / 1000)}s; still running — use jobs action='output' id='${id}' to check)`
          : "";
      return {
        content: [
          text(`Process backgrounded as ${id}${suffix}\nCommand: ${command}\nPID: ${pid}\nOutput: ${log.path}`),
        ],
        details: undefined,
      };
    }
    // Completed in the foreground (past the quick window): read output, then drop the job + log.
    const output = readTail(log.path);
    reapForegroundJob();
    return finishForeground(race.r, output);
  } finally {
    cleanup();
    if (hintShown) clearHint(ctx);
    reg.foreground.delete(toolCallId);
    if (!handedToBackground) {
      // Genuinely cancelled in the foreground: log already unlinked above when
      // finishing; nothing more to do. The job entry was dropped on finish.
    }
  }
}

// ---------- the jobs tool (list / output / kill) ----------

function makeJobsTool(_pi: ExtensionAPI): ToolDefinition<typeof jobsSchema, undefined> {
  return {
    name: "jobs",
    label: "Background Jobs",
    description:
      "Manage background bash jobs started by the bash tool. Actions: 'list' (all jobs with status/pid/duration/command), 'output' (tail a job's log, bounded by maxBytes), 'kill' (terminate a running job's whole process group). Use /bg-clear to forget finished jobs and reclaim their logs.",
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
        job.outputConsumed = true; // suppress redundant completion notice later
        return { content: [text(readTail(job.logPath, params.maxBytes) || "(no output yet)")], details: undefined };
      }
      if (action === "kill") {
        if (!job) throw new Error(`Unknown job: ${id}`);
        if (job.status !== "running") throw new Error(`Job ${job.id} is ${job.status}, not running.`);
        job.outputConsumed = true;
        killProcessTree(job.pid, "SIGTERM");
        return { content: [text(`Killed ${job.id}. Output kept at ${job.logPath}`)], details: undefined };
      }
      throw new Error(`Unknown jobs action: ${action}`);
    },
    renderCall(args) {
      return new Text(`jobs ${args.action ?? ""}${args.id ? ` ${args.id}` : ""}`, 0, 0) as TextComponent;
    },
    renderResult(result) {
      const t = result.content?.map((c) => ("text" in c ? c.text : "")).join("\n") ?? "";
      return new Text(t, 0, 0) as TextComponent;
    },
  };
}

// ---------- shortcuts + cooperative steering ----------

function backgroundMostRecentForeground(): boolean {
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
    // Only intercept when a foreground command is actively running.
    if (reg.foreground.size === 0) return { action: "continue" };
    // Don't hijack messages we (or other extensions) injected ourselves.
    if (event.source === "extension") return { action: "continue" };

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
      pi.sendUserMessage(event.text, { deliverAs: "followUp" });
    } catch {
      /* session may have ended between abort and resubmit */
    }
    return { action: "handled" }; // we took the input; don't let pi process it normally
  });
}

// ---------- slash commands ----------

function registerCommands(pi: ExtensionAPI): void {
  pi.registerCommand("bg", {
    description: "List background bash jobs (alias for `jobs action='list'`).",
    async handler(_args, ctx) {
      if (ctx.hasUI) ctx.ui.notify(formatList(), "info");
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
    description: "Forget finished/failed background jobs and reclaim their log files.",
    async handler(_args, ctx) {
      const { unlinkSync } = require("node:fs");
      let n = 0;
      for (const [jid, j] of reg.jobs) {
        if (j.status !== "running") {
          try {
            j.log.close();
            unlinkSync(j.logPath);
          } catch {
            /* best-effort */
          }
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
  pi.on("session_start", () => {
    mkdirSync(LOG_DIR, { recursive: true });
  });

  pi.on("session_shutdown", () => {
    const { unlinkSync } = require("node:fs");
    // Kill any still-running background jobs (process group) and sweep ALL log
    // files so $TMPDIR/pi-bg-bash doesn't accumulate across sessions.
    for (const job of reg.jobs.values()) {
      if (job.status === "running") {
        job.outputConsumed = true; // suppress a teardown notification
        const pid = job.pid;
        try {
          killProcessTree(pid, "SIGTERM");
        } catch {
          /* ignore */
        }
        // Escalate to SIGKILL after a short grace so a job that traps/ignores
        // SIGTERM (e.g. a dev server doing graceful shutdown) can't outlive
        // the session as a detached orphan. unref'd: fires as long as the loop
        // is still alive (TUI case); well-behaved TERM'd jobs are already gone.
        const escalate = setTimeout(() => {
          try {
            killProcessTree(pid, "SIGKILL");
          } catch {
            /* already dead */
          }
        }, SHUTDOWN_GRACE_MS);
        escalate.unref();
      }
      try {
        job.log.close();
        unlinkSync(job.logPath);
      } catch {
        /* ignore */
      }
    }
    reg.jobs.clear();
    reg.foreground.clear();
  });
}

// ---------- entry ----------

export default function bgBash(pi: ExtensionAPI): void {
  registerLifecycle(pi);
  registerShortcuts(pi);
  registerCooperativeSteering(pi);
  registerCommands(pi);
  pi.registerTool(makeBashTool(pi));
  pi.registerTool(makeJobsTool(pi));
}