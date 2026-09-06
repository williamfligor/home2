/**
 * Slash-guard extension.
 *
 * Blocks any input starting with `/` that isn't a known command,
 * skill, or template — preventing slash typos from reaching the LLM.
 *
 * Built-in commands (e.g. /model, /sandbox) are caught by the TUI
 * layer before this extension runs, so they never reach the input event.
 * Skills, templates, and extension commands are in pi.getCommands()
 * and pass through.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.on("input", async (event, ctx) => {
		const text = event.text.trim();
		if (!text.startsWith("/") || text === "/") return { action: "continue" };

		// Let paths through (/etc/hosts, /path/to/file.txt)
		if (text.includes("/", 1)) return { action: "continue" };

		const first = text.split(/[\s\n]/)[0].slice(1);
		// Bare "/" word, not a command — pass through
		if (!first) return { action: "continue" };

		const cmd = first.toLowerCase();

		// Known command, skill, or template — pass through
		if (pi.getCommands().some((c) => c.name.toLowerCase() === cmd)) {
			return { action: "continue" };
		}

		// Skip extension-injected messages so other extensions aren't blocked
		if (event.source === "extension") return { action: "continue" };

		ctx.ui.notify(`Unknown input starting with / — not sent to the model`, "warning");
		return { action: "handled" };
	});
}
