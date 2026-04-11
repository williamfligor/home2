/**
 * PDF to markdown conversion
 * Uses dependency injection for the PDF parser
 */

// @ts-expect-error — pdf-parse lacks proper TypeScript definitions
import { PDFParse } from "pdf-parse";
import { MAX_CONTENT_LENGTH, MAX_PDF_SIZE } from "../constants.js";

/**
 * Metadata returned by the PDF parser
 */
interface PdfInfo {
	info?: {
		Title?: string;
		Author?: string;
	};
	total?: number;
}

/**
 * Options for PDF to markdown conversion
 */
export interface PdfToMarkdownOptions {
	createParser?: (buffer: Buffer) => Promise<{ text: string; info?: PdfInfo }>;
}

/**
 * Default PDF parser implementation using pdf-parse
 */
async function defaultCreateParser(buf: Buffer): Promise<{
	text: string;
	info?: PdfInfo;
}> {
	const parser = new PDFParse({ data: new Uint8Array(buf) });
	const result = await parser.getText();
	const info = await parser.getInfo();
	return { text: result.text || "", info };
}

/**
 * Extract text from a PDF Buffer and format as markdown.
 * Includes metadata (title, author) as a header when available.
 *
 * @param buffer - Non-empty Buffer containing PDF data
 * @param options - Optional parser override for testing
 * @returns Markdown string, or empty string if no text content
 * @throws Error if buffer is invalid or not a PDF
 */
export async function pdfBufferToMarkdown(
	buffer: Buffer,
	options: PdfToMarkdownOptions = {},
): Promise<string> {
	// Validate buffer
	if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
		throw new Error("Invalid PDF buffer: must be a non-empty Buffer");
	}

	// Validate PDF magic number
	if (buffer.toString("ascii", 0, 5) !== "%PDF-") {
		throw new Error("Invalid PDF: file does not start with %PDF- magic number");
	}

	// Validate PDF size to prevent DoS
	if (buffer.length > MAX_PDF_SIZE) {
		throw new Error(`PDF exceeds maximum size limit of ${MAX_PDF_SIZE / (1024 * 1024)}MB`);
	}

	const { createParser = defaultCreateParser } = options;

	let rawText: string;
	let info: PdfInfo | undefined;
	try {
		const result = await createParser(buffer);
		rawText = result.text;
		info = result.info;
	} catch (error) {
		throw new Error(
			`Failed to parse PDF: ${error instanceof Error ? error.message : String(error)}`,
			{ cause: error },
		);
	}

	if (!rawText.trim()) {
		return "";
	}

	// Try to extract metadata for a header
	const header: string[] = [];
	if (info) {
		const title = info.info?.Title?.trim();
		const author = info.info?.Author?.trim();
		if (title) header.push(`# ${title}`);
		if (author) header.push(`*${author}*`);
		const pages = info.total;
		if (pages) header.push(`*${pages} pages*`);
	}

	// Basic formatting: try to preserve paragraph structure
	// pdf-parse returns text with line breaks within pages; we normalize
	const lines = rawText.split("\n");
	const paragraphs: string[] = [];
	let currentParagraph = "";

	for (const line of lines) {
		const trimmed = line.trim();

		if (trimmed === "") {
			// Blank line = paragraph break
			if (currentParagraph) {
				paragraphs.push(currentParagraph);
				currentParagraph = "";
			}
		} else if (
			// Heuristic: a short line (under 60 chars) not ending with punctuation
			// is likely a heading. Note: this is simplistic and may misidentify
			// bullet points, dates, or code snippets as headings.
			trimmed.length < 60 &&
			!/[.!?,;:]$/.test(trimmed) &&
			currentParagraph === ""
		) {
			paragraphs.push(`## ${trimmed}`);
		} else {
			// Continuation of a paragraph — join with space
			currentParagraph += (currentParagraph ? " " : "") + trimmed;
		}
	}

	if (currentParagraph) {
		paragraphs.push(currentParagraph);
	}

	let result: string;
	const body = paragraphs.join("\n\n");
	if (header.length > 0) {
		result = `${header.join("\n\n")}\n\n---\n\n${body}`;
	} else {
		result = body;
	}

	// Enforce character limit
	if (result.length > MAX_CONTENT_LENGTH) {
		result = result.slice(0, MAX_CONTENT_LENGTH);
		result += `\n\n---\n*Content truncated at ${MAX_CONTENT_LENGTH} characters*`;
	}

	return result;
}
