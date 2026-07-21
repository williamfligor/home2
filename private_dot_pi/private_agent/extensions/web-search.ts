/**
 * web-search — DuckDuckGo web search via ddgs (Python), gated by /web-on /web-off.
 *
 * Depends on `uv` being installed (for `uv run --with ddgs`).
 * No API keys. No puppeteer. No heavy deps beyond what Pi already ships.
 *
 * The tool registers with the shared web-gate so it only activates after /web-on.
 */

import { execFileSync } from "node:child_process";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "typebox";
import { registerWebGate } from "./web-gate";

// ── types ──

interface SearchResult {
	title: string;
	href: string;
	body: string;
}

// ── constants ──

const SEARCH_TIMEOUT_MS = 30_000;

// ── helpers ──

function formatSearchResults(results: SearchResult[]): string {
	if (results.length === 0) return "No search results found.";

	return results
		.map(
			(r, i) =>
				`[${i + 1}] ${r.title}\n    URL: ${r.href}${r.body ? `\n    ${r.body}` : ""}`,
		)
		.join("\n\n");
}

// ── DuckDuckGo search via ddgs Python CLI ──

function runDdgsSearch(query: string, maxResults = 10): SearchResult[] {
	if (maxResults < 1 || maxResults > 100) {
		throw new Error(`maxResults must be 1–100, got ${maxResults}`);
	}
	if (!query.trim()) throw new Error("Search query cannot be empty");

	const script = `
import json, sys
from ddgs import DDGS
try:
    results = DDGS().text(${JSON.stringify(query.trim())}, max_results=${maxResults})
    print(json.dumps(results))
except Exception as e:
    print(json.dumps({"error": str(e)}), file=sys.stderr)
    sys.exit(1)
`;

	let output: string;
	try {
		output = execFileSync(
			"uv",
			["run", "--python", ">3.10", "--with", "ddgs", "python3", "-c", script],
			{ encoding: "utf-8", timeout: SEARCH_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
		);
	} catch (error: any) {
		const stderr = error.stderr?.toString() || error.message || "Unknown error";
		throw new Error(`DDGS search failed: ${stderr}`, { cause: error });
	}

	const parsed = JSON.parse(output.trim());
	if (!Array.isArray(parsed)) throw new Error("Unexpected search response format");

	return parsed.filter(
		(r: any): r is SearchResult =>
			typeof r === "object" && r !== null && "title" in r && "href" in r && "body" in r,
	);
}

// ── register the tool ──

function registerSearchTool(pi: ExtensionAPI) {
	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description:
			"Search the web for key phrases. Returns a list of search results with titles, URLs, and snippets. " +
			"Use this to find information on the internet when you need to look something up.",
		promptSnippet: "Search the web for information using key phrases",
		promptGuidelines: [
			"Use web_search to find information on the web before answering questions about current events, facts, or topics you're unsure about.",
			"Search queries should be concise key phrases, not full sentences.",
			"Use web_search for web searches only, not for searching local files.",
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

		renderCall(args, theme, context) {
			const t = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
			let s = theme.fg("toolTitle", theme.bold("web_search "));
			s += theme.fg("muted", `"${args.query}"`);
			if (args.max_results && args.max_results !== 10) {
				s += theme.fg("dim", ` (${args.max_results} results)`);
			}
			t.setText(s);
			return t;
		},

		renderResult(result, { expanded, isPartial }, theme, context) {
			const t = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);

			if (isPartial) {
				t.setText(theme.fg("warning", "Searching the web..."));
				return t;
			}

			const d = (result.details ?? {}) as { query?: string; resultCount?: number };

			if (!expanded) {
				const q = (d.query ?? "").length > 60 ? `${d.query.slice(0, 57)}...` : d.query ?? "";
				let s = theme.fg("success", "✓ ");
				s += theme.fg("muted", `${d.resultCount ?? 0} result(s)`);
				if (q) s += theme.fg("dim", ` for "${q}"`);
				s += theme.fg("dim", " — Ctrl-o for full output");
				t.setText(s);
				return t;
			}

			for (const item of result.content ?? []) {
				if (item.type === "text" && typeof item.text === "string") {
					t.setText(item.text);
					return t;
				}
			}
			t.setText(theme.fg("dim", "(no output)"));
			return t;
		},

		async execute(_id, params, signal, _onUpdate, _ctx) {
			if (signal?.aborted) throw new Error("Operation cancelled");

			const results = runDdgsSearch(params.query, Math.min(params.max_results ?? 10, 20));
			const formatted = formatSearchResults(results);

			return {
				content: [{ type: "text", text: formatted }],
				details: {
					query: params.query,
					resultCount: results.length,
					results: results.map((r) => ({ title: r.title, href: r.href })),
				},
			};
		},
	});
}

// ── extension entry ──

export default function (pi: ExtensionAPI) {
	registerSearchTool(pi);
	registerWebGate(pi, "web_search");
	registerWebGate(pi, "web_fetch");   // from pi-smart-fetch
	registerWebGate(pi, "batch_web_fetch");
}
