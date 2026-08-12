/**
 * bg-bash.eval.ts — end-to-end delivery-semantics evals for the bg-bash extension.
 *
 * Where test.mjs drives the extension through jiti against a stub ExtensionAPI
 * (fast, offline, deterministic), this suite drives a REAL AgentSession: the
 * extension is loaded into an isolated temp project, background jobs are
 * launched through the real `bash` tool, and we assert on the live transcript —
 * the delivery behaviors a stub cannot see:
 *
 *   BG-27  the loaded bash tool carries the "you'll be notified" contract
 *   BG-08  an idle completion wakes a NEW turn on its own (no second prompt)
 *   BG-09  a mid-turn completion queues passively and never interrupts
 *   BG-10  reading a job's output suppresses its completion wake (#18544 wall)
 *   (obs)  N jobs finishing while idle -> how many wake turns actually happen
 *          (observed 2025-06: 2 jobs -> 1 wake turn: idle coalescing is real)
 *
 * Run (model-backed — costs tokens; NOT part of the extension's runtime surface):
 *   cd eval && npm install && PI_PROVIDER=opencode-go PI_MODEL=deepseek-v4-flash npx vitest run
 *   (provider/model also read from the environment)
 */
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const CUSTOM_TYPE = "bg-job-finished";
const EXT_SRC_PATH = fileURLToPath(new URL("../index.ts", import.meta.url));
const EXT_SRC = readFileSync(EXT_SRC_PATH, "utf8");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- locate the pi install (mirror of test.mjs) ---------------------------
function findPiInstall(): string {
  if (process.env.PI_INSTALL) return process.env.PI_INSTALL;
  try {
    const r = createRequire(import.meta.url);
    return r.resolve("@earendil-works/pi-coding-agent/package.json").replace(/[\\/]package\.json$/, "");
  } catch {}
  try {
    const which = spawnSync("sh", ["-c", "command -v pi || which pi"], { encoding: "utf8" });
    const bin = which.stdout.trim();
    if (bin) {
      const real = spawnSync("readlink", ["-f", bin], { encoding: "utf8" }).stdout.trim();
      const m = real.match(/^(.*\/lib\/node_modules\/@earendil\-works\/pi\-coding\-agent)/);
      if (m) return m[1];
    }
  } catch {}
  const fallback =
    "/home/will/.local/share/mise/installs/npm-earendil-works-pi-coding-agent/0.80.3/lib/node_modules/@earendil-works/pi-coding-agent";
  if (require("node:fs").existsSync(fallback)) return fallback;
  throw new Error("Could not locate the pi install. Set PI_INSTALL to the pi-coding-agent package dir.");
}

let _pi: any;
async function pi(): Promise<any> {
  if (!_pi) {
    const url = pathToFileURL(join(findPiInstall(), "dist/index.js")).href;
    _pi = await import(/* @vite-ignore */ url);
  }
  return _pi;
}

// ---- create an isolated session with the extension loaded -----------------
async function newSession() {
  const { ModelRuntime, SettingsManager, SessionManager, createAgentSessionServices, createAgentSessionFromServices } = await pi();
  const provider = process.env.PI_PROVIDER?.trim();
  const modelId = process.env.PI_MODEL?.trim();
  if (!provider || !modelId)
    throw new Error("set PI_PROVIDER and PI_MODEL (e.g. opencode-go / deepseek-v4-flash)");
  const runtime = await ModelRuntime.create();
  const model = runtime.getModel(provider, modelId);
  if (!model) throw new Error(`model not found: ${provider}/${modelId}`);

  const root = await mkdtemp(join(tmpdir(), "bg-eval-"));
  const cwd = join(root, "workspace");
  const agentDir = join(root, "agent");
  await Promise.all([mkdir(cwd, { recursive: true }), mkdir(agentDir, { recursive: true })]);

  const services = await createAgentSessionServices({
    cwd,
    agentDir,
    modelRuntime: runtime,
    settingsManager: SettingsManager.inMemory(),
  });
  const sessionManager = SessionManager.create(cwd, join(root, "sessions"));
  const { session } = await createAgentSessionFromServices({
    services,
    sessionManager,
    model,
    thinkingLevel: "off",
  });

  // Seed the extension into the project's .pi/extensions dir, then reload so
  // the resource loader picks it up (same mechanism as packages/evals' hello.ts).
  const extDir = join(cwd, ".pi", "extensions", "bg-bash");
  await mkdir(extDir, { recursive: true });
  await writeFile(join(extDir, "index.ts"), EXT_SRC);
  await session.reload();

  return {
    session,
    cleanup: async () => {
      try {
        session.dispose();
      } catch {}
      // give any straggler async extension handlers (job exit -> sendMessage) a
      // beat to settle before the temp dir is removed, to avoid stale-ctx noise
      await sleep(400);
      await rm(root, { recursive: true, force: true });
    },
  };
}

// ---- transcript helpers ----------------------------------------------------
function textOf(m: any): string {
  if (typeof m.content === "string") return m.content;
  return (m.content ?? [])
    .filter((p: any) => p.type === "text" || typeof p.text === "string")
    .map((p: any) => p.text ?? "")
    .join("\n");
}

function customMsgs(session: any) {
  return session.messages.filter((m: any) => m.role === "custom" && m.customType === CUSTOM_TYPE);
}

function firstAssistantText(session: any, fromIdx = 0): string | null {
  for (let i = fromIdx; i < session.messages.length; i++) {
    if (session.messages[i].role === "assistant" && textOf(session.messages[i]).trim().length > 0)
      return textOf(session.messages[i]);
  }
  return null;
}

// last non-empty assistant text strictly after the given message index
function assistantAfter(session: any, idx: number): string | null {
  for (let i = session.messages.length - 1; i > idx; i--) {
    if (session.messages[i].role === "assistant") {
      const t = textOf(session.messages[i]);
      if (t.trim().length > 0) return t;
    }
  }
  return null;
}

async function waitFor<T>(fn: () => T | null | undefined, timeoutMs: number, stepMs = 250): Promise<T | null> {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v !== null && v !== undefined) return v;
    if (Date.now() - start > timeoutMs) return null;
    await sleep(stepMs);
  }
}

function dump(session: any): string {
  return session.messages
    .map((m: any, i: number) => {
      const head = `${i} [${m.role}${m.customType ? ":" + m.customType : ""}]`;
      if (m.role === "custom") return head;
      const t = textOf(m).slice(0, 160).replace(/\n/g, "⏎");
      return `${head} ${t}`;
    })
    .join("\n");
}

// ---- the evals -------------------------------------------------------------
describe("bg-bash delivery semantics (real AgentSession)", () => {
  it("BG-27: the loaded bash tool carries the run_in_background + you'll-be-notified contract", async () => {
    const { session, cleanup } = await newSession();
    try {
      const tools = session.getActiveToolNames();
      expect(tools).toContain("bash");
      expect(tools).toContain("jobs");

      const bashDef = session.getAllTools().find((t: any) => t.name === "bash");
      expect(bashDef, `no bash tool def in: ${tools.join(", ")}`).toBeTruthy();
      expect(bashDef.description).toMatch(/notified/i);
      expect(bashDef.description).toMatch(/run_in_background/i);
      const props = bashDef.parameters?.properties ?? {};
      expect(Object.keys(props)).toContain("run_in_background");
    } finally {
      await cleanup();
    }
  });

  it("BG-08: an idle completion wakes a NEW turn with the notification (no second prompt)", async () => {
    const { session, cleanup } = await newSession();
    try {
      const preLen = session.messages.length;
      await session.prompt(
        "Use the bash tool with run_in_background: true to launch the command `sleep 9 && echo BG-WAKE`. " +
          "Do not wait for it, do not poll it, and do not check the jobs tool. End your turn now; reply with only the job id.",
      );
      // job (9s) outlives the launch turn -> completes while idle -> should wake on its own
      const wakeMsg = await waitFor(
        () => customMsgs(session)[customMsgs(session).length - 1] ?? null,
        45_000,
      );
      expect(wakeMsg, `no bg-job-finished delivered; transcript:\n${dump(session)}`).toBeTruthy();
      // the notification content is the deterministic contract (not the model's paraphrase)
      expect(textOf(wakeMsg)).toMatch(/exit 0/);
      expect(textOf(wakeMsg)).toMatch(/BG-WAKE/);

      const wakeIdx = session.messages.indexOf(wakeMsg);
      const wakeReply = await waitFor(() => assistantAfter(session, wakeIdx), 45_000);
      expect(wakeReply, `wake message delivered but no assistant turn followed:\n${dump(session)}`).toBeTruthy();
    } finally {
      await cleanup();
    }
  });

  it("BG-09: a mid-turn completion queues passively and never interrupts the in-progress turn", async () => {
    const { session, cleanup } = await newSession();
    try {
      const preLen = session.messages.length;
      await session.prompt(
        "Use the bash tool with run_in_background: true to launch `sleep 1 && echo BG-MID` and do NOT wait for it. " +
          "Then immediately use the bash tool to run `sleep 2; echo FG-DONE` and reply with exactly the output of that second command.",
      );
      // Turn B: the fg `sleep 2` call; the bg job (1s) completes mid-turn.
      const turnB = firstAssistantText(session, preLen);
      expect(turnB, `no assistant reply; transcript:\n${dump(session)}`).toBeTruthy();
      expect(turnB).toContain("FG-DONE");
      expect(turnB).not.toContain("BG-MID"); // not interrupted mid-turn

      // ...and the queued notification still gets delivered afterwards (own turn)
      const wakeMsg = await waitFor(
        () => customMsgs(session)[customMsgs(session).length - 1] ?? null,
        45_000,
      );
      expect(wakeMsg, `no queued delivery after turn B; transcript:\n${dump(session)}`).toBeTruthy();
      expect(textOf(wakeMsg)).toMatch(/exit 0/);
      expect(textOf(wakeMsg)).toContain("BG-MID");
      const wakeIdx = session.messages.indexOf(wakeMsg);
      const turnC = await waitFor(() => assistantAfter(session, wakeIdx), 45_000);
      expect(turnC).toBeTruthy();
    } finally {
      await cleanup();
    }
  });

  it("BG-10: reading a job's output suppresses its completion wake (no bg-job-finished)", async () => {
    const { session, cleanup } = await newSession();
    try {
      await session.prompt(
        "Use the bash tool with run_in_background: true to launch `sleep 12 && echo BG-SILENT`. " +
          "Then immediately use the jobs tool with action 'output' and the returned job id to read its output. " +
          "Do not wait for the job, do not poll, and do not check jobs list. End your turn.",
      );
      // the job completes at ~12s; the earlier read must suppress the completion wake
      // (the #18544 notification-wall guard: don't tell the agent what it already read)
      await waitFor(() => (customMsgs(session).length > 0 ? "x" : null), 22_000);
      expect(customMsgs(session).length, `expected NO bg-job-finished after reading output; transcript:\n${dump(session)}`).toBe(0);
    } finally {
      await cleanup();
    }
  });

  it("coalescing: two jobs finishing while idle (observational — logs wake-turn count)", async () => {
    const { session, cleanup } = await newSession();
    try {
      await session.prompt(
        "Use the bash tool with run_in_background: true to launch BOTH of these as two separate commands, one after the other: " +
          "`sleep 6 && echo JOB-ALPHA` and `sleep 7 && echo JOB-BETA`. " +
          "Do not wait for either, do not poll, do not check the jobs tool. End your turn; reply with the two job ids.",
      );
      const gotAll = await waitFor(() => {
        const texts = customMsgs(session).map((m: any) => textOf(m)).join("\n");
        return texts.includes("JOB-ALPHA") && texts.includes("JOB-BETA") ? texts : null;
      }, 60_000);
      expect(gotAll, `not both delivered; transcript:\n${dump(session)}`).toBeTruthy();

      const cmIdxs = customMsgs(session).map((m: any) => session.messages.indexOf(m));
      const firstCm = Math.min(...cmIdxs);
      const wakeTurns = session.messages
        .slice(firstCm + 1)
        .filter((m: any) => m.role === "assistant").length;
      console.log(
        `[coalescing] ${customMsgs(session).length} bg-job-finished messages, ${wakeTurns} assistant turn(s) after the first completion`,
      );
      expect(wakeTurns).toBeGreaterThan(0);
      expect(wakeTurns, "each completion woke its own turn — no coalescing observed").toBeLessThanOrEqual(2);
      // observed 2025: 2 jobs -> 2 bg-job-finished messages -> 1 assistant turn (idle coalescing)
    } finally {
      await cleanup();
    }
  });
});
