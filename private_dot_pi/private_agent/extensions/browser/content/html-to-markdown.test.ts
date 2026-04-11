/**
 * Tests for HTML to markdown conversion
 * Pure functions - no mocks needed
 */

import { describe, expect, it } from "bun:test";
import { createTurndown, htmlToMarkdown } from "./html-to-markdown";

describe("createTurndown", () => {
	it("creates turndown instance with correct defaults", () => {
		const turndown = createTurndown();
		expect(turndown).toBeDefined();
		expect(typeof turndown.turndown).toBe("function");
	});

	it("converts simple HTML to markdown", () => {
		const turndown = createTurndown();
		const html = "<h1>Title</h1><p>Paragraph</p>";
		const markdown = turndown.turndown(html);
		expect(markdown).toContain("# Title");
		expect(markdown).toContain("Paragraph");
	});

	it("converts code blocks with language detection", () => {
		const turndown = createTurndown();
		const html = '<pre><code class="language-js">console.log("hello")</code></pre>';
		const markdown = turndown.turndown(html);
		expect(markdown).toContain("```js");
		expect(markdown).toContain('console.log("hello")');
		expect(markdown).toContain("```");
	});

	it("removes script tags", () => {
		const turndown = createTurndown();
		const html = "<p>Before</p><script>alert('xss')</script><p>After</p>";
		const markdown = turndown.turndown(html);
		expect(markdown).toContain("Before");
		expect(markdown).toContain("After");
		expect(markdown).not.toContain("alert");
		expect(markdown).not.toContain("script");
	});

	it("removes style tags", () => {
		const turndown = createTurndown();
		const html = "<p>Text</p><style>.class { color: red; }</style><p>More</p>";
		const markdown = turndown.turndown(html);
		expect(markdown).toContain("Text");
		expect(markdown).toContain("More");
		expect(markdown).not.toContain("color: red");
	});

	it("removes nav tags", () => {
		const turndown = createTurndown();
		const html = "<nav><a href='/'>Home</a></nav><p>Content</p>";
		const markdown = turndown.turndown(html);
		expect(markdown).toContain("Content");
		expect(markdown).not.toContain("<nav");
	});

	it("removes footer tags", () => {
		const turndown = createTurndown();
		const html = "<p>Content</p><footer>Copyright 2024</footer>";
		const markdown = turndown.turndown(html);
		expect(markdown).toContain("Content");
		expect(markdown).not.toContain("Copyright");
	});

	it("removes header tags", () => {
		const turndown = createTurndown();
		const html = "<header>Site Header</header><p>Content</p>";
		const markdown = turndown.turndown(html);
		expect(markdown).toContain("Content");
		expect(markdown).not.toContain("Site Header");
	});

	it("handles lists correctly", () => {
		const turndown = createTurndown();
		const html = "<ul><li>Item 1</li><li>Item 2</li></ul>";
		const markdown = turndown.turndown(html);
		expect(markdown).toContain("-   Item 1");
		expect(markdown).toContain("-   Item 2");
	});

	it("handles links correctly", () => {
		const turndown = createTurndown();
		const html = '<a href="https://example.com">Link</a>';
		const markdown = turndown.turndown(html);
		expect(markdown).toContain("[Link](https://example.com)");
	});
});

describe("htmlToMarkdown", () => {
	it("converts simple HTML page", () => {
		const html = `
			<!DOCTYPE html>
			<html>
			<head><title>Test Page</title></head>
			<body>
				<h1>Main Title</h1>
				<p>This is a paragraph.</p>
			</body>
			</html>
		`;
		const markdown = htmlToMarkdown(html, "https://example.com");
		expect(markdown).toContain("Main Title");
		expect(markdown).toContain("This is a paragraph");
	});

	it("extracts title from HTML when readerable", () => {
		// Create a readerable article with proper structure
		const html = `
			<!DOCTYPE html>
			<html>
			<head><title>My Article Title</title></head>
			<body>
				<article>
					<h1>My Article Title</h1>
					<p>Content here</p>
					<p>More content</p>
				</article>
			</body>
			</html>
		`;
		const markdown = htmlToMarkdown(html, "https://example.com");
		expect(markdown).toContain("# My Article Title");
		expect(markdown).toContain("Content here");
	});

	it("handles HTML with no title", () => {
		const html = `
			<!DOCTYPE html>
			<html>
			<body>
				<p>Content without title</p>
			</body>
			</html>
		`;
		const markdown = htmlToMarkdown(html, "https://example.com");
		expect(markdown).toContain("Content without title");
	});

	it("throws on empty HTML", () => {
		// Per documented behavior: html parameter must be a non-empty string
		expect(() => htmlToMarkdown("", "https://example.com")).toThrow(
			"html parameter must be a non-empty string",
		);
	});

	it("handles HTML with special characters", () => {
		const html = `
			<!DOCTYPE html>
			<html>
			<body>
				<p>Special chars: &lt; &gt; &amp; &quot;</p>
			</body>
			</html>
		`;
		const markdown = htmlToMarkdown(html, "https://example.com");
		expect(markdown).toContain("<");
		expect(markdown).toContain(">");
		expect(markdown).toContain("&");
	});

	it("handles HTML with unicode", () => {
		const html = `
			<!DOCTYPE html>
			<html>
			<body>
				<p>Unicode: 你好 🎉 مرحبا</p>
			</body>
			</html>
		`;
		const markdown = htmlToMarkdown(html, "https://example.com");
		expect(markdown).toContain("你好");
		expect(markdown).toContain("🎉");
	});

	it("handles HTML with code blocks", () => {
		const html = `
			<!DOCTYPE html>
			<html>
			<body>
				<pre><code class="language-python">print("hello")</code></pre>
			</body>
			</html>
		`;
		const markdown = htmlToMarkdown(html, "https://example.com");
		expect(markdown).toContain("```python");
		expect(markdown).toContain('print("hello")');
		expect(markdown).toContain("```");
	});

	it("handles HTML without doctype", () => {
		const html = "<html><body><p>Simple HTML</p></body></html>";
		const markdown = htmlToMarkdown(html, "https://example.com");
		expect(markdown).toContain("Simple HTML");
	});

	it("handles just body content", () => {
		const html = "<p>Just a paragraph</p>";
		const markdown = htmlToMarkdown(html, "https://example.com");
		expect(markdown).toContain("Just a paragraph");
	});
});
