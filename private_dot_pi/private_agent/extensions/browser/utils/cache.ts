/**
 * Page cache for the find tool
 * Uses factory pattern for dependency injection
 */

import { MAX_CACHE_SIZE, MAX_CONTENT_LENGTH } from "../constants";
import type { PageCache } from "../types";

/**
 * Internal cache entry with TTL support
 */
interface CacheEntry {
	content: string;
	timestamp: number;
}

/**
 * Create a page cache instance with LRU (Least Recently Used) eviction.
 *
 * When the cache reaches maxSize, the least recently accessed entry is
 * automatically removed to make room for new entries. Accessing an entry
 * via get() moves it to the "most recently used" position.
 *
 * @param options Configuration options
 * @param options.maxSize Maximum number of entries (default: 20)
 * @param options.ttlMs Time-to-live in milliseconds (default: 0, no expiration)
 * @returns A PageCache instance with get, set, has, and clear methods
 *
 * @example
 * const cache = createPageCache({ maxSize: 50 });
 * cache.set('https://example.com', 'content');
 * const content = cache.get('https://example.com');
 */
export function createPageCache(options?: { maxSize?: number; ttlMs?: number }): PageCache {
	const maxSize = options?.maxSize ?? MAX_CACHE_SIZE;
	const ttlMs = options?.ttlMs ?? 0;
	const cache = new Map<string, CacheEntry>();

	/**
	 * Validate and sanitize URL for use as cache key
	 */
	function validateUrl(url: string): string {
		if (!url || typeof url !== "string") {
			throw new Error("Invalid URL: URL must be a non-empty string");
		}

		const trimmed = url.trim();
		if (trimmed.length === 0) {
			throw new Error("Invalid URL: URL cannot be empty or whitespace");
		}

		// Limit URL length to prevent memory issues with extremely long keys
		const MAX_URL_LENGTH = 2048;
		if (trimmed.length > MAX_URL_LENGTH) {
			throw new Error(`URL exceeds maximum length of ${MAX_URL_LENGTH} characters`);
		}

		return trimmed;
	}

	/**
	 * Check if a cache entry has expired based on TTL
	 */
	function isExpired(entry: CacheEntry): boolean {
		if (ttlMs === 0) return false;
		return Date.now() - entry.timestamp > ttlMs;
	}
	return {
		get(url: string) {
			const entry = cache.get(url);
			if (entry === undefined) {
				return undefined;
			}

			// Check TTL expiration
			if (isExpired(entry)) {
				cache.delete(url);
				return undefined;
			}
			// Move to end (most recently used)
			cache.delete(url);
			cache.set(url, entry);
			return entry.content;
		},
		has(url: string): boolean {
			const entry = cache.get(url);
			if (entry === undefined) {
				return false;
			}

			// Check TTL expiration and clean up if expired
			if (isExpired(entry)) {
				cache.delete(url);
				return false;
			}

			// Update LRU position
			cache.delete(url);
			cache.set(url, entry);
			return true;
		},
		set(url: string, content: string) {
			// Validate URL
			url = validateUrl(url);

			// Validate content size to prevent memory exhaustion
			if (content.length > MAX_CONTENT_LENGTH) {
				console.warn(
					`Content for ${url.substring(0, 50)}... exceeds max length (${MAX_CONTENT_LENGTH} chars), skipping cache`,
				);
				return;
			}
			// Remove if exists to update position
			if (cache.has(url)) {
				cache.delete(url);
			}

			cache.set(url, { content, timestamp: Date.now() });
			// Evict oldest entries if cache grows too large
			if (cache.size > maxSize) {
				const firstKey = cache.keys().next().value;
				if (firstKey) cache.delete(firstKey);
			}
		},
		clear() {
			cache.clear();
		},
	};
}
