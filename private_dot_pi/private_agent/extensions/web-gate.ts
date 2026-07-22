/**
 * web-gate — Shared /web-on and /web-off command for any web browsing tools.
 *
 * Other extensions import { registerWebGate } and call it with their tool names.
 * The gate auto-deactivates all registered tools on session_start so that web
 * tools start disabled until the user opts in with /web-on.
 *
 * Shared state lives on globalThis so multiple extension files can register
 * their tools without each other's module-level state.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

// ── shared state (globalThis so callers from different module scopes see it) ──

const KEY = "__pi_web_gate";

interface GateState {
	toolsDeactivated: boolean;
	toolNames: string[];
	commandsRegistered: boolean;
}

function state(): GateState {
	const g = globalThis as Record<string, unknown>;
	if (!g[KEY]) g[KEY] = { toolsDeactivated: false, toolNames: [], commandsRegistered: false };
	return g[KEY] as GateState;
}

// ── footer indicator ──

const GLOBE = "\u{f0ac} "; // nf-fa-globe

function refreshStatus(pi: ExtensionAPI, ctx: { ui: { setStatus: (k: string, t?: string) => void } }) {
	const s = state();
	const active = pi.getActiveTools();
	const any = s.toolNames.some((n) => active.includes(n));
	ctx.ui.setStatus("web", any ? GLOBE : undefined);
}

// ── public API ──

export function registerWebGate(pi: ExtensionAPI, toolName: string) {
	const s = state();

	// deduplicate
	if (!s.toolNames.includes(toolName)) s.toolNames.push(toolName);

	// disable registered tools on startup (once per process)
	if (!s.toolsDeactivated) {
		s.toolsDeactivated = true;
		pi.on("session_start", () => {
			const active = pi.getActiveTools();
			const filtered = active.filter((n) => !s.toolNames.includes(n));
			if (filtered.length < active.length) pi.setActiveTools(filtered);
		});
	}

	// register /web-on and /web-off (once per process)
	if (s.commandsRegistered) return;
	s.commandsRegistered = true;

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
			refreshStatus(pi, ctx);
		},
	});
}

// ── extension entry ──

export default function (_pi: ExtensionAPI) {}
