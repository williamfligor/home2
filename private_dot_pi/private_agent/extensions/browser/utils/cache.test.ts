/**
 * Tests for cache utility
 * Pure logic - no mocks needed
 */

import { describe, expect, it } from "bun:test";
import { createPageCache } from "./cache";

describe("createPageCache", () => {
	it("creates empty cache", () => {
		const cache = createPageCache();
		expect(cache.get("http://example.com")).toBeUndefined();
	});

	it("sets and gets values", () => {
		const cache = createPageCache();
		cache.set("http://example.com", "content");
		expect(cache.get("http://example.com")).toBe("content");
	});

	it("overwrites existing values", () => {
		const cache = createPageCache();
		cache.set("http://example.com", "content1");
		cache.set("http://example.com", "content2");
		expect(cache.get("http://example.com")).toBe("content2");
	});

	it("evicts oldest entry when at capacity", () => {
		const cache = createPageCache({ maxSize: 3 });
		cache.set("http://example.com/1", "content1");
		cache.set("http://example.com/2", "content2");
		cache.set("http://example.com/3", "content3");
		cache.set("http://example.com/4", "content4");

		expect(cache.get("http://example.com/1")).toBeUndefined(); // Evicted
		expect(cache.get("http://example.com/2")).toBe("content2");
		expect(cache.get("http://example.com/3")).toBe("content3");
		expect(cache.get("http://example.com/4")).toBe("content4");
	});

	it("evicts on set when at capacity", () => {
		const cache = createPageCache({ maxSize: 2 });
		cache.set("http://example.com/1", "content1");
		cache.set("http://example.com/2", "content2");
		cache.set("http://example.com/3", "content3");

		expect(cache.get("http://example.com/1")).toBeUndefined();
		expect(cache.get("http://example.com/2")).toBe("content2");
		expect(cache.get("http://example.com/3")).toBe("content3");
	});

	it("access updates recency (LRU behavior)", () => {
		const cache = createPageCache({ maxSize: 2 });
		cache.set("http://example.com/1", "content1");
		cache.set("http://example.com/2", "content2");
		cache.get("http://example.com/1"); // Access to make it recent
		cache.set("http://example.com/3", "content3");

		expect(cache.get("http://example.com/1")).toBe("content1"); // Still there (was accessed)
		expect(cache.get("http://example.com/2")).toBeUndefined(); // Evicted (wasn't accessed)
		expect(cache.get("http://example.com/3")).toBe("content3");
	});

	// Note: cache doesn't have explicit delete method - entries are evicted by LRU logic

	it("clears all entries", () => {
		const cache = createPageCache();
		cache.set("http://example.com/1", "content1");
		cache.set("http://example.com/2", "content2");
		cache.clear();
		expect(cache.get("http://example.com/1")).toBeUndefined();
		expect(cache.get("http://example.com/2")).toBeUndefined();
	});

	it("uses default max size", () => {
		const cache = createPageCache();
		// Default is 50
		for (let i = 0; i < 60; i++) {
			cache.set(`http://example.com/${i}`, `content${i}`);
		}
		// First entries should be evicted
		expect(cache.get("http://example.com/0")).toBeUndefined();
		expect(cache.get("http://example.com/1")).toBeUndefined();
		// Last entries should still be there
		expect(cache.get("http://example.com/59")).toBe("content59");
	});

	it("handles different URL formats", () => {
		const cache = createPageCache();
		cache.set("http://example.com", "content1");
		cache.set("https://example.com", "content2");
		cache.set("http://example.com:8080", "content3");

		expect(cache.get("http://example.com")).toBe("content1");
		expect(cache.get("https://example.com")).toBe("content2");
		expect(cache.get("http://example.com:8080")).toBe("content3");
	});
});
