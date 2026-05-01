/**
 * Matplotlib Agg Backend - Sets MPLBACKEND to Agg for headless rendering.
 *
 * Prevents matplotlib from attempting to use a GUI backend, which is useful
 * in headless / CI environments.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	process.env.MPLBACKEND = "Agg";
}
