/**
 * Tests for formatter utilities
 * Pure functions - no mocks needed
 */

import { describe, expect, it } from "bun:test";
import { formatSearchResults, truncateContent } from "./formatter";

describe("formatSearchResults", () => {
	it("formats empty results correctly", () => {
		const results = [];
		const formatted = formatSearchResults(results);
		expect(formatted).toBe("No search results found.");
	});

	it("formats single result correctly", () => {
		const results = [
			{
				title: "Test Page",
				href: "https://example.com/test",
				body: "This is a test description",
			},
		];
		const formatted = formatSearchResults(results);
		expect(formatted).toContain("[1] Test Page");
		expect(formatted).toContain("URL: https://example.com/test");
		expect(formatted).toContain("This is a test description");
	});

	it("formats multiple results correctly", () => {
		const results = [
			{ title: "Result 1", href: "https://example.com/1", body: "Body 1" },
			{ title: "Result 2", href: "https://example.com/2", body: "Body 2" },
			{ title: "Result 3", href: "https://example.com/3", body: "Body 3" },
		];
		const formatted = formatSearchResults(results);
		expect(formatted).toContain("[1] Result 1");
		expect(formatted).toContain("[2] Result 2");
		expect(formatted).toContain("[3] Result 3");
		expect(formatted).toContain("Body 1");
		expect(formatted).toContain("Body 2");
		expect(formatted).toContain("Body 3");
	});

	it("handles results without body", () => {
		const results = [{ title: "No Body", href: "https://example.com" }];
		const formatted = formatSearchResults(results);
		expect(formatted).toContain("[1] No Body");
		expect(formatted).toContain("URL: https://example.com");
		// URL is always included, so there will be \n
	});

	it("handles results without title", () => {
		const results = [{ href: "https://example.com", body: "Body" }];
		const formatted = formatSearchResults(results);
		expect(formatted).toContain("[1] undefined");
		expect(formatted).toContain("URL: https://example.com");
		expect(formatted).toContain("Body");
	});

	it("handles results without href", () => {
		const results = [{ title: "No Href", body: "Body" }];
		const formatted = formatSearchResults(results);
		expect(formatted).toContain("[1] No Href");
		expect(formatted).toContain("URL: undefined");
		expect(formatted).toContain("Body");
	});
});

describe("truncateContent", () => {
	it("returns content unchanged when under limit", () => {
		const content = "Short content";
		const result = truncateContent(content, 100);
		expect(result.text).toBe(content);
		expect(result.truncated).toBe(false);
		expect(result.totalLength).toBe(content.length);
	});

	it("returns content unchanged when exactly at limit", () => {
		const content = "Exactly 10 chars";
		const result = truncateContent(content, 16); // content.length = 16
		expect(result.text).toBe(content);
		expect(result.truncated).toBe(false);
		expect(result.totalLength).toBe(content.length);
	});

	it("truncates content when over limit", () => {
		const content = "A".repeat(200);
		const result = truncateContent(content, 100);
		expect(result.truncated).toBe(true);
		expect(result.totalLength).toBe(200);
		expect(result.text.length).toBeLessThanOrEqual(100);
	});

	it("truncates at paragraph boundary", () => {
		const content = "Paragraph 1.\n\nParagraph 2.\n\nParagraph 3.\n\nParagraph 4.";
		const result = truncateContent(content, 30);
		expect(result.truncated).toBe(true);
		// Should end at a paragraph boundary
		expect(result.text).toBe("Paragraph 1.\n\nParagraph 2.");
	});

	it("handles empty content", () => {
		const result = truncateContent("", 100);
		expect(result.text).toBe("");
		expect(result.truncated).toBe(false);
		expect(result.totalLength).toBe(0);
	});

	it("handles single paragraph longer than limit", () => {
		const content = "A".repeat(200);
		const result = truncateContent(content, 100);
		expect(result.truncated).toBe(true);
		expect(result.text.length).toBeLessThanOrEqual(100);
	});
});
