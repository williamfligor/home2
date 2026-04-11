/**
 * Search tool implementation
 * Performs web searches using DuckDuckGo
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import type { RunDdgsSearchOptions } from "../ddgs";
import { runDdgsSearch } from "../ddgs";
import { formatSearchResults } from "../utils";

/**
 * Options for the search tool
 */
export interface SearchToolOptions {
	runDdgsSearch?: (
		query: string,
		maxResults?: number,
		options?: RunDdgsSearchOptions,
	) => ReturnType<typeof runDdgsSearch>;
}

/**
 * Register the search tool with the Pi extension API.
 *
 * @param pi - The Pi extension API instance
 * @param options - Optional configuration including mock search function for testing
 */
export function registerSearchTool(pi: ExtensionAPI, options: SearchToolOptions = {}): void {
	const { runDdgsSearch: search = runDdgsSearch } = options;

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

		// Custom rendering to show the search query in the GUI
		renderCall(args, theme, context) {
			const text =
				context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
			let content = theme.fg("toolTitle", theme.bold("search "));
			content += theme.fg("muted", `"${args.query}"`);
			if (args.max_results && args.max_results !== 10) {
				content += theme.fg("dim", ` (${args.max_results} results)`);
			}
			text.setText(content);
			return text;
		},

		async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
			// Check if operation was cancelled
			if (signal?.aborted) {
				throw new Error("Operation cancelled");
			}
			// Validate query is not empty
			if (!params.query?.trim()) {
				throw new Error("Search query cannot be empty");
			}

			const maxResults = Math.min(params.max_results ?? 10, 20);

			try {
				// Note: search() is synchronous and blocks until completion.
				// Cancellation is checked before starting, but cannot interrupt the search itself.
				const results = search(params.query, maxResults);
				const formatted = formatSearchResults(results);
				return {
					content: [{ type: "text", text: formatted }],
					details: {
						query: params.query,
						resultCount: results.length,
						results: results.map((r) => ({ title: r.title, href: r.href })),
					},
				};
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				throw new Error(`Search failed: ${message}`, { cause: err });
			}
		},
	});
}
