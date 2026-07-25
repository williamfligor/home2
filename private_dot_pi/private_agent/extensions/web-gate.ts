/**
 * web-gate — Shared /web-on and /web-off command for any web browsing tools.
 *
 * Other extensions import { registerWebGate } and call it with their tool names.
 * The gate auto-deactivates all registered tools on session_start so that web
 * tools start disabled until the user opts in with /web-on.
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

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

// ── shared state (globalThis so callers from different module scopes see it) ──

const KEY = "__pi_web_gate";

interface GateState {
	toolNames: string[];
}

function state(): GateState {
	const g = globalThis as Record<string, unknown>;
	if (!g[KEY]) g[KEY] = { toolNames: [] };
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

// ── public API (for other extensions to register their tools) ──

export function registerWebGate(_pi: ExtensionAPI, toolName: string) {
	const s = state();
	if (!s.toolNames.includes(toolName)) s.toolNames.push(toolName);
}

// ── extension entry ──

export default function (pi: ExtensionAPI) {
	const s = state();

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

	// Auto-disable all gated tools on every session start
	pi.on("session_start", () => {
		const active = pi.getActiveTools();
		const filtered = active.filter((n) => !s.toolNames.includes(n));
		if (filtered.length < active.length) pi.setActiveTools(filtered);
	});
}
