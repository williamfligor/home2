/**
 * web-gate — Shared /web-on and /web-off command for any web browsing tools.
 *
 * Other extensions import { registerWebGate } and call it with their tool names.
 *
 * The gate auto-deactivates all registered web tools on session_start so they
 * start disabled until the user opts in with /web-on. The /web-on and /web-off
 * commands are available for manual toggling.
 *
 * SECURITY INVARIANT: web tools can only ever be enabled by explicit user
 * action — the --web-on CLI flag or the /web-on command (which is also what
 * exports PI_WEB_ON for subagent processes). Nothing else can turn them on:
 *
 *   - The agent model has no tool that can toggle tools, and the gate re-
 *     asserts the disabled state at session start, on tree navigation, and at
 *     the start of every turn (agent_start), so tool-state changes from any
 *     other source — /tools restores from branch history, dynamic tool re-
 *     registration re-adding allowlisted tools, pi's --tools allowlist
 *     refresh — are reverted before the model can act.
 *   - PI_WEB_ON mirrors the user's explicit intent, never the observed tool
 *     state, so no mechanism other than the user can propagate web access to
 *     subagents. It is cleared at session_start in the main process, so a
 *     /web-on from an earlier session in the same process cannot leak the
 *     bypass into a new session. Subagents inherit the bypass via the
 *     environment (children are separate pi processes that do not get the
 *     parent's CLI flags) and never clear it, so nested spawns keep the
 *     state their parent granted them.
 *
 * Shared state lives on globalThis so multiple extension files can register
 * their tools without each other's module-level state.
 *
 * IMPORTANT: The commands and session_start handler are registered in THIS
 * extension's default export, not in registerWebGate(). This ensures they
 * work even on /reload where globalThis state persists but Pi's command and
 * event registrations are reset. registerWebGate() only manages the shared
 * tool-name list.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

// ── shared state (globalThis so callers from different module scopes see it) ──

const KEY = "__pi_web_gate";

// Exported to the environment whenever the user has enabled web tools so
// subagent processes (separate pi instances) inherit the bypass on spawn.
const WEB_ON_ENV = "PI_WEB_ON";

interface GateState {
	toolNames: string[];
	/**
	 * Explicit user intent for the current session: set by /web-on, derived
	 * from the --web-on flag at session start, or inherited from a parent via
	 * PI_WEB_ON in a subagent process. Never inferred from tool state.
	 */
	enabled: boolean;
}

function state(): GateState {
	const g = globalThis as Record<string, unknown>;
	if (!g[KEY]) g[KEY] = { toolNames: [], enabled: false };
	return g[KEY] as GateState;
}

// ── footer indicator ──

const GLOBE = "\u{f0ac} "; // nf-fa-globe

function refreshStatus(pi: ExtensionAPI, ctx: ExtensionContext) {
	const s = state();
	const active = pi.getActiveTools();
	const any = s.toolNames.some((n) => active.includes(n));
	ctx.ui.setStatus("web", any ? GLOBE : undefined);
}

// PI_WEB_ON mirrors the user's explicit intent so subagents inherit the
// bypass exactly when their parent granted it. Subagent processes only ever
// set it, never clear it, so inherited state survives nested spawns.
function syncEnv() {
	const s = state();
	if (s.enabled) {
		process.env[WEB_ON_ENV] = "1";
	} else if (process.env.PI_SUBAGENT_CHILD !== "1") {
		delete process.env[WEB_ON_ENV];
	}
}

// Re-assert the gate: when the user has not enabled web tools, strip every
// gated tool from the active set. Run at session start, on tree navigation,
// and at the start of every turn so no other mechanism can sneak web tools in.
function assertGate(pi: ExtensionAPI) {
	if (state().enabled) return;
	const active = pi.getActiveTools();
	const filtered = active.filter((n) => !state().toolNames.includes(n));
	if (filtered.length < active.length) pi.setActiveTools(filtered);
}

// ── public API (for other extensions to register their tools) ──

export function registerWebGate(_pi: ExtensionAPI, toolName: string) {
	const s = state();
	if (!s.toolNames.includes(toolName)) s.toolNames.push(toolName);
}

// ── extension entry ──

export default function (pi: ExtensionAPI) {
	// Register --web-on so pi recognizes it and appears in --help.
	pi.registerFlag("web-on", {
		description: "Start with all web tools enabled and bypass the web gate completely",
		type: "boolean",
		default: false,
	});

	const s = state();
	const isSubagent = process.env.PI_SUBAGENT_CHILD === "1";

	// Defensively gate web tools provided by packages that do not know about
	// the gate. pi-web-access (npm) provides the researcher builtin's
	// fetch_content / get_search_content; register them here so a future
	// install stays gated. Unknown names are no-ops (the gate only strips
	// tools that are actually active).
	registerWebGate(pi, "fetch_content");
	registerWebGate(pi, "get_search_content");

	// Derive the user's intent for this process. In the main process only the
	// CLI flag counts — any PI_WEB_ON left over from an earlier session in the
	// same process is stale and is ignored. In a subagent, the env var is the
	// parent's grant and is authoritative (children get env, not CLI flags).
	function deriveEnabled(): boolean {
		if (isSubagent) {
			return pi.getFlag("web-on") === true || process.env[WEB_ON_ENV] === "1";
		}
		return pi.getFlag("web-on") === true;
	}

	// Register /web-on and /web-off on every load (handles /reload correctly)
	pi.registerCommand("web-on", {
		description: "Enable all web-browsing tools",
		handler: async (_args, ctx) => {
			const active = pi.getActiveTools();
			const missing = s.toolNames.filter((n) => !active.includes(n));
			if (missing.length === 0) {
				ctx.ui.notify("Web tools already enabled", "info");
			} else {
				pi.setActiveTools([...active, ...missing]);
				ctx.ui.notify(`Enabled: ${missing.join(", ")}`, "info");
			}
			s.enabled = true;
			syncEnv(); // propagate to subagents
			refreshStatus(pi, ctx);
		},
	});

	pi.registerCommand("web-off", {
		description: "Disable all web-browsing tools",
		handler: async (_args, ctx) => {
			const active = pi.getActiveTools();
			const filtered = active.filter((n) => !s.toolNames.includes(n));
			if (filtered.length === active.length) {
				ctx.ui.notify("Web tools already disabled", "info");
			} else {
				pi.setActiveTools(filtered);
				ctx.ui.notify("Web tools disabled", "info");
			}
			s.enabled = false;
			syncEnv(); // stop propagating to subagents
			refreshStatus(pi, ctx);
		},
	});

	// Show the globe if the gate is bypassed, otherwise strip gated tools, then
	// reconcile PI_WEB_ON with the user's intent.
	function reconcile(ctx: ExtensionContext) {
		if (s.enabled) {
			refreshStatus(pi, ctx);
		} else {
			assertGate(pi);
		}
		syncEnv();
	}

	// On session start: reset the gate for the new session. The bypass applies
	// only when the user started this process with --web-on, or a subagent
	// inherited PI_WEB_ON from a parent that granted it. /reload keeps the
	// current toggle (globalThis state survives, so /web-on persists across it).
	pi.on("session_start", (event, ctx) => {
		if (event.reason !== "reload") s.enabled = deriveEnabled();
		reconcile(ctx);
	});

	// On tree navigation, tools.ts can restore previously enabled tools from
	// branch history. Keep the current user intent and re-assert, so web tools
	// cannot come back that way (the agent_start re-assert below also covers it
	// regardless of handler order).
	pi.on("session_tree", (_event, ctx) => reconcile(ctx));

	// At the start of every turn, before the model can act, re-assert the gate
	// and reconcile PI_WEB_ON with the user's intent. This reverts any tool-
	// state change made by non-user sources since the last turn — e.g. dynamic
	// tool re-registration re-adding allowlisted web tools, or a /tools restore.
	pi.on("agent_start", (_event, ctx) => reconcile(ctx));
}
