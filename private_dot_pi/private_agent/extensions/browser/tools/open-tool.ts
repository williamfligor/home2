/**
 * Open tool implementation
 * Extracts content from a URL and returns it as markdown
 */

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

import { MAX_CONTENT_LENGTH } from "../constants";
import type { ExtractContentOptions } from "../content";
import { extractContent } from "../content";
import type { PageCache } from "../types";
import { truncateContent } from "../utils";

/**
 * Options for the open tool
 */
export interface OpenToolOptions {
	extractContent?: (
		url: string,
		options?: ExtractContentOptions,
	) => Promise<ReturnType<typeof extractContent>>;
	cache: PageCache;
	cloneManager?: import("../github").CloneManager;
	tempTracker?: import("../utils").TempDirTracker;
}

/**
 * Register the open tool with the Pi extension API
 */
export function registerOpenTool(pi: ExtensionAPI, options: OpenToolOptions): void {
	const { extractContent: extract = extractContent, cache, cloneManager, tempTracker } = options;

	pi.registerTool({
		name: "open",
		label: "Open Page",
		description:
			"Open a particular web page and extract its content as markdown (reader mode). " +
			"Supports HTML pages (via Mozilla Readability + Turndown), PDFs (via pdf-parse), and GitHub URLs. " +
			"For GitHub URLs, the repo is cloned locally so you can explore it with read and bash. " +
			"Use this to read the full content of a URL you found via search or that the user provided.",
		promptSnippet: "Open a web page and read its content",
		promptGuidelines: [
			"After searching, use open to read the most relevant results in full.",
			"Open one page at a time to avoid overwhelming context.",
			"PDFs are supported — paste a .pdf URL directly.",
			"GitHub URLs are cloned locally — use the returned local path with read and bash to explore.",
			"For large GitHub repos (>350MB), a lightweight API view is returned. Use forceClone:true to override.",
		],
		parameters: Type.Object({
			url: Type.String({
				description: "The URL of the page to open and extract content from",
			}),
			forceClone: Type.Optional(
				Type.Boolean({
					description:
						"Forces a full git clone for GitHub URLs even if the repo exceeds the 350MB size threshold. Default: false.",
				}),
			),
		}),

		// Custom rendering to show the URL in the GUI
		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			let content = theme.fg("toolTitle", theme.bold("open "));
			// Truncate long URLs for display
			const displayUrl = args.url.length > 50 ? `...${args.url.slice(-47)}` : args.url;
			content += theme.fg("muted", displayUrl);
			text.setText(content);
			return text;
		},

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			// Validate URL
			let parsedUrl: URL;
			try {
				parsedUrl = new URL(params.url);
			} catch {
				throw new Error(`Invalid URL: ${params.url}`);
			}
			// Validate URL scheme - only allow http and https
			if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
				throw new Error(
					`Unsupported URL scheme: ${parsedUrl.protocol}. Only http:// and https:// are allowed.`,
				);
			}
			// Check for cancellation before extraction
			if (_signal?.aborted) {
				throw new Error("Operation cancelled");
			}
			const result = await extract(params.url, {
				forceClone: params.forceClone,
				cloneManager,
			});

			const { content, finalUrl, method } = result;
			if (!content) {
				return {
					content: [
						{
							type: "text",
							text: `No content could be extracted from ${params.url}`,
						},
					],
					details: { url: params.url, contentLength: 0, method },
				};
			}
			// Cache for find tool
			cache.set(params.url, content);
			const { text, truncated, totalLength } = truncateContent(content, MAX_CONTENT_LENGTH);
			let resultText = text;
			if (truncated) {
				// Save full content to temp file
				const tempDir = await mkdtemp(join(tmpdir(), "pi-browser-"));
				tempTracker?.add(tempDir);
				const tempFile = join(tempDir, "page.md");
				await writeFile(tempFile, content, "utf8");
				resultText += `\n\n[Content truncated: showing ${text.length} of ${totalLength} characters. Full content saved to: ${tempFile}]`;
			}
			// If result has localPath, append note
			if (result.localPath) {
				resultText += `\n\n---\n**Local clone:** ${result.localPath}\nYou can use \`read\` and \`bash\` to explore this repo locally.`;
			}

			return {
				content: [{ type: "text", text: resultText }],
				details: {
					url: finalUrl,
					contentLength: totalLength,
					truncated,
					method,
				},
			};
		},
	});
}
