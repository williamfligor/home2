/**
 * Browser Extension for Pi
 *
 * Provides browser tools with reader-mode content extraction:
 *   - search: Search the web for key phrases (via ddgs text search)
 *   - open:   Open a page and extract its content as markdown
 *             - HTML pages: fetched, parsed with Mozilla Readability, converted to markdown via Turndown
 *             - PDFs: downloaded, text extracted via pdf-parse, formatted as markdown
 *             - GitHub URLs: cloned locally or viewed via API
 *   - find:   Look for contents on a page (extract + in-content search)
 *             - For GitHub URLs with local clone: searches across all files in the repo
 *
 * Requires: ddgs Python package available via uv (`uv tool install ddgs` or just `uv run --with ddgs`)
 * Node deps: jsdom, @mozilla/readability, turndown, pdf-parse
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { CloneManager } from "./github";
import { registerFindTool, registerOpenTool, registerSearchTool } from "./tools";
import { createPageCache, TempDirTracker } from "./utils";

/**
 * Browser extension entry point
 */
export default function browserExtension(pi: ExtensionAPI) {
	// Create a shared page cache for the open and find tools
	const cache = createPageCache();
	const cloneManager = new CloneManager();
	const tempTracker = new TempDirTracker();

	// Clear clone cache on session change
	pi.on("session_start", async () => {
		await cloneManager.clear();
	});

	// Clear temp dirs on session change
	pi.on("session_end", async () => {
		await tempTracker.clear();
	});

	// Register all tools
	registerSearchTool(pi);
	registerOpenTool(pi, { cache, cloneManager, tempTracker });
	registerFindTool(pi, { cache, cloneManager });
}
