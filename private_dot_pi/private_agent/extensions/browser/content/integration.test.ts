/**
 * Integration tests for content extraction pipeline
 * Tests full pipelines with realistic data (not mocked)
 */

import { describe, expect, it } from "bun:test";
import { htmlToMarkdown } from "./html-to-markdown";
import { pdfBufferToMarkdown } from "./pdf";

describe("html-to-markdown integration", () => {
	it("handles a complete realistic HTML document", () => {
		const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Complete Article Example</title>
    <style>
        .sidebar { display: none; }
        .ad-banner { position: absolute; }
    </style>
</head>
<body>
    <header>
        <nav>
            <a href="/">Home</a>
            <a href="/about">About</a>
        </nav>
    </header>
    <main>
        <article>
            <h1>Understanding Integration Testing</h1>
            <p class="author">By Jane Doe</p>
            <p class="date">Published: 2024-01-15</p>
            
            <h2>Introduction</h2>
            <p>Integration testing is a crucial part of software development that tests how different components work together.</p>
            
            <h2>Key Concepts</h2>
            <ul>
                <li>Unit tests verify individual components</li>
                <li>Integration tests verify component interactions</li>
                <li>E2E tests verify complete workflows</li>
            </ul>
            
            <h3>Example Code</h3>
            <pre><code class="language-typescript">
describe("integration", () => {
    it("works", () => {
        expect(true).toBe(true);
    });
});
            </code></pre>
            
            <h2>Conclusion</h2>
            <p>Integration tests help catch issues that unit tests might miss.</p>
        </article>
    </main>
    <footer>
        <p>Copyright 2024</p>
    </footer>
    <script>
        // Should be removed
        console.log("tracking code");
    </script>
</body>
</html>`;

		const markdown = htmlToMarkdown(html, "https://example.com/article");

		// Should contain article content
		expect(markdown).toContain("Understanding Integration Testing");
		expect(markdown).toContain("Integration testing is a crucial part");
		expect(markdown).toContain("Unit tests verify individual components");
		expect(markdown).toContain('describe("integration"');

		// Should have proper markdown structure
		expect(markdown).toContain("# Understanding Integration Testing");
		expect(markdown).toContain("## Introduction");
		expect(markdown).toContain("## Key Concepts");
		expect(markdown).toContain("### Example Code");
		expect(markdown).toContain("## Conclusion");

		// Should remove navigation, footer, scripts
		expect(markdown).not.toContain("<nav");
		expect(markdown).not.toContain("<footer");
		expect(markdown).not.toContain("Copyright 2024");
		expect(markdown).not.toContain("tracking code");
		expect(markdown).not.toContain("console.log");
	});

	it("handles complex nested HTML structures", () => {
		const html = `
<html>
<body>
    <div class="content">
        <table>
            <thead>
                <tr><th>Name</th><th>Value</th></tr>
            </thead>
            <tbody>
                <tr><td>Key1</td><td>Value1</td></tr>
                <tr><td>Key2</td><td>Value2</td></tr>
            </tbody>
        </table>
        <blockquote>
            <p>This is a quoted paragraph with <strong>bold</strong> and <em>italic</em> text.</p>
        </blockquote>
        <div class="nested">
            <div class="deeper">
                <p>Deeply nested content</p>
            </div>
        </div>
    </div>
</body>
</html>`;

		const markdown = htmlToMarkdown(html, "https://example.com/complex");

		expect(markdown).toContain("Name");
		expect(markdown).toContain("Value");
		expect(markdown).toContain("Key1");
		expect(markdown).toContain("This is a quoted paragraph");
		expect(markdown).toContain("Deeply nested content");
	});

	it("handles HTML with mixed content types", () => {
		const html = `
<html>
<body>
    <h1>Mixed Content Page</h1>
    <p>Text with <a href="https://example.com">inline link</a> and <code>inline code</code>.</p>
    <ul>
        <li>Item with <strong>bold</strong></li>
        <li>Item with <em>italic</em></li>
        <li>Item with <a href="https://test.com">link</a></li>
    </ul>
    <ol>
        <li>First item</li>
        <li>Second item</li>
    </ol>
    <hr>
    <p>After horizontal rule</p>
</body>
</html>`;

		const markdown = htmlToMarkdown(html, "https://example.com/mixed");

		expect(markdown).toContain("# Mixed Content Page");
		expect(markdown).toContain("[inline link](https://example.com)");
		expect(markdown).toContain("First item");
		expect(markdown).toContain("After horizontal rule");
	});

	it("handles malformed HTML gracefully", () => {
		const html = `
<html>
<body>
    <h1>Unclosed Heading
    <p>Paragraph without closing tag
    <div>Mismatched <span>tags</div>
    </p>
</body>`;

		// Should not throw
		const markdown = htmlToMarkdown(html, "https://example.com/malformed");
		expect(markdown).toBeDefined();
		expect(markdown).toContain("Unclosed Heading");
		expect(markdown).toContain("Paragraph without closing tag");
	});

	it("handles very long content", () => {
		const paragraphs = Array(100)
			.fill(0)
			.map((_, i) => `<p>Paragraph ${i + 1} with some content to make it realistic.</p>`)
			.join("\n");

		const html = `<html><body><h1>Long Document</h1>${paragraphs}</body></html>`;
		const markdown = htmlToMarkdown(html, "https://example.com/long");

		expect(markdown).toContain("# Long Document");
		expect(markdown).toContain("Paragraph 1");
		expect(markdown).toContain("Paragraph 100");
		expect(markdown.length).toBeGreaterThan(2000);
	});
});

describe("pdf integration", () => {
	it("handles realistic PDF metadata and content", async () => {
		// Simulate a realistic PDF parser response
		const mockParser = async () => ({
			text: `Introduction to Machine Learning

Machine learning is a subset of artificial intelligence that enables systems to learn from data.

Key Concepts

1. Supervised Learning - Learning with labeled data
2. Unsupervised Learning - Finding patterns in unlabeled data
3. Reinforcement Learning - Learning through rewards and penalties

Popular Algorithms

- Linear Regression
- Decision Trees
- Neural Networks
- Support Vector Machines

Conclusion

Machine learning continues to evolve and transform industries.`,
			info: {
				info: {
					Title: "Introduction to Machine Learning",
					Author: "Dr. John Smith",
					Subject: "Artificial Intelligence",
					Producer: "PDF Generator v2.0",
				},
				total: 15,
			},
		});

		const markdown = await pdfBufferToMarkdown(Buffer.from("%PDF-1.4 fake pdf"), {
			createParser: () => mockParser(),
		});

		expect(markdown).toContain("# Introduction to Machine Learning");
		expect(markdown).toContain("*Dr. John Smith*");
		expect(markdown).toContain("*15 pages*");
		expect(markdown).toContain("Machine learning is a subset");
		expect(markdown).toContain("## Key Concepts");
		expect(markdown).toContain("Supervised Learning");
		expect(markdown).toContain("Neural Networks");
	});

	it("handles PDF with complex formatting patterns", async () => {
		const mockParser = async () => ({
			text: `TECHNICAL SPECIFICATION

Document Version: 2.1
Date: January 2024

1. OVERVIEW

This document describes the technical specifications for the system.

2. REQUIREMENTS

2.1 Hardware Requirements
- CPU: 2.0 GHz or faster
- RAM: 8GB minimum
- Storage: 50GB available space

2.2 Software Requirements
- Operating System: Windows 10+, macOS 10.15+, Linux
- Browser: Chrome 90+, Firefox 88+, Safari 14+

3. INSTALLATION

Follow these steps to install the software:

Step 1: Download the installer
Step 2: Run the installer
Step 3: Configure settings
Step 4: Restart system

4. TROUBLESHOOTING

Common issues and solutions are documented in Appendix A.

APPENDIX A: COMMON ISSUES

Issue 1: Installation fails
Solution: Check system requirements

Issue 2: Software won't start
Solution: Verify installation completed`,
			info: {
				info: {
					Title: "Technical Specification Document",
					Author: "Engineering Team",
				},
				total: 8,
			},
		});

		const markdown = await pdfBufferToMarkdown(Buffer.from("%PDF-1.4 fake"), {
			createParser: () => mockParser(),
		});

		expect(markdown).toContain("# Technical Specification Document");
		expect(markdown).toContain("## 1. OVERVIEW");
		expect(markdown).toContain("## 2. REQUIREMENTS");
		expect(markdown).toContain("CPU: 2.0 GHz");
		expect(markdown).toContain("RAM: 8GB minimum");
		expect(markdown).toContain("Step 1: Download the installer");
		expect(markdown).toContain("APPENDIX A: COMMON ISSUES");
	});

	it("handles PDF with code snippets", async () => {
		const mockParser = async () => ({
			text: `Python Tutorial

Basic Syntax

print("Hello, World!")
x = 10
y = 20
print(x + y)

Functions

def greet(name):
    return f"Hello, {name}!"

print(greet("Alice"))

Classes

class Dog:
    def __init__(self, name):
        self.name = name
    
    def bark(self):
        return "Woof!"

my_dog = Dog("Buddy")
print(my_dog.bark())`,
			info: {
				info: { Title: "Python Tutorial" },
				total: 3,
			},
		});

		const markdown = await pdfBufferToMarkdown(Buffer.from("%PDF-1.4 fake"), {
			createParser: () => mockParser(),
		});

		expect(markdown).toContain("# Python Tutorial");
		expect(markdown).toContain('print("Hello, World!")');
		expect(markdown).toContain("def greet(name):");
		expect(markdown).toContain("class Dog:");
		expect(markdown).toContain('return "Woof!"');
	});

	it("handles PDF with tables-like content", async () => {
		const mockParser = async () => ({
			text: `Product Comparison

Product A         Product B         Product C
Price: $100       Price: $150       Price: $200
Rating: 4.5       Rating: 4.8       Rating: 4.2
Reviews: 1000     Reviews: 2500     Reviews: 500

Features:
- Feature 1       - Feature 1       - Feature 1
- Feature 2       - Feature 2       - Feature 2
- Feature 3       - Feature 3       - Feature 3

Recommendation: Product B offers the best value.`,
			info: {
				info: { Title: "Product Comparison" },
				total: 2,
			},
		});

		const markdown = await pdfBufferToMarkdown(Buffer.from("%PDF-1.4 fake"), {
			createParser: () => mockParser(),
		});

		expect(markdown).toContain("# Product Comparison");
		expect(markdown).toContain("Product A");
		expect(markdown).toContain("Price: $150");
		expect(markdown).toContain("Rating: 4.8");
		expect(markdown).toContain("Product B offers the best value");
	});

	it("handles PDF with lists and bullet points", async () => {
		const mockParser = async () => ({
			text: `Shopping List

Groceries:
• Milk
• Eggs
• Bread
• Cheese
• Butter

Household Items:
• Toilet paper
• Dish soap
• Laundry detergent
• Trash bags

Electronics:
• Phone charger
• USB cable
• Headphones`,
			info: { total: 1 },
		});

		const markdown = await pdfBufferToMarkdown(Buffer.from("%PDF-1.4 fake"), {
			createParser: () => mockParser(),
		});

		expect(markdown).toContain("Milk");
		expect(markdown).toContain("Eggs");
		expect(markdown).toContain("Toilet paper");
		expect(markdown).toContain("Headphones");
	});
});

describe("html-to-markdown edge cases", () => {
	it("handles HTML entities correctly", () => {
		const html = `
<html>
<body>
    <p>Special characters: &lt; &gt; &amp; &quot; &apos; &copy; &reg; &trade;</p>
    <p>Math: &plusmn; &times; &divide; &frac12; &frac14;</p>
    <p>Symbols: &hearts; &spades; &diams; &clubs;</p>
</body>
</html>`;

		const markdown = htmlToMarkdown(html, "https://example.com/entities");

		expect(markdown).toContain("<");
		expect(markdown).toContain(">");
		expect(markdown).toContain("&");
		expect(markdown).toContain('"');
	});

	it("handles HTML with data attributes and custom elements", () => {
		const html = `
<html>
<body>
    <div data-id="123" data-value="test">Content with data attributes</div>
    <custom-element>Custom element content</custom-element>
    <p>Regular paragraph</p>
</body>
</html>`;

		const markdown = htmlToMarkdown(html, "https://example.com/custom");

		expect(markdown).toContain("Content with data attributes");
		expect(markdown).toContain("Regular paragraph");
	});

	it("handles HTML with embedded SVG", () => {
		const html = `
<html>
<body>
    <h1>Page with SVG</h1>
    <svg width="100" height="100">
        <circle cx="50" cy="50" r="40" fill="red"/>
    </svg>
    <p>Text after SVG</p>
</body>
</html>`;

		const markdown = htmlToMarkdown(html, "https://example.com/svg");

		expect(markdown).toContain("Page with SVG");
		expect(markdown).toContain("Text after SVG");
	});

	it("handles HTML with iframes and objects (should be removed)", () => {
		const html = `
<html>
<body>
    <h1>Page with Embeds</h1>
    <iframe src="https://example.com/embed"></iframe>
    <object data="https://example.com/object"></object>
    <p>Content after embeds</p>
</body>
</html>`;

		const markdown = htmlToMarkdown(html, "https://example.com/embeds");

		expect(markdown).toContain("Page with Embeds");
		expect(markdown).toContain("Content after embeds");
		expect(markdown).not.toContain("<iframe");
		expect(markdown).not.toContain("<object");
	});
});

describe("pdf edge cases", () => {
	it("handles PDF with only whitespace and newlines", async () => {
		const mockParser = async () => ({
			text: "   \n\n   \n   \n   ",
			info: {},
		});

		const markdown = await pdfBufferToMarkdown(Buffer.from("%PDF-1.4 fake"), {
			createParser: () => mockParser(),
		});

		expect(markdown).toBe("");
	});

	it("handles PDF with very long lines", async () => {
		const longLine = "A".repeat(1000);
		const mockParser = async () => ({
			text: `Title

${longLine}

Content after long line`,
			info: { info: { Title: "Long Lines Test" } },
		});

		const markdown = await pdfBufferToMarkdown(Buffer.from("%PDF-1.4 fake"), {
			createParser: () => mockParser(),
		});

		expect(markdown).toContain("# Long Lines Test");
		expect(markdown).toContain("Content after long line");
		expect(markdown.length).toBeGreaterThan(1000);
	});

	it("handles PDF with repeated short lines (potential headings)", async () => {
		const mockParser = async () => ({
			text: `Chapter 1

This is the content of chapter 1.

Chapter 2

This is the content of chapter 2.

Chapter 3

This is the content of chapter 3.

Appendix

Additional information.`,
			info: {},
		});

		const markdown = await pdfBufferToMarkdown(Buffer.from("%PDF-1.4 fake"), {
			createParser: () => mockParser(),
		});

		// Short lines should be detected as headings
		expect(markdown).toContain("## Chapter 1");
		expect(markdown).toContain("## Chapter 2");
		expect(markdown).toContain("## Chapter 3");
		expect(markdown).toContain("## Appendix");
	});
});
