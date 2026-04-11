/**
 * Tests for search tool
 * Uses mocked dependencies
 */

import { describe, expect, it, mock } from "bun:test";
import { registerSearchTool } from "./search-tool";

describe("registerSearchTool", () => {
	it("registers search tool with Pi API", () => {
		const mockRegisterTool = mock();
		const mockPi = { registerTool: mockRegisterTool } as any;

		registerSearchTool(mockPi);

		expect(mockRegisterTool).toHaveBeenCalled();
		const toolConfig = mockRegisterTool.mock.calls[0][0];
		expect(toolConfig.name).toBe("search");
		expect(toolConfig.label).toBe("Search");
		expect(toolConfig.description).toContain("Search the web");
	});

	it("uses custom runDdgsSearch when provided", () => {
		const mockRegisterTool = mock();
		const mockPi = { registerTool: mockRegisterTool } as any;
		const mockSearch = mock(() => [{ title: "Result", href: "https://example.com" }]);

		registerSearchTool(mockPi, { runDdgsSearch: mockSearch });

		const toolConfig = mockRegisterTool.mock.calls[0][0];
		expect(toolConfig.name).toBe("search");
	});

	it("configures correct parameters", () => {
		const mockRegisterTool = mock();
		const mockPi = { registerTool: mockRegisterTool } as any;

		registerSearchTool(mockPi);

		const toolConfig = mockRegisterTool.mock.calls[0][0];
		expect(toolConfig.parameters).toBeDefined();
		// Check that query parameter exists
		expect(toolConfig.parameters.properties).toHaveProperty("query");
	});

	it("execute handler calls search function", async () => {
		const mockSearch = mock(() => [
			{ title: "Test Result", href: "https://example.com", body: "Test body" },
		]);
		const mockRegisterTool = mock();
		const mockPi = { registerTool: mockRegisterTool } as any;

		registerSearchTool(mockPi, { runDdgsSearch: mockSearch });

		const toolConfig = mockRegisterTool.mock.calls[0][0];
		const execute = toolConfig.execute;

		const result = await execute(
			"tool-call-id",
			{ query: "test" },
			null as any,
			null as any,
			null as any,
		);

		expect(mockSearch).toHaveBeenCalledWith("test", 10);
		expect(result.content[0].type).toBe("text");
		expect(result.content[0].text).toContain("Test Result");
	});

	it("limits max_results to 20", async () => {
		const mockSearch = mock(() => []);
		const mockRegisterTool = mock();
		const mockPi = { registerTool: mockRegisterTool } as any;

		registerSearchTool(mockPi, { runDdgsSearch: mockSearch });

		const toolConfig = mockRegisterTool.mock.calls[0][0];
		const execute = toolConfig.execute;

		await execute(
			"tool-call-id",
			{ query: "test", max_results: 50 },
			null as any,
			null as any,
			null as any,
		);

		expect(mockSearch).toHaveBeenCalledWith("test", 20);
	});

	it("uses default max_results of 10", async () => {
		const mockSearch = mock(() => []);
		const mockRegisterTool = mock();
		const mockPi = { registerTool: mockRegisterTool } as any;

		registerSearchTool(mockPi, { runDdgsSearch: mockSearch });

		const toolConfig = mockRegisterTool.mock.calls[0][0];
		const execute = toolConfig.execute;

		await execute("tool-call-id", { query: "test" }, null as any, null as any, null as any);

		expect(mockSearch).toHaveBeenCalledWith("test", 10);
	});

	it("returns formatted results with details", async () => {
		const mockSearch = mock(() => [
			{ title: "Result 1", href: "https://example.com/1", body: "Body 1" },
			{ title: "Result 2", href: "https://example.com/2", body: "Body 2" },
		]);
		const mockRegisterTool = mock();
		const mockPi = { registerTool: mockRegisterTool } as any;

		registerSearchTool(mockPi, { runDdgsSearch: mockSearch });

		const toolConfig = mockRegisterTool.mock.calls[0][0];
		const execute = toolConfig.execute;

		const result = await execute(
			"tool-call-id",
			{ query: "test" },
			null as any,
			null as any,
			null as any,
		);

		expect(result.details.query).toBe("test");
		expect(result.details.resultCount).toBe(2);
		expect(result.details.results).toHaveLength(2);
	});

	it("throws error on search failure", async () => {
		const mockSearch = mock(() => {
			throw new Error("Search API failed");
		});
		const mockRegisterTool = mock();
		const mockPi = { registerTool: mockRegisterTool } as any;

		registerSearchTool(mockPi, { runDdgsSearch: mockSearch });

		const toolConfig = mockRegisterTool.mock.calls[0][0];
		const execute = toolConfig.execute;

		await expect(
			execute("tool-call-id", { query: "test" }, null as any, null as any, null as any),
		).rejects.toThrow("Search failed");
	});
});
