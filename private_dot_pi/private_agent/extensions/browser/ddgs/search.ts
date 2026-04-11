/**
 * DuckDuckGo search functionality
 * Uses dependency injection for execFileSync
 */

import { SEARCH_TIMEOUT_MS } from "../constants";
import type { SearchResult } from "../types";

/**
 * Options for running a DDGS search
 */
export interface RunDdgsSearchOptions {
	execFileSync?: (command: string, args: string[], options: object) => string;
}

/**
 * Run ddgs text search via the Python API using `uv run --with ddgs`.
 * Returns parsed JSON results — more reliable than parsing CLI text output.
 */

/**
 * Validate search query is non-empty
 * execFileSync handles argument escaping, so no sanitization needed
 */
function validateSearchQuery(query: string): string {
	if (!query || query.trim().length === 0) {
		throw new Error("Invalid search query: query cannot be empty");
	}
	return query.trim();
}

export function runDdgsSearch(
	query: string,
	maxResults: number = 10,
	options: RunDdgsSearchOptions = {},
): SearchResult[] {
	// Validate maxResults parameter
	if (maxResults < 1 || maxResults > 100) {
		throw new Error(`maxResults must be between 1 and 100, got: ${maxResults}`);
	}

	// Use child_process.execFileSync with argument array (safer than execSync with string interpolation)
	const { execFileSync = require("node:child_process").execFileSync } = options;

	// Validate query (execFileSync handles argument escaping)
	const validatedQuery = validateSearchQuery(query);
	const script = `
import json, sys
from ddgs import DDGS
try:
    results = DDGS().text(${JSON.stringify(validatedQuery)}, max_results=${maxResults})
    print(json.dumps(results))
except Exception as e:
    print(json.dumps({"error": str(e)}), file=sys.stderr)
    sys.exit(1)
`;

	// Execute with error handling for Python failures
	// Pass script via -c flag to avoid shell interpolation
	let output: string;
	try {
		output = execFileSync("uv", ["run", "--with", "ddgs", "python3", "-c", script], {
			encoding: "utf-8",
			timeout: SEARCH_TIMEOUT_MS,
			maxBuffer: 10 * 1024 * 1024, // 10MB buffer for search results
			stdio: ["ignore", "pipe", "pipe"],
		});
		// biome-ignore lint/suspicious/noExplicitAny: execFileSync error has non-standard properties
	} catch (error: any) {
		// Extract stderr for better error messages (subprocess failures)
		const stderr = error.stderr?.toString() || error.message || "Unknown error";

		// Try to parse structured error JSON from Python script
		if (stderr.trim().startsWith("{")) {
			try {
				const errorJson = JSON.parse(stderr.trim());
				if (errorJson.error) {
					throw new Error(`DDGS search failed: ${errorJson.error}`, { cause: error });
				}
			} catch {
				// JSON parse failed, fall through to generic error
			}
		}

		throw new Error(`DDGS search execution failed: ${stderr}`, { cause: error });
	}

	const parsed = JSON.parse(output.trim());
	if (!Array.isArray(parsed)) {
		throw new Error("Unexpected search response format");
	}

	// Filter to valid results (defensive: skip malformed entries)
	return parsed.filter(
		(result): result is SearchResult =>
			typeof result === "object" &&
			result !== null &&
			"title" in result &&
			"href" in result &&
			"body" in result,
	);
}
