/**
 * DuckDuckGo extract functionality
 * Uses dependency injection for execSync
 */

import { EXTRACT_TIMEOUT_MS } from "../constants";
import type { DdgsExtractResult } from "../types";

/**
 * Options for running a DDGS extract
 */
export interface RunDdgsExtractOptions {
	execFileSync?: (command: string, args: string[], options: object) => string;
}

/**
 * Run ddgs extract via the Python API using `uv run --with ddgs`.
 * Returns the parsed extract result: { url, content }.
 */
/**
 * Validate URL to prevent command injection
 * Throws if URL is invalid
 */
function _validateUrl(url: string): URL {
	try {
		return new URL(url);
	} catch {
		throw new Error(`Invalid URL format: ${url}`);
	}
}
export function runDdgsExtract(
	url: string,
	options: RunDdgsExtractOptions = {},
): DdgsExtractResult {
	// Validate URL before use
	const validatedUrl = _validateUrl(url);
	if (validatedUrl.protocol !== "http:" && validatedUrl.protocol !== "https:") {
		throw new Error("Only HTTP/HTTPS URLs are supported");
	}

	const { execFileSync = require("node:child_process").execFileSync } = options;
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

	const output = execFileSync("uv", ["run", "--with", "ddgs", "python3", "-c", script], {
		encoding: "utf-8",
		timeout: EXTRACT_TIMEOUT_MS,
		maxBuffer: 50 * 1024 * 1024, // 50MB - max extract output size
		stdio: ["ignore", "pipe", "pipe"],
	});
	const parsed = JSON.parse(output.trim()) as DdgsExtractResult;
	if (parsed.error) {
		throw new Error(parsed.error);
	}
	// Validate content field exists
	if (!parsed.content) {
		throw new Error("Extract returned no content");
	}
	return parsed;
}
