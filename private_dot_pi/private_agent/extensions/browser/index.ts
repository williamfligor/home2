/**
 * Browser Extension for Pi
 *
 * Provides browser tools compatible with gpt-oss-120b's training:
 *   - search: Search the web for key phrases (via ddgs text search)
 *   - open:   Open a particular page and extract its content (via ddgs extract)
 *   - find:   Look for contents on a page (extract + in-content search)
 *
 * Requires: ddgs Python package available via uv (`uv tool install ddgs` or just `uv run --with ddgs`)
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { execFileSync } from "child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "os";
import { join } from "path";

// ---------- constants ----------

const MAX_CONTENT_LENGTH = 80_000; // ~20k tokens, generous but bounded
const SEARCH_TIMEOUT_MS = 30_000;
const EXTRACT_TIMEOUT_MS = 30_000;

// ---------- types ----------

interface SearchResult {
	title: string;
	href: string;
	body: string;
}

/**
 * Run ddgs text search via the Python API using `uv run --with ddgs`.
 * Returns parsed JSON results — more reliable than parsing CLI text output.
 */
function runDdgsSearch(query: string, maxResults: number = 10): SearchResult[] {
	const script = `
import json, sys
from ddgs import DDGS
try:
    results = DDGS().text(${JSON.stringify(query)}, max_results=${maxResults})
    print(json.dumps(results))
except Exception as e:
    print(json.dumps({"error": str(e)}), file=sys.stderr)
    sys.exit(1)
`;

	const output = execFileSync(
		"uv",
		["run", "--with", "ddgs", "python3", "-c", script],
		{
			encoding: "utf-8",
			timeout: SEARCH_TIMEOUT_MS,
			maxBuffer: 10 * 1024 * 1024,
		},
	);

	const parsed = JSON.parse(output.trim());
	if (!Array.isArray(parsed)) {
		throw new Error("Unexpected search response format");
	}
	return parsed as SearchResult[];
}

/**
 * Run ddgs extract via the Python API using `uv run --with ddgs`.
 * Returns the parsed extract result: { url, content }.
 */
function runDdgsExtract(url: string): { url?: string; content?: string; error?: string } {
	const script = `
import json, sys
from ddgs import DDGS
try:
    result = DDGS().extract(${JSON.stringify(url)})
    print(json.dumps(result))
except Exception as e:
    print(json.dumps({"error": str(e)}), file=sys.stderr)
    sys.exit(1)
`;

	const output = execFileSync(
		"uv",
		["run", "--with", "ddgs", "python3", "-c", script],
		{
			encoding: "utf-8",
			timeout: EXTRACT_TIMEOUT_MS,
			maxBuffer: 50 * 1024 * 1024,
		},
	);

	const parsed = JSON.parse(output.trim());
	if (parsed.error) {
		throw new Error(parsed.error);
	}
	return parsed;
}

// ---------- formatting ----------

function formatSearchResults(results: SearchResult[]): string {
	if (results.length === 0) {
		return "No search results found.";
	}

	return results
		.map((r, i) => {
			let text = `[${i + 1}] ${r.title}\n    URL: ${r.href}`;
			if (r.body) {
				text += `\n    ${r.body}`;
			}
			return text;
		})
		.join("\n\n");
}

function truncateContent(
	content: string,
	maxLen: number,
): { text: string; truncated: boolean; totalLength: number } {
	if (content.length <= maxLen) {
		return { text: content, truncated: false, totalLength: content.length };
	}
	// Truncate at a paragraph or sentence boundary if possible
	let cutPoint = content.lastIndexOf("\n\n", maxLen);
	if (cutPoint < maxLen * 0.5) {
		cutPoint = content.lastIndexOf(". ", maxLen);
	}
	if (cutPoint < maxLen * 0.5) {
		cutPoint = maxLen;
	}
	return {
		text: content.slice(0, cutPoint),
		truncated: true,
		totalLength: content.length,
	};
}

// ---------- page cache for find ----------

const pageCache = new Map<string, string>();

function getCachedPage(url: string): string | undefined {
	return pageCache.get(url);
}

function cachePage(url: string, content: string): void {
	pageCache.set(url, content);
	// Evict oldest entries if cache grows too large
	if (pageCache.size > 20) {
		const firstKey = pageCache.keys().next().value;
		if (firstKey) pageCache.delete(firstKey);
	}
}

// ---------- extension ----------

export default function browserExtension(pi: ExtensionAPI) {
	// ---- search tool ----
	pi.registerTool({
		name: "search",
		label: "Search",
		description:
			"Search the web for key phrases. Returns a list of search results with titles, URLs, and snippets. " +
			"Use this to find information on the internet when you need to look something up.",
		promptSnippet: "Search the web for information using key phrases",
		promptGuidelines: [
			"Use the search tool to find information on the web before answering questions about current events, facts, or topics you're unsure about.",
			"Search queries should be concise key phrases, not full sentences.",
		],
		parameters: Type.Object({
			query: Type.String({
				description: "Search query - use concise key phrases for best results",
			}),
			max_results: Type.Optional(
				Type.Number({
					description: "Maximum number of results to return (default: 10, max: 20)",
					default: 10,
					minimum: 1,
					maximum: 20,
				}),
			),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const maxResults = Math.min(params.max_results ?? 10, 20);

			try {
				const results = runDdgsSearch(params.query, maxResults);
				const formatted = formatSearchResults(results);

				return {
					content: [{ type: "text", text: formatted }],
					details: {
						query: params.query,
						resultCount: results.length,
						results: results.map((r) => ({ title: r.title, href: r.href })),
					},
				};
			} catch (err: any) {
				throw new Error(`Search failed: ${err.message}`);
			}
		},
	});

	// ---- open tool ----
	pi.registerTool({
		name: "open",
		label: "Open Page",
		description:
			"Open a particular web page and extract its content as markdown. " +
			"Use this to read the full content of a URL you found via search or that the user provided.",
		promptSnippet: "Open a web page and read its content",
		promptGuidelines: [
			"After searching, use open to read the most relevant results in full.",
			"Open one page at a time to avoid overwhelming context.",
		],
		parameters: Type.Object({
			url: Type.String({
				description: "The URL of the page to open and extract content from",
			}),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			try {
				const result = runDdgsExtract(params.url);
				// ddgs extract returns { url, content } or just content string
				const url = result.url || params.url;
				const content = typeof result === "string" ? result : result.content || "";

				if (!content) {
					return {
						content: [
							{
								type: "text",
								text: `No content could be extracted from ${params.url}`,
							},
						],
						details: { url: params.url, contentLength: 0 },
					};
				}

				// Cache for find tool
				cachePage(params.url, content);

				const { text, truncated, totalLength } = truncateContent(
					content,
					MAX_CONTENT_LENGTH,
				);

				let resultText = text;
				if (truncated) {
					// Save full content to temp file
					const tempDir = await mkdtemp(join(tmpdir(), "pi-browser-"));
					const tempFile = join(tempDir, "page.md");
					await writeFile(tempFile, content, "utf8");
					resultText += `\n\n[Content truncated: showing ${text.length} of ${totalLength} characters. Full content saved to: ${tempFile}]`;
				}

				return {
					content: [{ type: "text", text: resultText }],
					details: {
						url,
						contentLength: totalLength,
						truncated,
					},
				};
			} catch (err: any) {
				throw new Error(`Failed to open ${params.url}: ${err.message}`);
			}
		},
	});

	// ---- find tool ----
	pi.registerTool({
		name: "find",
		label: "Find on Page",
		description:
			"Look for specific content on a web page. Searches for a key phrase within a page's content. " +
			"If the page was previously opened with the 'open' tool, it searches the cached content. " +
			"Otherwise, it fetches the page first and then searches within it.",
		promptSnippet: "Search for text within a web page",
		promptGuidelines: [
			"Use find to locate specific information within a long page without re-reading the entire content.",
			"find is more efficient than re-opening a page when you just need to check for a specific term.",
		],
		parameters: Type.Object({
			url: Type.String({
				description: "The URL of the page to search within",
			}),
			phrase: Type.String({
				description: "The key phrase to search for within the page content",
			}),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			let content = getCachedPage(params.url);

			if (!content) {
				try {
					const result = runDdgsExtract(params.url);
					content =
						typeof result === "string" ? result : result.content || "";
					if (content) cachePage(params.url, content);
				} catch (err: any) {
					throw new Error(`Failed to fetch ${params.url}: ${err.message}`);
				}
			}

			if (!content) {
				return {
					content: [
						{
							type: "text",
							text: `No content available from ${params.url} to search.`,
						},
					],
					details: { url: params.url, phrase: params.phrase, matchCount: 0 },
				};
			}

			// Case-insensitive search
			const lowerPhrase = params.phrase.toLowerCase();

			// Find all matches with context
			const matches: { line: number; context: string }[] = [];
			const lines = content.split("\n");

			for (let i = 0; i < lines.length; i++) {
				if (lines[i].toLowerCase().includes(lowerPhrase)) {
					matches.push({
						line: i + 1,
						context: lines[i].trim(),
					});
				}
			}

			if (matches.length === 0) {
				return {
					content: [
						{
							type: "text",
							text: `No occurrences of "${params.phrase}" found on ${params.url}.`,
						},
					],
					details: { url: params.url, phrase: params.phrase, matchCount: 0 },
				};
			}

			// Format matches with surrounding context
			const maxMatches = 50;
			const shown = matches.slice(0, maxMatches);
			let resultText = `Found ${matches.length} occurrence(s) of "${params.phrase}" on ${params.url}:\n\n`;
			resultText += shown
				.map((m) => {
					// Include one line of context before and after if available
					let ctx = "";
					if (m.line > 1 && lines[m.line - 2]?.trim()) {
						ctx += `  L${m.line - 1}: ${lines[m.line - 2].trim()}\n`;
					}
					ctx += `> L${m.line}: ${m.context}\n`;
					if (m.line < lines.length && lines[m.line]?.trim()) {
						ctx += `  L${m.line + 1}: ${lines[m.line].trim()}`;
					}
					return ctx;
				})
				.join("\n\n");

			if (matches.length > maxMatches) {
				resultText += `\n\n[Showing first ${maxMatches} of ${matches.length} matches]`;
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
