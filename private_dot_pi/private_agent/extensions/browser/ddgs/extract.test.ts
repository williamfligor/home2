/**
 * Tests for DDGS extract functionality
 * Uses mocked execFileSync
 */

import { describe, expect, it, mock } from "bun:test";
import { runDdgsExtract } from "./extract";

describe("runDdgsExtract", () => {
	it("returns extract result from ddgs", () => {
		const mockResult = {
			url: "https://example.com",
			content: "Extracted content here",
		};

		const mockExecFileSync = mock(() => JSON.stringify(mockResult));

		const result = runDdgsExtract("https://example.com", {
			execFileSync: mockExecFileSync,
		});

		expect(result).toEqual(mockResult);
		expect(mockExecFileSync).toHaveBeenCalled();
	});

	it("throws error when ddgs returns error", () => {
		const mockExecFileSync = mock(() => JSON.stringify({ error: "Connection failed" }));

		expect(() =>
			runDdgsExtract("https://example.com", {
				execFileSync: mockExecFileSync,
			}),
		).toThrow("Connection failed");
	});

	it("throws error when content is missing", () => {
		const mockExecFileSync = mock(() => JSON.stringify({ url: "https://example.com" }));

		expect(() =>
			runDdgsExtract("https://example.com", {
				execFileSync: mockExecFileSync,
			}),
		).toThrow("Extract returned no content");
	});

	it("throws error for non-HTTP/HTTPS URLs", () => {
		expect(() => runDdgsExtract("file:///etc/passwd")).toThrow(
			"Only HTTP/HTTPS URLs are supported",
		);
	});

	it("throws error for invalid URLs", () => {
		expect(() => runDdgsExtract("not-a-valid-url")).toThrow("Invalid URL format");
	});

	it("passes correct uv command", () => {
		let capturedCommand: string | undefined;
		let capturedArgs: string[] | undefined;
		const mockExecFileSync = mock((cmd: string, args: string[], _: object) => {
			capturedCommand = cmd;
			capturedArgs = args;
			return JSON.stringify({ url: "https://example.com", content: "test" });
		});

		runDdgsExtract("https://example.com", { execFileSync: mockExecFileSync });

		expect(capturedCommand).toBe("uv");
		expect(capturedArgs).toEqual([
			"run",
			"--with",
			"ddgs",
			"python3",
			"-c",
			expect.any(String),
		]);
	});

	it("passes correct options to execFileSync", () => {
		let capturedOptions: object | undefined;
		const mockExecFileSync = mock((_: string, __: string[], options: object) => {
			capturedOptions = options;
			return JSON.stringify({ url: "https://example.com", content: "test" });
		});

		runDdgsExtract("https://example.com", { execFileSync: mockExecFileSync });

		expect(capturedOptions).toEqual({
			encoding: "utf-8",
			timeout: 30_000, // EXTRACT_TIMEOUT_MS
			maxBuffer: 50 * 1024 * 1024,
			stdio: ["ignore", "pipe", "pipe"],
		});
	});

	it("escapes URL properly", () => {
		let capturedArgs: string[] | undefined;
		const mockExecFileSync = mock((_: string, args: string[], __: object) => {
			capturedArgs = args;
			return JSON.stringify({ url: "https://example.com", content: "test" });
		});
		const url = "https://example.com/path?query=value&other=123";

		runDdgsExtract(url, { execFileSync: mockExecFileSync });

		expect(capturedArgs?.[5]).toContain(JSON.stringify(url));
	});

	it("handles content with special characters", () => {
		const mockResult = {
			url: "https://example.com",
			content: "Content with special chars: <>&\"'\n\t",
		};
		const mockExecFileSync = mock(() => JSON.stringify(mockResult));

		const result = runDdgsExtract("https://example.com", {
			execFileSync: mockExecFileSync,
		});

		expect(result.content).toBe("Content with special chars: <>&\"'\n\t");
	});

	it("handles content with unicode", () => {
		const mockResult = {
			url: "https://example.com",
			content: "Unicode: 你好 🎉 مرحبا",
		};
		const mockExecFileSync = mock(() => JSON.stringify(mockResult));

		const result = runDdgsExtract("https://example.com", {
			execFileSync: mockExecFileSync,
		});

		expect(result.content).toBe("Unicode: 你好 🎉 مرحبا");
	});
});
