/**
 * HTML to markdown conversion using Mozilla Readability + Turndown
 */

// @ts-expect-error - No type declarations for @mozilla/readability shipped with package
import { isProbablyReaderable, Readability } from "@mozilla/readability";
// @ts-expect-error - No type declarations for jsdom shipped with package
import { JSDOM } from "jsdom";
// @ts-expect-error - No type declarations for turndown shipped with package
import TurndownService from "turndown";
import { MAX_HTML_SIZE } from "../constants";

/**
 * Regex patterns for language detection in code blocks
 */
const LANGUAGE_PATTERNS = [/language-(\S+)/, /hljs\s+(\S+)/];

/**
 * Cached Turndown instance for performance (stateless, safe to reuse)
 */
let cachedTurndown: TurndownService | null = null;

/**
 * Create a Turndown instance configured for clean markdown output
 */
export function createTurndown(): TurndownService {
	const td = new TurndownService({
		headingStyle: "atx",
		codeBlockStyle: "fenced",
		bulletListMarker: "-",
		emDelimiter: "*",
		strongDelimiter: "**",
		hr: "---",
	});

	// Preserve <code> inside <pre> cleanly
	td.addRule("fencedCodeBlock", {
		filter: ["pre"],
		replacement(_content, node) {
			const codeEl = node as HTMLElement;
			const code = codeEl.querySelector("code");
			const text = (code ? code.textContent : codeEl.textContent) || "";
			// Try to detect language from class
			let lang = "";
			if (code) {
				const cls = code.className || "";
				for (const pattern of LANGUAGE_PATTERNS) {
					const match = cls.match(pattern);
					if (match) {
						lang = match[1];
						break;
					}
				}
			}
			return `\n\n\`\`\`${lang}\n${text}\n\`\`\`\n\n`;
		},
	});

	// Remove script, style, nav, footer, header elements entirely
	td.addRule("removeNoise", {
		filter: ["script", "style", "nav", "footer", "header", "noscript", "iframe"],
		replacement() {
			return "";
		},
	});

	return td;
}

/**
 * Get cached Turndown instance, creating it if necessary
 */
function getTurndown(): TurndownService {
	if (!cachedTurndown) {
		cachedTurndown = createTurndown();
	}
	return cachedTurndown;
}

/**
 * Extract body content from document, falling back to original HTML
 *
 * @param document - The DOM document to extract from
 * @param fallback - Fallback HTML string if body is not available
 * @returns The innerHTML of the body element, or the fallback string
 */
function getBodyContent(document: Document, fallback: string): string {
	const body = document.body;
	return body ? body.innerHTML : fallback;
}

/**
 * Convert an HTML string to markdown using Mozilla Readability + Turndown.
 * Falls back to raw turndown if Readability can't parse the page.
 *
 * @param html - The HTML string to convert. Must be non-empty and under 1 MB.
 * @param url - The base URL of the HTML document. Used by JSDOM for relative URL resolution.
 * @returns Markdown string with optional metadata header (title/byline)
 * @throws {Error} If html is empty, null, or undefined
 * @throws {Error} If html exceeds maximum size limit (1 MB)
 * @throws {Error} If url is empty, null, or undefined
 * @throws {Error} If JSDOM or Turndown operations fail
 */
export function htmlToMarkdown(html: string, url: string): string {
	// Input validation
	if (!html || typeof html !== "string") {
		throw new Error("html parameter must be a non-empty string");
	}
	if (!url || typeof url !== "string") {
		throw new Error("url parameter must be a non-empty string");
	}

	// Size limit check to prevent DoS
	if (html.length > MAX_HTML_SIZE) {
		throw new Error(`HTML exceeds maximum size limit of ${MAX_HTML_SIZE} bytes`);
	}

	const dom = new JSDOM(html, { url });
	const document = dom.window.document;

	try {
		let contentHtml: string;
		let title = "";
		let byline = "";

		// Only attempt Readability if the page looks like an article
		if (isProbablyReaderable(document)) {
			const reader = new Readability(document);
			const article = reader.parse();

			if (article) {
				contentHtml = article.content;
				title = article.title || "";
				byline = article.byline || "";
			} else {
				// Readability couldn't parse — fall back to whole body
				contentHtml = getBodyContent(document, html);
			}
		} else {
			// Not a reader-friendly page (lists, forms, etc.) — convert whole body
			contentHtml = getBodyContent(document, html);
		}

		// Handle empty content
		if (!contentHtml.trim()) {
			return "*No content extracted from page*";
		}

		const turndown = getTurndown();
		let markdown = turndown.turndown(contentHtml);

		// Prepend metadata header
		const header: string[] = [];
		if (title) header.push(`# ${title}`);
		if (byline) header.push(`*${byline}*`);
		if (header.length > 0 && !markdown.startsWith("# ")) {
			markdown = `${header.join("\n\n")}\n\n${markdown}`;
		}

		return markdown;
	} finally {
		dom.window.close();
	}
}
