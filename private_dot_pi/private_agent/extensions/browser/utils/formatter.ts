/**
 * Formatter utilities for search results and content
 */

import type { SearchResult, TruncateResult } from "../types";

/**
 * Format search results into a readable string
 */
export function formatSearchResults(results: SearchResult[]): string {
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

/**
 * Truncate content at a paragraph or sentence boundary if possible
 */
export function truncateContent(content: string, maxLen: number): TruncateResult {
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
