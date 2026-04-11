/**
 * Tests for DDGS search functionality
 * Uses mocked execFileSync
 */

import { describe, expect, it, mock } from "bun:test";
import { runDdgsSearch } from "./search";

describe("runDdgsSearch", () => {
	it("returns search results from ddgs", () => {
		const mockResults = [
			{ title: "Result 1", href: "https://example.com/1", body: "Body 1" },
			{ title: "Result 2", href: "https://example.com/2", body: "Body 2" },
		];

		const mockExecFileSync = mock((_cmd: string, _args: string[], _opts: object) =>
			JSON.stringify(mockResults),
		);

		const results = runDdgsSearch("test query", 2, {
			execFileSync: mockExecFileSync,
		});

		expect(results).toEqual(mockResults);
		expect(mockExecFileSync).toHaveBeenCalled();
	});

	it("uses default maxResults of 10", () => {
		let capturedArgs: string[] | undefined;
		const mockExecFileSync = mock((_cmd: string, args: string[], _opts: object) => {
			capturedArgs = args;
			return JSON.stringify([]);
		});

		runDdgsSearch("test query", undefined, {
			execFileSync: mockExecFileSync,
		});

		// The script is passed as the last argument after -c
		const script = capturedArgs?.[capturedArgs.length - 1];
		expect(script).toContain("max_results=10");
	});

	it("uses custom maxResults", () => {
		let capturedArgs: string[] | undefined;
		const mockExecFileSync = mock((_cmd: string, args: string[], _opts: object) => {
			capturedArgs = args;
			return JSON.stringify([]);
		});

		runDdgsSearch("test query", 5, {
			execFileSync: mockExecFileSync,
		});

		const script = capturedArgs?.[capturedArgs.length - 1];
		expect(script).toContain("max_results=5");
	});

	it("sanitizes query properly", () => {
		let capturedArgs: string[] | undefined;
		const mockExecFileSync = mock((_cmd: string, args: string[], _opts: object) => {
			capturedArgs = args;
			return JSON.stringify([]);
		});
		const query = 'test "query" with special chars';

		runDdgsSearch(query, 10, {
			execFileSync: mockExecFileSync,
		});

		// The script is passed as the last argument after -c
		const script = capturedArgs?.[capturedArgs.length - 1];
		// Query should be JSON stringified in the script (quotes are escaped)
		expect(script).toContain('test \\"query\\" with special chars');
	});

	it("throws error on unexpected response format", () => {
		const mockExecFileSync = mock((_cmd: string, _args: string[], _opts: object) =>
			JSON.stringify({ error: "test" }),
		);

		expect(() =>
			runDdgsSearch("test", 10, {
				execFileSync: mockExecFileSync,
			}),
		).toThrow("Unexpected search response format");
	});

	it("throws error on non-array response", () => {
		const mockExecFileSync = mock((_cmd: string, _args: string[], _opts: object) =>
			JSON.stringify("invalid"),
		);

		expect(() =>
			runDdgsSearch("test", 10, {
				execFileSync: mockExecFileSync,
			}),
		).toThrow("Unexpected search response format");
	});

	it("passes correct uv command with -c flag", () => {
		let capturedCmd: string | undefined;
		let capturedArgs: string[] | undefined;
		const mockExecFileSync = mock((cmd: string, args: string[], _opts: object) => {
			capturedCmd = cmd;
			capturedArgs = args;
			return JSON.stringify([]);
		});

		runDdgsSearch("test", 10, {
			execFileSync: mockExecFileSync,
		});

		// Should use uv run --with ddgs python3 -c
		expect(capturedCmd).toBe("uv");
		expect(capturedArgs).toContain("run");
		expect(capturedArgs).toContain("--with");
		expect(capturedArgs).toContain("ddgs");
		expect(capturedArgs).toContain("python3");
		expect(capturedArgs).toContain("-c");
		// Script should contain DDGS import
		const script = capturedArgs?.[capturedArgs.length - 1];
		expect(script).toContain("from ddgs import DDGS");
	});

	it("passes correct options to execFileSync", () => {
		let capturedOptions: object | undefined;
		const mockExecFileSync = mock((_cmd: string, _args: string[], options: object) => {
			capturedOptions = options;
			return JSON.stringify([]);
		});

		runDdgsSearch("test", 10, {
			execFileSync: mockExecFileSync,
		});

		expect(capturedOptions).toEqual({
			encoding: "utf-8",
			timeout: 30_000, // SEARCH_TIMEOUT_MS
			maxBuffer: 10 * 1024 * 1024,
			stdio: ["ignore", "pipe", "pipe"],
		});
	});

	it("handles empty results", () => {
		const mockExecFileSync = mock((_cmd: string, _args: string[], _opts: object) =>
			JSON.stringify([]),
		);

		const results = runDdgsSearch("no results", 10, {
			execFileSync: mockExecFileSync,
		});

		expect(results).toEqual([]);
	});

	it("filters out results with missing required fields", () => {
		const mockResults = [
			{ title: "Result 1", href: "https://example.com/1", body: "Body 1" },
			{ title: "Result 2", href: "https://example.com/2" }, // missing body
			{ href: "https://example.com/3", body: "Body 3" }, // missing title
			{ title: "Result 4", href: "https://example.com/4", body: "Body 4" },
		];
		const mockExecFileSync = mock((_cmd: string, _args: string[], _opts: object) =>
			JSON.stringify(mockResults),
		);

		const results = runDdgsSearch("test", 10, {
			execFileSync: mockExecFileSync,
		});

		// Should only return results with all required fields
		expect(results).toHaveLength(2);
		expect(results[0].title).toBe("Result 1");
		expect(results[1].title).toBe("Result 4");
	});
});
