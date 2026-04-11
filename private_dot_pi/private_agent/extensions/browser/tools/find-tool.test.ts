/**
 * Tests for find tool
 * Uses mocked dependencies
 */

import { describe, expect, it, mock } from "bun:test";
import { registerFindTool } from "./find-tool";

describe("registerFindTool", () => {
	const createMockCache = () => {
		const _mockSet = mock();
		const store = new Map();
		const mockGet = mock((key: string) => store.get(key));
		const mockSetImpl = mock((key: string, value: string) => store.set(key, value));
		return { set: mockSetImpl, get: mockGet } as any;
	};

	it("registers find tool with Pi API", () => {
		const mockRegisterTool = mock();
		const mockPi = { registerTool: mockRegisterTool } as any;
		const cache = createMockCache();

		registerFindTool(mockPi, { cache });

		expect(mockRegisterTool).toHaveBeenCalled();
		const toolConfig = mockRegisterTool.mock.calls[0][0];
		expect(toolConfig.name).toBe("find");
		expect(toolConfig.label).toBe("Find on Page");
	});

	it("searches cached content when available", async () => {
		const mockExtract = mock(async () => ({ content: "Should not be called" }));
		const mockRegisterTool = mock();
		const mockPi = { registerTool: mockRegisterTool } as any;
		const cache = createMockCache();
		cache.get = mock(() => "Cached content with keyword");

		registerFindTool(mockPi, { extractContent: mockExtract, cache });

		const toolConfig = mockRegisterTool.mock.calls[0][0];
		const execute = toolConfig.execute;

		await execute(
			"tool-call-id",
			{ url: "https://example.com", phrase: "keyword" },
			null as any,
			null as any,
			null as any,
		);

		expect(mockExtract).not.toHaveBeenCalled();
	});

	it("fetches content when not cached", async () => {
		const mockExtract = mock(async () => ({ content: "Fresh content with keyword" }));
		const mockRegisterTool = mock();
		const mockPi = { registerTool: mockRegisterTool } as any;
		const cache = createMockCache();

		registerFindTool(mockPi, { extractContent: mockExtract, cache });

		const toolConfig = mockRegisterTool.mock.calls[0][0];
		const execute = toolConfig.execute;

		await execute(
			"tool-call-id",
			{ url: "https://example.com", phrase: "keyword" },
			null as any,
			null as any,
			null as any,
		);

		expect(mockExtract).toHaveBeenCalledWith("https://example.com", expect.any(Object));
		expect(cache.set).toHaveBeenCalled();
	});

	it("finds case-insensitive matches", async () => {
		const mockExtract = mock(async () => ({ content: "The Keyword appears here" }));
		const mockRegisterTool = mock();
		const mockPi = { registerTool: mockRegisterTool } as any;
		const cache = createMockCache();

		registerFindTool(mockPi, { extractContent: mockExtract, cache });

		const toolConfig = mockRegisterTool.mock.calls[0][0];
		const execute = toolConfig.execute;

		const result = await execute(
			"tool-call-id",
			{ url: "https://example.com", phrase: "keyword" },
			null as any,
			null as any,
			null as any,
		);

		expect(result.content[0].text).toContain("1 occurrence");
	});

	it("returns no matches when phrase not found", async () => {
		const mockExtract = mock(async () => ({ content: "Content without the search term" }));
		const mockRegisterTool = mock();
		const mockPi = { registerTool: mockRegisterTool } as any;
		const cache = createMockCache();

		registerFindTool(mockPi, { extractContent: mockExtract, cache });

		const toolConfig = mockRegisterTool.mock.calls[0][0];
		const execute = toolConfig.execute;

		const result = await execute(
			"tool-call-id",
			{ url: "https://example.com", phrase: "notfound" },
			null as any,
			null as any,
			null as any,
		);

		expect(result.content[0].text).toContain("No occurrences");
		expect(result.details.matchCount).toBe(0);
	});

	it("finds multiple matches", async () => {
		const mockExtract = mock(async () => ({
			content: "match on line 1\n\nmatch on line 3\n\nmatch on line 5",
		}));
		const mockRegisterTool = mock();
		const mockPi = { registerTool: mockRegisterTool } as any;
		const cache = createMockCache();

		registerFindTool(mockPi, { extractContent: mockExtract, cache });

		const toolConfig = mockRegisterTool.mock.calls[0][0];
		const execute = toolConfig.execute;

		const result = await execute(
			"tool-call-id",
			{ url: "https://example.com", phrase: "match" },
			null as any,
			null as any,
			null as any,
		);

		expect(result.content[0].text).toContain("3 occurrence(s)");
		expect(result.details.matchCount).toBe(3);
	});

	it("shows all matches when under MAX_FIND_MATCHES limit", async () => {
		const manyMatches = Array(20).fill("match").join("\n");
		const mockExtract = mock(async () => ({ content: manyMatches }));
		const mockRegisterTool = mock();
		const mockPi = { registerTool: mockRegisterTool } as any;
		const cache = createMockCache();
		registerFindTool(mockPi, { extractContent: mockExtract, cache });
		const toolConfig = mockRegisterTool.mock.calls[0][0];
		const execute = toolConfig.execute;
		const result = await execute(
			"tool-call-id",
			{ url: "https://example.com", phrase: "match" },
			null as any,
			null as any,
			null as any,
		);

		expect(result.content[0].text).toContain("Found 20 occurrence(s)");
		expect(result.content[0].text).not.toContain("[Showing"); // All 20 shown (under limit of 50)
		expect(result.details.matchCount).toBe(20);
	});

	it("includes context around matches", async () => {
		const mockExtract = mock(async () => ({
			content: "Line before\nkeyword here\nline after",
		}));
		const mockRegisterTool = mock();
		const mockPi = { registerTool: mockRegisterTool } as any;
		const cache = createMockCache();

		registerFindTool(mockPi, { extractContent: mockExtract, cache });

		const toolConfig = mockRegisterTool.mock.calls[0][0];
		const execute = toolConfig.execute;

		const result = await execute(
			"tool-call-id",
			{ url: "https://example.com", phrase: "keyword" },
			null as any,
			null as any,
			null as any,
		);

		expect(result.content[0].text).toContain("Line before");
		expect(result.content[0].text).toContain("keyword here");
		expect(result.content[0].text).toContain("line after");
	});

	it("handles empty cached content", async () => {
		const mockExtract = mock(async () => ({ content: "" }));
		const mockRegisterTool = mock();
		const mockPi = { registerTool: mockRegisterTool } as any;
		const cache = createMockCache();
		registerFindTool(mockPi, { extractContent: mockExtract, cache });
		const toolConfig = mockRegisterTool.mock.calls[0][0];
		const execute = toolConfig.execute;
		const result = await execute(
			"tool-call-id",
			{ url: "https://example.com", phrase: "test" },
			null as any,
			null as any,
			null as any,
		);
		expect(result.content[0].text).toContain("No content available");
	});

	it("throws error when fetch fails", async () => {
		const mockExtract = mock(async () => {
			throw new Error("Network error");
		});
		const mockRegisterTool = mock();
		const mockPi = { registerTool: mockRegisterTool } as any;
		const cache = createMockCache();

		registerFindTool(mockPi, { extractContent: mockExtract, cache });

		const toolConfig = mockRegisterTool.mock.calls[0][0];
		const execute = toolConfig.execute;

		// Per error handling philosophy: tools don't wrap errors, they propagate naturally
		await expect(
			execute(
				"tool-call-id",
				{ url: "https://example.com", phrase: "test" },
				null as any,
				null as any,
				null as any,
			),
		).rejects.toThrow("Network error");
	});

	it("includes match details in response", async () => {
		const mockExtract = mock(async () => ({ content: "test content" }));
		const mockRegisterTool = mock();
		const mockPi = { registerTool: mockRegisterTool } as any;
		const cache = createMockCache();

		registerFindTool(mockPi, { extractContent: mockExtract, cache });

		const toolConfig = mockRegisterTool.mock.calls[0][0];
		const execute = toolConfig.execute;

		const result = await execute(
			"tool-call-id",
			{ url: "https://example.com", phrase: "test" },
			null as any,
			null as any,
			null as any,
		);

		expect(result.details.url).toBe("https://example.com");
		expect(result.details.phrase).toBe("test");
		expect(result.details.matchCount).toBe(1);
	});
});
