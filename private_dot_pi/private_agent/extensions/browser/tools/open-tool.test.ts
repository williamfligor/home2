/**
 * Tests for open tool
 * Uses mocked dependencies
 */

import { describe, expect, it, mock } from "bun:test";
import { registerOpenTool } from "./open-tool";

describe("registerOpenTool", () => {
	const createMockCache = () => {
		const mockSet = mock();
		const mockGet = mock(() => undefined);
		return { set: mockSet, get: mockGet } as any;
	};

	it("registers open tool with Pi API", () => {
		const mockRegisterTool = mock();
		const mockPi = { registerTool: mockRegisterTool } as any;
		const cache = createMockCache();

		registerOpenTool(mockPi, { cache });

		expect(mockRegisterTool).toHaveBeenCalled();
		const toolConfig = mockRegisterTool.mock.calls[0][0];
		expect(toolConfig.name).toBe("open");
		expect(toolConfig.label).toBe("Open Page");
	});

	it("uses custom extractContent when provided", async () => {
		const mockExtract = mock(async () => ({
			content: "Custom content",
			finalUrl: "https://example.com",
			method: "custom",
		}));
		const mockRegisterTool = mock();
		const mockPi = { registerTool: mockRegisterTool } as any;
		const cache = createMockCache();

		registerOpenTool(mockPi, { extractContent: mockExtract, cache });

		const toolConfig = mockRegisterTool.mock.calls[0][0];
		const execute = toolConfig.execute;

		const result = await execute(
			"tool-call-id",
			{ url: "https://example.com" },
			null as any,
			null as any,
			null as any,
		);

		expect(mockExtract).toHaveBeenCalledWith("https://example.com", expect.any(Object));
		expect(result.content[0].text).toBe("Custom content");
	});

	it("caches content after extraction", async () => {
		const mockExtract = mock(async () => ({
			content: "Extracted content",
			finalUrl: "https://example.com",
			method: "test",
		}));
		const mockRegisterTool = mock();
		const mockPi = { registerTool: mockRegisterTool } as any;
		const cache = createMockCache();

		registerOpenTool(mockPi, { extractContent: mockExtract, cache });

		const toolConfig = mockRegisterTool.mock.calls[0][0];
		const execute = toolConfig.execute;

		await execute(
			"tool-call-id",
			{ url: "https://example.com" },
			null as any,
			null as any,
			null as any,
		);

		expect(cache.set).toHaveBeenCalledWith("https://example.com", "Extracted content");
	});

	it("handles empty content", async () => {
		const mockExtract = mock(async () => ({
			content: "",
			finalUrl: "https://example.com",
			method: "test",
		}));
		const mockRegisterTool = mock();
		const mockPi = { registerTool: mockRegisterTool } as any;
		const cache = createMockCache();

		registerOpenTool(mockPi, { extractContent: mockExtract, cache });

		const toolConfig = mockRegisterTool.mock.calls[0][0];
		const execute = toolConfig.execute;

		const result = await execute(
			"tool-call-id",
			{ url: "https://example.com" },
			null as any,
			null as any,
			null as any,
		);

		expect(result.content[0].text).toContain("No content could be extracted");
		expect(result.details.contentLength).toBe(0);
	});

	it("truncates content over limit", async () => {
		const longContent = "A".repeat(100_000); // Over MAX_CONTENT_LENGTH (80,000)
		const mockExtract = mock(async () => ({
			content: longContent,
			finalUrl: "https://example.com",
			method: "test",
		}));
		const mockRegisterTool = mock();
		const mockPi = { registerTool: mockRegisterTool } as any;
		const cache = createMockCache();

		const tempTracker = new (await import("../utils")).TempDirTracker();
		registerOpenTool(mockPi, { extractContent: mockExtract, cache, tempTracker });

		const toolConfig = mockRegisterTool.mock.calls[0][0];
		const execute = toolConfig.execute;

		const result = await execute(
			"tool-call-id",
			{ url: "https://example.com" },
			null as any,
			null as any,
			null as any,
		);

		expect(result.content[0].text).toContain("truncated");
		expect(result.details.truncated).toBe(true);
		expect(result.details.contentLength).toBe(100_000);
	});

	it("returns content under limit without truncation", async () => {
		const shortContent = "Short content under limit";
		const mockExtract = mock(async () => ({
			content: shortContent,
			finalUrl: "https://example.com",
			method: "test",
		}));
		const mockRegisterTool = mock();
		const mockPi = { registerTool: mockRegisterTool } as any;
		const cache = createMockCache();

		registerOpenTool(mockPi, { extractContent: mockExtract, cache });

		const toolConfig = mockRegisterTool.mock.calls[0][0];
		const execute = toolConfig.execute;

		const result = await execute(
			"tool-call-id",
			{ url: "https://example.com" },
			null as any,
			null as any,
			null as any,
		);

		expect(result.content[0].text).toBe(shortContent);
		expect(result.details.truncated).toBe(false);
	});

	it("throws error on extraction failure", async () => {
		const mockExtract = mock(async () => {
			throw new Error("Network error");
		});
		const mockRegisterTool = mock();
		const mockPi = { registerTool: mockRegisterTool } as any;
		const cache = createMockCache();

		registerOpenTool(mockPi, { extractContent: mockExtract, cache });

		const toolConfig = mockRegisterTool.mock.calls[0][0];
		const execute = toolConfig.execute;

		// Per error handling philosophy: tools don't wrap errors, they propagate naturally
		await expect(
			execute(
				"tool-call-id",
				{ url: "https://example.com" },
				null as any,
				null as any,
				null as any,
			),
		).rejects.toThrow("Network error");
	});

	it("includes method in details", async () => {
		const mockExtract = mock(async () => ({
			content: "Content",
			finalUrl: "https://example.com",
			method: "pdf-parse",
		}));
		const mockRegisterTool = mock();
		const mockPi = { registerTool: mockRegisterTool } as any;
		const cache = createMockCache();

		registerOpenTool(mockPi, { extractContent: mockExtract, cache });

		const toolConfig = mockRegisterTool.mock.calls[0][0];
		const execute = toolConfig.execute;

		const result = await execute(
			"tool-call-id",
			{ url: "https://example.com" },
			null as any,
			null as any,
			null as any,
		);

		expect(result.details.method).toBe("pdf-parse");
		expect(result.details.url).toBe("https://example.com");
	});
});
