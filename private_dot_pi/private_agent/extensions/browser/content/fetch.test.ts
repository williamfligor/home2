/**
 * Tests for fetch and extraction functionality
 * Uses mocked fetch and dependencies
 */

import { describe, expect, it, mock } from "bun:test";
import { extractContent, fetchUrlAsMarkdown, isPdfUrl, validateUrl } from "./fetch";

describe("isPdfUrl", () => {
	it("detects PDF by extension", () => {
		expect(isPdfUrl("https://example.com/file.pdf")).toBe(true);
		expect(isPdfUrl("https://example.com/path/to/document.PDF")).toBe(true);
		expect(isPdfUrl("https://example.com/file.Pdf")).toBe(true);
	});

	it("returns false for non-PDF URLs", () => {
		expect(isPdfUrl("https://example.com/page.html")).toBe(false);
		expect(isPdfUrl("https://example.com/page")).toBe(false);
		expect(isPdfUrl("https://example.com")).toBe(false);
	});

	it("handles invalid URLs gracefully", () => {
		expect(isPdfUrl("not a url")).toBe(false);
		expect(isPdfUrl("")).toBe(false);
	});
});

describe("fetchUrlAsMarkdown", () => {
	it("fetches HTML and converts to markdown", async () => {
		const mockHtmlToMarkdown = mock(() => "# Converted\n\nContent");
		const mockResponse = {
			ok: true,
			url: "https://example.com",
			headers: { get: () => "text/html" },
			arrayBuffer: async () => Buffer.from("<html><body>Test</body></html>").buffer,
		};

		globalThis.fetch = mock(async () => mockResponse as any);

		const result = await fetchUrlAsMarkdown("https://example.com", {
			htmlToMarkdown: mockHtmlToMarkdown,
		});

		expect(result.content).toContain("# Converted");
		expect(result.contentType).toBe("text/html");
		expect(result.method).toBe("html-readability");
	});

	it("fetches PDF and converts to markdown", async () => {
		const mockPdfToMarkdown = mock(async () => "# PDF Content");
		const mockResponse = {
			ok: true,
			url: "https://example.com/doc.pdf",
			headers: { get: () => "application/pdf" },
			arrayBuffer: async () => Buffer.from("%PDF-1.4 fake pdf").buffer,
		};

		globalThis.fetch = mock(async () => mockResponse as any);

		const result = await fetchUrlAsMarkdown("https://example.com/doc.pdf", {
			pdfToMarkdown: mockPdfToMarkdown,
		});

		expect(result.content).toBe("# PDF Content");
		expect(result.contentType).toBe("application/pdf");
		expect(result.method).toBe("pdf-parse");
	});

	it("detects PDF by URL extension even with wrong content-type", async () => {
		const mockPdfToMarkdown = mock(async () => "# PDF Content");
		const mockResponse = {
			ok: true,
			url: "https://example.com/doc.pdf",
			headers: { get: () => "text/plain" }, // Wrong content-type
			arrayBuffer: async () => Buffer.from("%PDF-1.4 fake pdf").buffer,
		};

		globalThis.fetch = mock(async () => mockResponse as any);

		const result = await fetchUrlAsMarkdown("https://example.com/doc.pdf", {
			pdfToMarkdown: mockPdfToMarkdown,
		});

		expect(result.method).toBe("pdf-parse");
	});

	it("detects PDF by magic bytes even with wrong content-type and no .pdf extension", async () => {
		const mockPdfToMarkdown = mock(async () => "# PDF Content");
		const mockResponse = {
			ok: true,
			url: "https://example.com/products/d/da008462", // No .pdf extension
			headers: { get: () => "text/plain" }, // Wrong content-type
			arrayBuffer: async () => Buffer.from("%PDF-1.7 real pdf data").buffer,
		};

		globalThis.fetch = mock(async () => mockResponse as any);

		const result = await fetchUrlAsMarkdown("https://example.com/products/d/da008462", {
			pdfToMarkdown: mockPdfToMarkdown,
		});

		expect(result.content).toBe("# PDF Content");
		expect(result.contentType).toBe("application/pdf");
		expect(result.method).toBe("pdf-parse");
	});

	it("handles HTTP errors", async () => {
		const mockResponse = {
			ok: false,
			status: 404,
			statusText: "Not Found",
			url: "https://example.com",
			headers: { get: () => "text/html" },
		};

		globalThis.fetch = mock(async () => mockResponse as any);

		await expect(fetchUrlAsMarkdown("https://example.com")).rejects.toThrow("HTTP 404");
	});

	it("handles plain text content", async () => {
		const mockResponse = {
			ok: true,
			url: "https://example.com/text.txt",
			headers: { get: () => "text/plain" },
			arrayBuffer: async () => Buffer.from("Plain text content").buffer,
		};

		globalThis.fetch = mock(async () => mockResponse as any);

		const result = await fetchUrlAsMarkdown("https://example.com/text.txt");

		expect(result.content).toBe("Plain text content");
		expect(result.method).toBe("html-readability");
	});

	it("follows redirects", async () => {
		const mockResponse = {
			ok: true,
			url: "https://final.example.com/redirected",
			headers: { get: () => "text/html" },
			arrayBuffer: async () => Buffer.from("<html>Test</html>").buffer,
		};

		globalThis.fetch = mock(async () => mockResponse as any);

		const result = await fetchUrlAsMarkdown("https://example.com");

		expect(result.finalUrl).toBe("https://final.example.com/redirected");
	});

	it("respects timeout", async () => {
		const mockFetch = mock(async (_url: string, options: any) => {
			// Listen for abort signal and reject when fired
			if (options?.signal) {
				return new Promise<never>((_, reject) => {
					options.signal.addEventListener(
						"abort",
						() => reject(new DOMException("The operation was aborted", "AbortError")),
						false,
					);
				});
			}
			// Fallback if no signal - never resolves
			return new Promise<never>(() => {});
		});
		globalThis.fetch = mockFetch;

		const startTime = Date.now();
		await expect(
			fetchUrlAsMarkdown("https://example.com", { timeoutMs: 100 }),
		).rejects.toThrow();
		const elapsed = Date.now() - startTime;

		// Should timeout around 100ms (allow generous variance for system load)
		expect(elapsed).toBeLessThan(1000);
	});

	it("rejects response with Content-Length exceeding MAX_RESPONSE_SIZE", async () => {
		const mockResponse = {
			ok: true,
			url: "https://example.com",
			headers: {
				get: (name: string) => (name === "content-length" ? "20000000" : "text/html"),
			},
			arrayBuffer: async () => Buffer.from("test").buffer,
		};

		globalThis.fetch = mock(async () => mockResponse as any);

		await expect(fetchUrlAsMarkdown("https://example.com")).rejects.toThrow(
			"exceeds maximum allowed size",
		);
	});

	it("accepts response with Content-Length under MAX_RESPONSE_SIZE", async () => {
		const mockHtmlToMarkdown = mock(() => "# Converted");
		const mockResponse = {
			ok: true,
			url: "https://example.com",
			headers: { get: (name: string) => (name === "content-length" ? "1000" : "text/html") },
			arrayBuffer: async () => Buffer.from("<html><body>Test</body></html>").buffer,
		};

		globalThis.fetch = mock(async () => mockResponse as any);

		const result = await fetchUrlAsMarkdown("https://example.com", {
			htmlToMarkdown: mockHtmlToMarkdown,
		});

		expect(result.content).toBe("# Converted");
	});
});

describe("extractContent", () => {
	it("uses direct fetch for PDFs", async () => {
		const mockFetchUrl = mock(async () => ({
			content: "PDF content",
			finalUrl: "https://example.com/doc.pdf",
			method: "pdf-parse",
		}));
		const mockDdgsExtract = mock(() => ({ content: "ddgs content" }));

		const result = await extractContent("https://example.com/doc.pdf", {
			fetchUrl: mockFetchUrl,
			ddgsExtract: mockDdgsExtract,
		});

		expect(result.content).toBe("PDF content");
		expect(result.method).toBe("pdf-parse");
		expect(mockDdgsExtract).not.toHaveBeenCalled();
	});

	it("uses direct fetch for HTML pages", async () => {
		const mockFetchUrl = mock(async () => ({
			content:
				"Extracted HTML content that is long enough and has more than one hundred characters total in order to pass the check",
			finalUrl: "https://example.com/page",
			method: "html-readability",
		}));
		const mockDdgsExtract = mock(() => ({ content: "ddgs content" }));

		const result = await extractContent("https://example.com/page", {
			fetchUrl: mockFetchUrl,
			ddgsExtract: mockDdgsExtract,
		});

		expect(result.content).toBe(
			"Extracted HTML content that is long enough and has more than one hundred characters total in order to pass the check",
		);
		expect(result.method).toBe("html-readability");
		expect(mockDdgsExtract).not.toHaveBeenCalled();
	});

	it("falls back to ddgs extract when content is too short", async () => {
		const mockFetchUrl = mock(async () => ({
			content: "Short", // Less than 100 chars
			finalUrl: "https://example.com/page",
			method: "html-readability",
		}));
		const mockDdgsExtract = mock(() => ({
			url: "https://example.com/page",
			content: "DDGS extracted content",
		}));

		const result = await extractContent("https://example.com/page", {
			fetchUrl: mockFetchUrl,
			ddgsExtract: mockDdgsExtract,
		});

		expect(result.content).toBe("DDGS extracted content");
		expect(result.method).toBe("ddg-extract");
		expect(mockDdgsExtract).toHaveBeenCalled();
	});

	it("falls back to ddgs extract when fetch fails", async () => {
		const mockFetchUrl = mock(async () => {
			throw new Error("Network error");
		});
		const mockDdgsExtract = mock(() => ({
			url: "https://example.com/page",
			content: "DDGS fallback content",
		}));

		const result = await extractContent("https://example.com/page", {
			fetchUrl: mockFetchUrl,
			ddgsExtract: mockDdgsExtract,
		});

		expect(result.content).toBe("DDGS fallback content");
		expect(result.method).toBe("ddg-extract");
	});

	it("throws error when both methods fail", async () => {
		const mockFetchUrl = mock(async () => {
			throw new Error("Fetch failed");
		});
		const mockDdgsExtract = mock(() => {
			throw new Error("DDGS failed");
		});

		await expect(
			extractContent("https://example.com/page", {
				fetchUrl: mockFetchUrl,
				ddgsExtract: mockDdgsExtract,
			}),
		).rejects.toThrow("Could not extract content from https://example.com/page");
	});

	it("handles ddgs extract returning string", async () => {
		const mockFetchUrl = mock(async () => {
			throw new Error("Fetch failed");
		});
		const mockDdgsExtract = mock(() => "String content from ddgs");

		const result = await extractContent("https://example.com/page", {
			fetchUrl: mockFetchUrl,
			ddgsExtract: mockDdgsExtract,
		});

		expect(result.content).toBe("String content from ddgs");
	});
});

describe("validateUrl (dssrf)", () => {
	it("blocks localhost via DNS resolution", async () => {
		await expect(validateUrl("http://localhost")).rejects.toThrow("SSRF blocked");
	});

	it("blocks 127.x.x.x (loopback)", async () => {
		await expect(validateUrl("http://127.0.0.1")).rejects.toThrow("SSRF blocked");
	});

	it("blocks 10.x.x.x (Class A private)", async () => {
		await expect(validateUrl("http://10.0.0.1")).rejects.toThrow("SSRF blocked");
	});

	it("blocks 172.16.x.x - 172.31.x.x (Class B private)", async () => {
		await expect(validateUrl("http://172.16.0.1")).rejects.toThrow("SSRF blocked");
	});

	it("blocks 192.168.x.x (Class C private)", async () => {
		await expect(validateUrl("http://192.168.0.1")).rejects.toThrow("SSRF blocked");
	});

	it("blocks 169.254.x.x (link-local)", async () => {
		await expect(validateUrl("http://169.254.169.254")).rejects.toThrow("SSRF blocked");
	});

	it("blocks IPv6 loopback ::1", async () => {
		// dssrf blocks internal IPv6 ranges including loopback
		await expect(validateUrl("http://[::1]")).rejects.toThrow("SSRF blocked");
	});
});

describe("fetchUrlAsMarkdown SSRF protection", () => {
	it("blocks redirect to localhost (dssrf validates initial URL)", async () => {
		// Note: With DSSRF_CHECK_REDIRECTS=1, dssrf validates redirect chains
		// during the initial validateUrl() call. The initial URL itself is safe,
		// but dssrf's redirect checking will detect the unsafe redirect target.
		const mockFetch = mock(async (url: string, _options?: RequestInit) => {
			if (url === "https://example.com") {
				// Return a redirect response to localhost
				return {
					status: 302,
					headers: {
						get: (name: string) =>
							name === "location" ? "http://localhost:8080" : null,
					},
				};
			}
			return {
				ok: true,
				url,
				headers: { get: () => "text/html" },
				arrayBuffer: async () => Buffer.from("<html>Test</html>").buffer,
			};
		});
		globalThis.fetch = mockFetch;

		// dssrf with DSSRF_CHECK_REDIRECTS=1 will detect the unsafe redirect
		await expect(fetchUrlAsMarkdown("https://example.com")).rejects.toThrow("SSRF blocked");
	});

	it("blocks redirect to private IP (dssrf validates initial URL)", async () => {
		const mockFetch = mock(async (url: string, _options?: RequestInit) => {
			if (url === "https://example.com") {
				// Return a redirect response to private IP
				return {
					status: 302,
					headers: {
						get: (name: string) => (name === "location" ? "http://192.168.1.1" : null),
					},
				};
			}
			return {
				ok: true,
				url,
				headers: { get: () => "text/html" },
				arrayBuffer: async () => Buffer.from("<html>Test</html>").buffer,
			};
		});
		globalThis.fetch = mockFetch;

		// dssrf with DSSRF_CHECK_REDIRECTS=1 will detect the unsafe redirect
		await expect(fetchUrlAsMarkdown("https://example.com")).rejects.toThrow("SSRF blocked");
	});

	it("allows redirect to public URL", async () => {
		let callCount = 0;
		const mockFetch = mock(async (_url: string, _options?: RequestInit) => {
			callCount++;
			if (callCount === 1) {
				// First call: redirect to public URL
				return {
					status: 302,
					headers: {
						get: (name: string) =>
							name === "location" ? "https://public.example.com" : null,
					},
				};
			}
			// Second call: actual content
			return {
				ok: true,
				url: "https://public.example.com",
				headers: { get: () => "text/html" },
				arrayBuffer: async () => Buffer.from("<html>Redirected content</html>").buffer,
			};
		});
		globalThis.fetch = mockFetch;

		const result = await fetchUrlAsMarkdown("https://example.com");
		expect(result.finalUrl).toBe("https://public.example.com");
		expect(result.content).toContain("Redirected content");
	});
});
