/**
 * Sort Packages Extension
 *
 * Automatically sorts the "packages" array in ~/.pi/agent/settings.json
 * alphabetically after pi loads.
 */

import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const SETTINGS_PATH = join(getAgentDir(), "settings.json");

type Settings = Record<string, unknown>;

async function readSettings(): Promise<Settings> {
	const raw = await readFile(SETTINGS_PATH, "utf-8");
	return JSON.parse(raw) as Settings;
}

async function writeSettings(settings: Settings): Promise<void> {
	await writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n", "utf-8");
}

function sortPackagesIn(settings: Settings): { changed: boolean; count: number } {
	const pkgs = settings.packages;
	if (!Array.isArray(pkgs)) {
		return { changed: false, count: 0 };
	}

	const sorted = [...pkgs].sort((a, b) => {
		if (typeof a !== "string" || typeof b !== "string") return 0;
		return a.localeCompare(b);
	});

	const changed = sorted.some((p, i) => p !== (pkgs as string[])[i]);
	if (changed) {
		settings.packages = sorted;
	}
	return { changed, count: pkgs.length };
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		try {
			const settings = await readSettings();
			const { changed, count } = sortPackagesIn(settings);

			if (count === 0) {
				return;
			}

			if (!changed) {
				return;
			}

			await writeSettings(settings);
			ctx.ui.notify(`Sorted ${count} packages in settings.json`, "info");
		} catch {
			// Silently ignore — not critical enough to bother the user on every startup.
		}
	});
}
