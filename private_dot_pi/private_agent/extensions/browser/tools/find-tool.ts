/**
 * Find tool implementation
 * Searches for text within a web page's content
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

import {
	GREP_TIMEOUT_MS,
	MAX_FIND_MATCHES,
	MAX_SEARCH_PHRASE_LENGTH,
	URL_DISPLAY_LENGTH,
} from "../constants";
import type { ExtractContentOptions } from "../content";
import { extractContent } from "../content";
import { type CloneManager, parseGitHubUrl } from "../github";
import type { FindMatch, PageCache } from "../types";

/**
 * Options for the find tool
 */
export interface FindToolOptions {
	extractContent?: (
		url: string,
		options?: ExtractContentOptions,
	) => Promise<ReturnType<typeof extractContent>>;
	cache: PageCache;
	cloneManager?: CloneManager;
}

/**
 * Register the find tool with the Pi extension API
 *
 * @param pi - The Pi extension API
 * @param options - Configuration options including cache and clone manager
 *
 * @example
 * ```typescript
 * registerFindTool(pi, { cache: pageCache, cloneManager });
 * ```
 */
export function registerFindTool(pi: ExtensionAPI, options: FindToolOptions): void {
	const { extractContent: extract = extractContent, cache, cloneManager } = options;

	pi.registerTool({
		name: "find",
		label: "Find on Page",
		description:
			"Look for specific content on a web page. Searches for a key phrase within a page's content. " +
			"If the page was previously opened with the 'open' tool, it searches the cached content. " +
			"For GitHub URLs with a local clone, searches across all files in the repo. " +
			"Otherwise, it fetches the page first and then searches within it.",
		promptSnippet: "Search for text within a web page",
		promptGuidelines: [
			"Use find to locate specific information within a long page without re-reading the entire content.",
			"find is more efficient than re-opening a page when you just need to check for a specific term.",
			"For GitHub URLs, find searches across all files in the cloned repo.",
		],
		parameters: Type.Object({
			url: Type.String({
				description: "The URL of the page to search within",
			}),
			phrase: Type.String({
				description: "The key phrase to search for within the page content",
			}),
			forceClone: Type.Optional(
				Type.Boolean({
					description:
						"Forces a full git clone for GitHub URLs even if the repo exceeds the 350MB size threshold. Default: false.",
				}),
			),
		}),

		// Custom rendering to show the URL and search phrase in the GUI
		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			let content = theme.fg("toolTitle", theme.bold("find "));
			content += theme.fg("muted", `"${args.phrase}"`);
			content += theme.fg("toolTitle", " in ");
			// Truncate long URLs for display
			const displayUrl =
				args.url.length > URL_DISPLAY_LENGTH
					? `...${args.url.slice(-(URL_DISPLAY_LENGTH - 3))}`
					: args.url;
			content += theme.fg("dim", displayUrl);
			text.setText(content);
			return text;
		},

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			// Input validation
			if (!params.phrase || params.phrase.trim() === "") {
				throw new Error("Search phrase cannot be empty");
			}
			if (params.phrase.length > MAX_SEARCH_PHRASE_LENGTH) {
				throw new Error(
					`Search phrase exceeds maximum length of ${MAX_SEARCH_PHRASE_LENGTH} characters`,
				);
			}

			const gitHubInfo = parseGitHubUrl(params.url);

			// GitHub URL with local clone: search across all files
			if (gitHubInfo && cloneManager?.has(gitHubInfo.owner, gitHubInfo.repo)) {
				const clone = cloneManager.get(gitHubInfo.owner, gitHubInfo.repo);
				if (clone) {
					const searchResults = await searchInClone(clone.localPath, params.phrase);
					return formatSearchResults(searchResults, params.url, clone.localPath);
				}
			}

			let content = cache.get(params.url);

			if (!content) {
				const result = await extract(params.url, {
					forceClone: params.forceClone,
					cloneManager,
				});
				content = result.content;
				if (content) cache.set(params.url, content);
			}
			if (!content) {
				return createNoMatchesResponse(params.url, params.phrase, "No content available");
			}

			// Case-insensitive search using regex for proper Unicode handling
			const escapedPhrase = params.phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			const searchRegex = new RegExp(escapedPhrase, "i");

			// Find all matches with context
			const matches: FindMatch[] = [];
			const lines = content.split("\n");

			for (let i = 0; i < lines.length && matches.length < MAX_FIND_MATCHES; i++) {
				if (searchRegex.test(lines[i])) {
					matches.push({
						line: i + 1,
						context: lines[i].trim(),
					});
				}
			}

			if (matches.length === 0) {
				return createNoMatchesResponse(params.url, params.phrase, "No occurrences found");
			}

			// Format matches with surrounding context
			const displayedMatches = matches.slice(0, MAX_FIND_MATCHES);
			let resultText = `Found ${matches.length} occurrence(s) of "${params.phrase}" on ${params.url}:\n\n`;
			resultText += displayedMatches
				.map((m) => {
					// Include one line of context before and after if available
					const lineIndex = m.line - 1; // Convert to 0-indexed
					let ctx = "";
					if (lineIndex > 0 && lines[lineIndex - 1]) {
						ctx += `  L${lineIndex}: ${(lines[lineIndex - 1] ?? "").trim()}\n`;
					}
					ctx += `> L${m.line}: ${m.context}\n`;
					if (lineIndex < lines.length - 1 && lines[lineIndex + 1]) {
						ctx += `  L${lineIndex + 2}: ${(lines[lineIndex + 1] ?? "").trim()}`;
					}
					return ctx;
				})
				.join("\n\n");

			if (matches.length > MAX_FIND_MATCHES) {
				resultText += `\n\n[Showing first ${MAX_FIND_MATCHES} of ${matches.length} matches]`;
			}

			return {
				content: [{ type: "text", text: resultText }],
				details: {
					url: params.url,
					phrase: params.phrase,
					matchCount: matches.length,
				},
			};
		},
	});
}

/**
 * Create a response for no matches or no content
 */
function createNoMatchesResponse(
	url: string,
	phrase: string,
	reason: string,
): {
	content: Array<{ type: string; text: string }>;
	details: { url: string; phrase: string; matchCount: number };
} {
	const message =
		reason === "No content available"
			? `No content available from ${url} to search.`
			: `No occurrences of "${phrase}" found on ${url}.`;

	return {
		content: [{ type: "text", text: message }],
		details: { url, phrase, matchCount: 0 },
	};
}

/**
 * Search within a cloned repo using grep
 *
 * @param localPath - Path to the cloned repository
 * @param phrase - The search phrase to find
 * @returns Array of matches with file, line number, and context
 * @throws Error if grep fails or times out
 */
async function searchInClone(
	localPath: string,
	phrase: string,
): Promise<Array<{ file: string; line: number; context: string }>> {
	const { execFile } = await import("node:child_process");
	const { promisify } = await import("node:util");

	// Sanitize the search phrase by escaping special characters
	// This prevents command injection and grep pattern interpretation issues
	const sanitizedPhrase = phrase.replace(/[&;|`$(){}<>\\]/g, "\\$&").replace(/\n/g, "");

	const grepAsync = promisify(execFile);

	try {
		const result = await grepAsync(
			"grep",
			["-rn", "-i", "--max-count=50", "-F", sanitizedPhrase, localPath],
			{
				encoding: "utf-8",
				timeout: GREP_TIMEOUT_MS,
			},
		);

		const matches: Array<{ file: string; line: number; context: string }> = [];
		for (const line of result.trim().split("\n")) {
			if (!line.trim()) continue;
			// Use -F flag for fixed string, parse with first two colons as separators
			const colonIndex1 = line.indexOf(":");
			const colonIndex2 = line.indexOf(":", colonIndex1 + 1);
			if (colonIndex1 === -1 || colonIndex2 === -1) continue;

			const filePath = line.slice(0, colonIndex1);
			const lineNum = parseInt(line.slice(colonIndex1 + 1, colonIndex2), 10);
			const context = line.slice(colonIndex2 + 1);

			if (!Number.isNaN(lineNum)) {
				matches.push({
					file: filePath.replace(`${localPath}/`, ""),
					line: lineNum,
					context,
				});
			}
		}
		return matches;
	} catch (err: unknown) {
		// Check if it's a timeout error
		if (err instanceof Error) {
			if ("code" in err && err.code === "ETIMEDOUT") {
				throw new Error(`Search timed out after ${GREP_TIMEOUT_MS}ms in ${localPath}`);
			}
			// grep returns exit code 1 for no matches, which is not an error
			if ("status" in err && err.status === 1) {
				return [];
			}
			// grep returns exit code 2 for errors (file not found, permission denied, etc.)
			if ("status" in err && err.status === 2) {
				throw new Error(`Search failed in cloned repo: ${err.message}`);
			}
			throw new Error(`Search failed in cloned repo: ${err.message}`);
		}
		throw new Error(`Search failed in cloned repo: ${String(err)}`);
	}
}

/**
 * Format search results from a clone
 *
 * @param matches - Array of search matches
 * @param url - The original URL
 * @param localPath - Path to the local clone
 * @returns Formatted response with content and details
 */
function formatSearchResults(
	matches: Array<{ file: string; line: number; context: string }>,
	url: string,
	localPath: string,
): {
	content: Array<{ type: string; text: string }>;
	details: { url: string; matchCount: number; localPath: string };
} {
	if (matches.length === 0) {
		return {
			content: [{ type: "text", text: `No occurrences found in the repository.` }],
			details: { url, matchCount: 0, localPath },
		};
	}

	const displayedMatches = matches.slice(0, MAX_FIND_MATCHES);
	let resultText = `Found ${matches.length} occurrence(s) in github repo:\n\n`;
	resultText += `**Local path:** \`${localPath}\`\n\n`;
	resultText += displayedMatches
		.map((m) => `\t**${m.file}:${m.line}**\n> ${m.context}`)
		.join("\n\n");

	if (matches.length > MAX_FIND_MATCHES) {
		resultText += `\n\n[Showing first ${MAX_FIND_MATCHES} of ${matches.length} matches]`;
	}

	return {
		content: [{ type: "text", text: resultText }],
		details: { url, matchCount: matches.length, localPath },
	};
}
