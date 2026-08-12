#!/usr/bin/env node
// Runnable smoke test for the bg-bash extension.
//   node private_dot_pi/private_agent/extensions/bg-bash/test.mjs
//   PI_BG_MAX_LOG_MB=1 node .../test.mjs --rotate   (internal: isolated rotation check)
//
// Auto-discovers the pi install from (in order): the PI_INSTALL env var,
// require.resolve of the package, or `which pi`. Tail-rotate runs in a child
// process because the module-level MAX_LOG_BYTES reads PI_BG_MAX_LOG_MB at
// load and jiti caches modules by path — so we cannot reload with a smaller
// cap in the same process that already loaded at the default.
//
// This is a dev-only fixture: it loads the extension through jiti (pi's own
// loader) against a stub ExtensionAPI and asserts the load-bearing invariants
// a regression would break. It is NOT part of the agent's runtime surface.

import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL("./", import.meta.url));
const EXT = HERE + "index.ts";
const LOG_DIR = "/tmp/pi-bg-bash";

// ---- locate the pi install ------------------------------------------------
// Resolve via: PI_INSTALL env -> require.resolve of the package -> `which pi`
// symlink -> a hardcoded mise fallback. Returns the package's dist dir.
function findPiInstall() {
  if (process.env.PI_INSTALL && existsSync(process.env.PI_INSTALL)) return process.env.PI_INSTALL;
  try {
    const r = createRequire(import.meta.url);
    const pkgJsonPath = r.resolve("@earendil-works/pi-coding-agent/package.json");
    // <dir>/package.json -> <dir>
    return pkgJsonPath.replace(/[\\/]package\.json$/, "");
  } catch {}
  try {
    const which = spawnSync("sh", ["-c", "command -v pi || which pi"], { encoding: "utf8" });
    const bin = which.stdout.trim();
    if (bin) {
      const real = spawnSync("readlink", ["-f", bin], { encoding: "utf8" }).stdout.trim();
      // mise installs put pi at .../installs/npm-.../lib/node_modules/@earendil-works/pi-coding-agent
      const m = real.match(/^(.*\/lib\/node_modules\/@earendil\-works\/pi\-coding\-agent)/);
      if (m && existsSync(m[1])) return m[1];
    }
  } catch {}
  const fallback = "/home/will/.local/share/mise/installs/npm-earendil-works-pi-coding-agent/0.80.3/lib/node_modules/@earendil-works/pi-coding-agent";
  if (existsSync(fallback)) return fallback;
  throw new Error("Could not locate the pi install. Set PI_INSTALL to its lib/node_modules/@earendil-works/pi-coding-agent path.");
}

const PI = await findPiInstall();
const alias = {
  "@earendil-works/pi-coding-agent": `${PI}/dist/index.js`,
  "@earendil-works/pi-tui": `${PI}/node_modules/@earendil-works/pi-tui/dist/index.js`,
  typebox: `${PI}/node_modules/typebox/build/index.mjs`,
};

// jiti ships as a pi dependency (pi's own extension loader), so resolve it
// out of the pi install rather than requiring a separate `npm install`.
const { createJiti } = await import(
  createRequire(import.meta.url).resolve("jiti", { paths: [`${PI}/node_modules`, PI] }),
);

// ---- isolated rotation run ------------------------------------------------
// Invoked as: PI_BG_MAX_LOG_MB=1 node test.mjs --rotate
if (process.argv.includes("--rotate")) {
  const jiti = createJiti(import.meta.url, { interopDefault: true, alias });
  const mod = await jiti.import(EXT);
  const pi = makePi();
  (mod.default ?? mod)(pi);
  const bash = pi.tools.get("bash");
  const jobs = pi.tools.get("jobs");
  const ctx = makeCtx();
  const idOf = (r) => r.content[0].text.match(/(b[0-9a-f]{8})/)[1];
  const id = idOf(await bash.execute("r", { command: "for i in $(seq 1 3000000); do echo line-$i; done", run_in_background: true }, undefined, undefined, ctx));
  await sleep(4000);
  const sz = statSync(`${LOG_DIR}/${id}.log`).size;
  const pass = sz < 1.2 * 1024 * 1024; // ~1MB cap holds a ~115MB producer
  for (const h of (pi.handlers.session_shutdown || [])) h({ type: "session_shutdown", reason: "quit" });
  console.log(`rotate  file=${sz}B  ${pass ? "PASS" : "FAIL"}  (cap 1MB)`);
  process.exit(pass ? 0 : 1);
}

// ---- main run -------------------------------------------------------------
const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "✓" : "✗"} ${name}${detail ? `  — ${detail}` : ""}`);
};

const jiti = createJiti(import.meta.url, { interopDefault: true, alias });
const mod = await jiti.import(EXT);
const factory = mod.default ?? mod;
check("factory exports bgBash", typeof factory === "function" && factory.name === "bgBash", `name=${factory.name}`);

const pi = makePi();
factory(pi);
check("registers tools {bash, jobs}", sameSet([...pi.tools.keys()], ["bash", "jobs"]));
check("registers commands {bg, bg-stop, bg-clear}", sameSet([...pi.commands.keys()], ["bg", "bg-stop", "bg-clear"]));
check("registers shortcut {ctrl+shift+b} only (no ctrl+b collision)", sameSet([...pi.shortcuts.keys()], ["ctrl+shift+b"]));
check("registers events {session_start, session_shutdown, input}", sameSet(Object.keys(pi.handlers), ["session_start", "session_shutdown", "input"]));

const bash = pi.tools.get("bash");
const jobs = pi.tools.get("jobs");
const ctx = makeCtx();
const idOf = (r) => r.content[0].text.match(/(b[0-9a-f]{8})/)[1];

// 1. run_in_background returns immediately with an id
const r1 = await bash.execute("t1", { command: "sleep 1; echo done-bg", run_in_background: true }, undefined, undefined, ctx);
check("run_in_background returns id+log path", /running in background with ID: b[0-9a-f]{8}/.test(r1.content[0].text) && /Output is being written to:/.test(r1.content[0].text));
const id1 = idOf(r1);

// 2. jobs list shows [running]
const r2 = await jobs.execute("t2", { action: "list" }, undefined, undefined, ctx);
check("jobs list shows the bg job [running]", r2.content[0].text.includes(`${id1} `) && r2.content[0].text.includes("[running]"));

// 3. fast foreground returns output, zero residue (the unlink-before-read bug)
const r3 = await bash.execute("t3", { command: "echo hi" }, undefined, undefined, ctx);
check("fast foreground returns output (not '(no output)')", r3.content[0].text.trim() === "hi", JSON.stringify(r3.content[0].text));
const r3b = await jobs.execute("t3b", { action: "list" }, undefined, undefined, ctx);
check("fast fg leaves no residue (no 'hi' job)", !r3b.content[0].text.includes("echo hi"));

// 4. exactly one completion notification after bg finishes
await sleep(1700);
const n = pi.sent.filter((s) => s.m?.customType === "bg-job-finished").length;
check("exactly one completion notification", n === 1, `count=${n}`);
if (n === 1) {
  const msg = pi.sent.find((s) => s.m?.customType === "bg-job-finished");
  check("completion delivery is followUp+triggerTurn", msg.o?.deliverAs === "followUp" && msg.o?.triggerTurn === true, JSON.stringify(msg.o));
  check("completion content names the job + exit + command + output", /completed \(exit 0\)/.test(msg.m.content) && /Command: sleep 1; echo done-bg/.test(msg.m.content) && /Output:/.test(msg.m.content));
}
const r4 = await jobs.execute("t4", { action: "list" }, undefined, undefined, ctx);
check("jobs list after completion shows [completed] exit=0", r4.content[0].text.includes("[completed]") && r4.content[0].text.includes("exit=0"));

// 5. error path — unknown job
let err5 = null;
try { await jobs.execute("t5", { action: "kill", id: "bdeadbeef" }, undefined, undefined, ctx); } catch (e) { err5 = e.message; }
check("unknown job errors loudly (list-on-error trick)", err5 === "Unknown job: bdeadbeef", err5);
let err5b = null;
try { await jobs.execute("t5b", { action: "frobnicate" }, undefined, undefined, ctx); } catch (e) { err5b = e.message; }
check("unknown action errors loudly", err5b === "Unknown jobs action: frobnicate", err5b);

// 6. bounded tail + truncation marker + maxBytes honored
const r6 = await bash.execute("t6", { command: "seq 1 400000", run_in_background: true }, undefined, undefined, ctx);
const id6 = idOf(r6);
await sleep(800);
const r6o = await jobs.execute("t6o", { action: "output", id: id6, maxBytes: 100 }, undefined, undefined, ctx);
check("jobs output bounds tail with '…[ truncated ]' marker", r6o.content[0].text.startsWith("…[ truncated ]"));
check("jobs output maxBytes honored", r6o.content[0].text.length <= 300, `len=${r6o.content[0].text.length}`);

// 7. auto-background timing: timeout:1 returns ~1000ms (the §12.4 quick-race fix)
const t0 = Date.now();
const r7 = await bash.execute("t7", { command: "sleep 20", timeout: 1 }, undefined, undefined, ctx);
const dt = Date.now() - t0;
check("auto-bg at timeout:1 returns at ~1000ms (the §12.4 fix)", dt > 700 && dt < 1500, `dt=${dt}ms`);
check("auto-bg result phrasing: 'Process backgrounded as <id> (auto-backgrounded after 1s; …)'", /Process backgrounded as b[0-9a-f]{8} \(auto-backgrounded after 1s;/.test(r7.content[0].text));
const id7 = idOf(r7);
await jobs.execute("t7k", { action: "kill", id: id7 }, undefined, undefined, ctx).catch(() => {});
await sleep(400);

// ---- research-gap additions: BG-05 / BG-06 / BG-14 / BG-16 + BG-28 RED guard ----

// 11. BG-05 timeout bounds the foreground race only — never a backgrounded job
const r11 = await bash.execute("t11", { command: "sleep 30", timeout: 1, run_in_background: true }, undefined, undefined, ctx);
check("BG-05 run_in_background returns instantly (timeout ignored)", /running in background with ID: b[0-9a-f]{8}/.test(r11.content[0].text));
const id11 = idOf(r11);
await sleep(3000);
const l11 = (await jobs.execute("t11l", { action: "list" }, undefined, undefined, ctx)).content[0].text;
const l11job = l11.split("\n").find((l) => l.includes(id11)) || "";
check("BG-05 job still [running] past the 1s timeout", /\[running\]/.test(l11job), l11job.trim());
await jobs.execute("t11k", { action: "kill", id: id11 }, undefined, undefined, ctx).catch(() => {});
await sleep(300);

// 12. BG-28 RED guard: skip rules are NOT implemented — `sleep` auto-backgrounds instead of being killed
const r12 = await bash.execute("t12", { command: "sleep 60", timeout: 1 }, undefined, undefined, ctx);
const id12 = idOf(r12);
check("BG-28 RED: no skip rules yet — `sleep` auto-bg's (kill-on-skip is §12.6.8, not built)", /Process backgrounded as b[0-9a-f]{8}/.test(r12.content[0].text), "flips red the day skip rules land: sleep+timeout then kills instead of backgrounding");
await jobs.execute("t12k", { action: "kill", id: id12 }, undefined, undefined, ctx).catch(() => {});
await sleep(300);

// 13. BG-06 a `cd` inside a backgrounded command does not leak into later calls
const r13 = await bash.execute("t13", { command: "cd / && pwd && sleep 30 && pwd", timeout: 1 }, undefined, undefined, ctx);
const id13 = idOf(r13);
await sleep(2500);
const l13 = (await jobs.execute("t13l", { action: "list" }, undefined, undefined, ctx)).content[0].text;
check("BG-06 bg job [running] after the move (cd / happened inside it)", /\[running\]/.test(l13.split("\n").find((l) => l.includes(id13)) || ""));
const r13b = await bash.execute("t13b", { command: "pwd" }, undefined, undefined, ctx);
check("BG-06 later pwd returns the session cwd (/tmp), never /", r13b.content[0].text.trim() === "/tmp", JSON.stringify(r13b.content[0].text));
await jobs.execute("t13k", { action: "kill", id: id13 }, undefined, undefined, ctx).catch(() => {});
await sleep(300);

// 14. BG-14 compaction recovery: a lost id is recoverable via `jobs list` + `jobs output`
await bash.execute("t14", { command: "sleep 1; echo recovery-ok", run_in_background: true }, undefined, undefined, ctx); // id intentionally discarded
await sleep(1800);
const l14 = (await jobs.execute("t14l", { action: "list" }, undefined, undefined, ctx)).content[0].text;
const l14lines = l14.split("\n");
const l14ci = l14lines.findIndex((l) => l.includes("recovery-ok"));
const id14 = l14ci > 0 ? (l14lines[l14ci - 1].match(/(b[0-9a-f]{8})/) || [])[1] : undefined;
check("BG-14 lost id recovered from the list by command text", !!id14, l14.trim());
if (id14) {
  const r14o = await jobs.execute("t14o", { action: "output", id: id14 }, undefined, undefined, ctx);
  check("BG-14 recovered id yields the output", r14o.content[0].text.includes("recovery-ok"));
}

// 15. BG-16 kill reaps the whole detached process group, grandchildren included
const r15 = await bash.execute("t15", { command: "sleep 60 & wait", run_in_background: true }, undefined, undefined, ctx);
const id15 = idOf(r15);
await sleep(600);
const l15 = (await jobs.execute("t15l", { action: "list" }, undefined, undefined, ctx)).content[0].text;
const pid15 = parseInt((l15.split("\n").find((l) => l.includes(id15)) || "").match(/pid=(\d+)/)?.[1] || "0", 10);
check("BG-16 list exposes the leader pid", pid15 > 0, `pid=${pid15}`);
const kidsBefore = sh(`pgrep -P ${pid15}`).trim().split("\n").filter(Boolean);
check("BG-16 leader has a live child (sleep 60) before kill", kidsBefore.length >= 1, JSON.stringify(kidsBefore));
await jobs.execute("t15k", { action: "kill", id: id15 }, undefined, undefined, ctx).catch(() => {});
await sleep(500);
check("BG-16 kill reaps the leader", sh(`ps -p ${pid15} -o pid=`).trim().length === 0);
const kidsAfter = sh(`pgrep -P ${pid15}`).trim().split("\n").filter(Boolean);
check("BG-16 kill reaps the grandchildren too (whole group, not just the leader)", kidsAfter.length === 0, `survivors=${JSON.stringify(kidsAfter)}`);
const l15b = (await jobs.execute("t15l2", { action: "list" }, undefined, undefined, ctx)).content[0].text;
check("BG-16 job status after the group kill is [killed]", /\[killed\]/.test(l15b.split("\n").find((l) => l.includes(id15)) || ""));

// ---- research-gap round 2: BG-12 / BG-13 / BG-15 / BG-24 ----

// 16. BG-13 duration in `list` is TRUE job age, not per-call wall time
const r13a = await bash.execute("t13a", { command: "sleep 30", run_in_background: true }, undefined, undefined, ctx);
const id13a = idOf(r13a);
await sleep(300);
const age1 = ageOf((await jobs.execute("t13al", { action: "list" }, undefined, undefined, ctx)).content[0].text, id13a);
await sleep(2000);
const age2 = ageOf((await jobs.execute("t13al2", { action: "list" }, undefined, undefined, ctx)).content[0].text, id13a);
check("BG-13 duration is true job age (grows between list calls)", age2 > age1, `age1=${age1}s age2=${age2}s`);
await jobs.execute("t13ak", { action: "kill", id: id13a }, undefined, undefined, ctx).catch(() => {});
await sleep(300);

// 17. BG-12 onUpdate streams growing partial output during the foreground race
const updates = [];
const r12s = await bash.execute(
  "t12s",
  // must outlive the 2s quick window — the streamLog poller only runs after it
  { command: "for i in $(seq 1 10); do echo tick-$i; sleep 0.3; done" },
  undefined,
  (p) => updates.push(p.content?.[0]?.text ?? ""),
  ctx,
);
const texts = updates;
check("BG-12 onUpdate fired 2+ times with monotonic partials", texts.length >= 2 && texts.every((t, i) => i === 0 || t.length >= texts[i - 1].length), `calls=${texts.length}`);
check("BG-12 final result carries all ticks", r12s.content[0].text.includes("tick-1") && r12s.content[0].text.includes("tick-4"));

// 18. BG-24 job ids are unique, random b-hex ids (never reused)
const l24 = (await jobs.execute("t24l", { action: "list" }, undefined, undefined, ctx)).content[0].text;
const ids24 = [...l24.matchAll(/b[0-9a-f]{8}/g)].map((m) => m[0]);
check("BG-24 all listed ids are b-hex format", ids24.length > 0 && ids24.every((i) => /^b[0-9a-f]{8}$/.test(i)), `count=${ids24.length}`);
check("BG-24 no duplicate/reused ids", new Set(ids24).size === ids24.length, `count=${ids24.length}`);

// 19. BG-15 finished jobs remain listed until /bg-clear forgets them
const r15c = await bash.execute("t15c", { command: "echo clear-me", run_in_background: true }, undefined, undefined, ctx);
const id15c = idOf(r15c);
await sleep(700);
const l15c1 = (await jobs.execute("t15cl", { action: "list" }, undefined, undefined, ctx)).content[0].text;
check("BG-15 completed job stays listed (no silent disappearance)", l15c1.includes(id15c) && /\[completed\]/.test(l15c1.split("\n").find((l) => l.includes(id15c)) || ""));
await pi.commands.get("bg-clear").handler({}, ctx);
const l15c2 = (await jobs.execute("t15cl2", { action: "list" }, undefined, undefined, ctx)).content[0].text;
check("BG-15 /bg-clear forgets finished jobs", !l15c2.includes(id15c), l15c2.trim());

// 8. honest exit statuses (no isSignalExit guessing)
const r8 = await bash.execute("t8", { command: "exit 137", run_in_background: true }, undefined, undefined, ctx);
const id8 = idOf(r8);
await sleep(500);
const l8 = (await jobs.execute("t8l", { action: "list" }, undefined, undefined, ctx)).content[0].text.split("\n").find((l) => l.includes(id8)) || "";
check("exit 137 → [failed] exit=137 (no '(signal)' guess)", l8.includes("[failed]") && l8.includes("exit=137") && !l8.includes("signal"), l8.trim());

const r9 = await bash.execute("t9", { command: "kill -9 $$", run_in_background: true }, undefined, undefined, ctx);
const id9 = idOf(r9);
await sleep(500);
const l9 = (await jobs.execute("t9l", { action: "list" }, undefined, undefined, ctx)).content[0].text.split("\n").find((l) => l.includes(id9)) || "";
check("kill -9 $$ → [killed] (code null via real signal)", l9.includes("[killed]"), l9.trim());

// 9. the completion messages for the failed/killed jobs carry honest statuses
await sleep(200);
const notes = pi.sent.filter((s) => s.m?.customType === "bg-job-finished").slice(-2).map((s) => /^Background job .* (?:after \S+)/.exec(s.m.content)?.[0]);
check("failed/killed notifications carry honest exit lines", notes.length === 2 && notes.some((n) => /failed \(exit 137\)/.test(n)) && notes.some((n) => /killed \(killed/.test(n)), JSON.stringify(notes));

// ---- findings fixes: BG-20 shutdown escalation + BG-21 spawn-failure honesty ----

// 20. shutdown escalates TERM -> KILL for a job that traps SIGTERM
const r20 = await bash.execute("t20", { command: "trap '' TERM; sleep 60", run_in_background: true }, undefined, undefined, ctx);
const id20 = idOf(r20);
await sleep(500);
const l20 = (await jobs.execute("t20l", { action: "list" }, undefined, undefined, ctx)).content[0].text;
const pid20 = parseInt((l20.split("\n").find((l) => l.includes(id20)) || "").match(/pid=(\d+)/)?.[1] || "0", 10);
check("BG-20 TERM-trapping job exposes its leader pid", pid20 > 0, `pid=${pid20}`);
for (const h of (pi.handlers.session_shutdown || [])) {
  try { h({ type: "session_shutdown", reason: "quit" }); } catch (e) { check("BG-20 shutdown handler runs clean", false, String(e)); }
}
// SIGTERM is trapped; only the 3s SIGKILL escalation can reap the group
await sleep(4000);
check("BG-20 shutdown SIGKILL escalation reaps the TERM-trapping job", sh(`ps -p ${pid20} -o pid=`).trim().length === 0, `pid=${pid20} still alive`);

// 21. a spawn failure surfaces as a tool error, never "(no output)" success
const savedPath = process.env.PATH;
process.env.PATH = "";
let err21 = null;
try { await bash.execute("t21", { command: "echo hi" }, undefined, undefined, ctx); } catch (e) { err21 = e.message; }
process.env.PATH = savedPath;
check("BG-21 missing shell throws 'Failed to spawn bash' (no silent success)", !!err21 && /Failed to spawn bash/.test(err21), err21 || "(no error thrown)");

// fire session_shutdown, assert it sweeps
let shutdownOk = true;
for (const h of (pi.handlers.session_shutdown || [])) {
  try { h({ type: "session_shutdown", reason: "quit" }); } catch (e) { shutdownOk = false; }
}
check("session_shutdown handler runs clean", shutdownOk);
check("session_shutdown clears the registry", [...pi.tools].length && regJobsCleared(pi), "(jobs tool is still registered by pi; check live processes instead)");

// 10. tail-rotate runs in an isolated child (env-gated module constant)
const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--rotate"], {
  env: { ...process.env, PI_BG_MAX_LOG_MB: "1" },
  encoding: "utf8",
  timeout: 30000,
});
const childOut = (child.stdout || "").trim();
const rotatePass = child.status === 0 && /PASS/.test(childOut);
check("tail-rotate caps disk (1MB cap holds a ~115MB producer)", rotatePass, childOut || `rc=${child.status} ${child.stderr?.trim()}`);

// ---- summary --------------------------------------------------------------
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? `, ${failed.length} FAILED:` : ""}`);
for (const f of failed) console.log(`  ✗ ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
process.exit(failed.length ? 1 : 0);

// ---- helpers --------------------------------------------------------------
function makePi() {
  return {
    tools: new Map(), shortcuts: new Map(), commands: new Map(), handlers: new Map(),
    sent: [],
    on(e, h) { (this.handlers[e] ||= []).push(h); },
    registerTool(t) { this.tools.set(t.name, t); },
    registerShortcut(k, o) { this.shortcuts.set(k, o); },
    registerCommand(n, o) { this.commands.set(n, o); },
    sendMessage(m, o) { this.sent.push({ m, o }); },
    sendUserMessage(t, o) { this.sent.push({ user: t, o }); },
  };
}
function makeCtx() {
  return { hasUI: false, cwd: "/tmp", abort() {}, signal: undefined, ui: { notify() {} } };
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function sh(cmd) { return spawnSync("sh", ["-c", cmd], { encoding: "utf8" }).stdout; }
// parse the trailing duration token ("3s" or "1m5s") from a job's list line into seconds
function ageOf(listText, id) {
  const line = listText.split("\n").find((l) => l.includes(id)) || "";
  const m = line.match(/(?:(\d+)m)?(\d+)s\s*$/);
  return m ? parseInt(m[1] || "0", 10) * 60 + parseInt(m[2], 10) : -1;
}
function sameSet(a, b) { return a.length === b.length && [...a].sort().join() === [...b].sort().join(); }
function regJobsCleared(pi) { return pi.tools.size === 2; } // tools remain registered; live processes are reaped by shutdown