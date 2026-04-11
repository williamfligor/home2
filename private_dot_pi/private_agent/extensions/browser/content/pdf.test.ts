/**
 * Tests for PDF to markdown conversion
 * Uses mocked PDF parser
 */

import { describe, expect, it, mock } from "bun:test";
import { pdfBufferToMarkdown } from "./pdf";

describe("pdfBufferToMarkdown", () => {
	it("converts PDF text to markdown", async () => {
		const mockParser = mock(async () => ({
			text: "Sample PDF content\n\nThis is a paragraph.",
			info: { total: 1 },
		}));

		const markdown = await pdfBufferToMarkdown(Buffer.from("%PDF-1.4 fake"), {
			createParser: mockParser,
		});

		expect(markdown).toContain("Sample PDF content");
		expect(markdown).toContain("This is a paragraph");
	});

	it("extracts title from metadata", async () => {
		const mockParser = mock(async () => ({
			text: "Content here",
			info: { info: { Title: "My PDF Title" }, total: 5 },
		}));

		const markdown = await pdfBufferToMarkdown(Buffer.from("%PDF-1.4 fake"), {
			createParser: mockParser,
		});

		expect(markdown).toContain("# My PDF Title");
	});

	it("extracts author from metadata", async () => {
		const mockParser = mock(async () => ({
			text: "Content here",
			info: { info: { Author: "John Doe" }, total: 1 },
		}));

		const markdown = await pdfBufferToMarkdown(Buffer.from("%PDF-1.4 fake"), {
			createParser: mockParser,
		});

		expect(markdown).toContain("*John Doe*");
	});

	it("extracts page count from metadata", async () => {
		const mockParser = mock(async () => ({
			text: "Content here",
			info: { total: 10 },
		}));

		const markdown = await pdfBufferToMarkdown(Buffer.from("%PDF-1.4 fake"), {
			createParser: mockParser,
		});

		expect(markdown).toContain("*10 pages*");
	});

	it("handles empty PDF", async () => {
		const mockParser = mock(async () => ({
			text: "",
			info: {},
		}));

		const markdown = await pdfBufferToMarkdown(Buffer.from("%PDF-1.4 fake"), {
			createParser: mockParser,
		});

		expect(markdown).toBe("");
	});

	it("handles whitespace-only PDF", async () => {
		const mockParser = mock(async () => ({
			text: "   \n\n   ",
			info: {},
		}));

		const markdown = await pdfBufferToMarkdown(Buffer.from("%PDF-1.4 fake"), {
			createParser: mockParser,
		});

		expect(markdown).toBe("");
	});

	it("preserves paragraph structure", async () => {
		const mockParser = mock(async () => ({
			text: "First paragraph.\n\nSecond paragraph.\n\nThird paragraph.",
			info: {},
		}));

		const markdown = await pdfBufferToMarkdown(Buffer.from("%PDF-1.4 fake"), {
			createParser: mockParser,
		});

		expect(markdown).toContain("First paragraph");
		expect(markdown).toContain("Second paragraph");
		expect(markdown).toContain("Third paragraph");
		expect(markdown).toContain("\n\n"); // Paragraph breaks preserved
	});

	it("detects headings from short lines", async () => {
		const mockParser = mock(async () => ({
			text: "Introduction\n\nThis is the intro text.\n\nConclusion\n\nThis is the conclusion.",
			info: {},
		}));

		const markdown = await pdfBufferToMarkdown(Buffer.from("%PDF-1.4 fake"), {
			createParser: mockParser,
		});

		expect(markdown).toContain("## Introduction");
		expect(markdown).toContain("## Conclusion");
	});

	it("handles PDF with all metadata", async () => {
		const mockParser = mock(async () => ({
			text: "Content",
			info: {
				info: { Title: "Full Title", Author: "Full Author" },
				total: 25,
			},
		}));

		const markdown = await pdfBufferToMarkdown(Buffer.from("%PDF-1.4 fake"), {
			createParser: mockParser,
		});

		expect(markdown).toContain("# Full Title");
		expect(markdown).toContain("*Full Author*");
		expect(markdown).toContain("*25 pages*");
		expect(markdown).toContain("---"); // Separator before body
	});

	it("handles PDF without metadata", async () => {
		const mockParser = mock(async () => ({
			text: "Just content, no metadata",
			info: undefined,
		}));

		const markdown = await pdfBufferToMarkdown(Buffer.from("%PDF-1.4 fake"), {
			createParser: mockParser,
		});

		expect(markdown).toContain("Just content, no metadata");
		expect(markdown).not.toContain("---"); // No separator if no metadata
	});

	it("handles multiline paragraphs", async () => {
		const mockParser = mock(async () => ({
			text: "This is a long paragraph that spans\nmultiple lines in the PDF\nbut should be joined together.",
			info: {},
		}));

		const markdown = await pdfBufferToMarkdown(Buffer.from("%PDF-1.4 fake"), {
			createParser: mockParser,
		});

		expect(markdown).toContain("This is a long paragraph that spans");
		expect(markdown).toContain("multiple lines in the PDF");
		expect(markdown).toContain("but should be joined together");
	});

	it("handles unicode content", async () => {
		const mockParser = mock(async () => ({
			text: "Unicode: 你好 🎉 مرحبا",
			info: {},
		}));

		const markdown = await pdfBufferToMarkdown(Buffer.from("%PDF-1.4 fake"), {
			createParser: mockParser,
		});

		expect(markdown).toContain("你好");
		expect(markdown).toContain("🎉");
		expect(markdown).toContain("مرحبا");
	});

	it("handles special characters", async () => {
		const mockParser = mock(async () => ({
			text: "Special: < > & \" '",
			info: {},
		}));

		const markdown = await pdfBufferToMarkdown(Buffer.from("%PDF-1.4 fake"), {
			createParser: mockParser,
		});

		expect(markdown).toContain("<");
		expect(markdown).toContain(">");
		expect(markdown).toContain("&");
	});

	it("throws on empty buffer", async () => {
		expect(
			pdfBufferToMarkdown(Buffer.alloc(0), {
				createParser: mock(async () => ({ text: "x", info: {} })),
			}),
		).rejects.toThrow("Invalid PDF buffer");
	});

	it("throws on non-Buffer input", async () => {
		expect(pdfBufferToMarkdown("not a buffer" as unknown as Buffer)).rejects.toThrow(
			"Invalid PDF buffer",
		);
	});

	it("throws on buffer without PDF magic number", async () => {
		expect(pdfBufferToMarkdown(Buffer.from("not a pdf"))).rejects.toThrow("%PDF-");
	});

	it("rethrows when parser throws", async () => {
		const mockParser = mock(async () => {
			throw new Error("corrupted PDF");
		});

		await expect(
			pdfBufferToMarkdown(Buffer.from("%PDF-1.4 fake"), {
				createParser: mockParser,
			}),
		).rejects.toThrow("corrupted PDF");
	});

	it("truncates content exceeding MAX_CONTENT_LENGTH", async () => {
		const longText = "A".repeat(100_000);
		const mockParser = mock(async () => ({
			text: longText,
			info: {},
		}));

		const markdown = await pdfBufferToMarkdown(Buffer.from("%PDF-1.4 fake"), {
			createParser: mockParser,
		});

		expect(markdown.length).toBeLessThan(100_000);
		expect(markdown).toContain("Content truncated");
	});
});
