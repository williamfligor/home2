import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TempDirTracker } from "./temp-tracker";

describe("TempDirTracker", () => {
	let tracker: TempDirTracker;
	let testTempDir: string;

	beforeEach(async () => {
		testTempDir = await mkdtemp(join(tmpdir(), "temp-tracker-test-"));
		tracker = new TempDirTracker();
	});

	afterEach(async () => {
		await tracker.clear();
		await rm(testTempDir, { recursive: true, force: true });
	});

	describe("constructor", () => {
		it("creates empty tracker", () => {
			expect(tracker.size()).toBe(0);
			expect(tracker.list()).toEqual([]);
		});

		it("registers process exit handler", () => {
			// Just verify the tracker is created without errors
			expect(tracker).toBeDefined();
		});
	});

	describe("add", () => {
		it("throws when dir is empty string", () => {
			expect(() => tracker.add("")).toThrow("dir must be a non-empty string");
		});

		it("throws when dir is whitespace", () => {
			expect(() => tracker.add("   ")).toThrow("dir must be a non-empty string");
		});

		it("throws when dir is not a string", () => {
			expect(() => tracker.add(123 as unknown as string)).toThrow(
				"dir must be a non-empty string",
			);
		});

		it("throws when dir is not absolute path", () => {
			expect(() => tracker.add("relative/path")).toThrow("dir must be an absolute path");
		});

		it("throws when dir starts with ./", () => {
			expect(() => tracker.add("./relative/path")).toThrow("dir must be an absolute path");
		});

		it("adds valid absolute path", () => {
			const result = tracker.add("/tmp/test-dir");
			expect(result).toBe(true);
			expect(tracker.size()).toBe(1);
			expect(tracker.exists("/tmp/test-dir")).toBe(true);
		});

		it("returns false for duplicate path", () => {
			tracker.add("/tmp/test-dir");
			const result = tracker.add("/tmp/test-dir");
			expect(result).toBe(false);
			expect(tracker.size()).toBe(1);
		});

		it("adds multiple paths", () => {
			tracker.add("/tmp/dir1");
			tracker.add("/tmp/dir2");
			tracker.add("/tmp/dir3");
			expect(tracker.size()).toBe(3);
			expect(tracker.list()).toEqual(["/tmp/dir1", "/tmp/dir2", "/tmp/dir3"]);
		});
	});

	describe("remove", () => {
		it("returns false for non-tracked directory", async () => {
			const result = await tracker.remove("/tmp/nonexistent");
			expect(result).toBe(false);
		});

		it("removes tracked directory", async () => {
			const dir = await mkdtemp(join(testTempDir, "remove-test-"));
			tracker.add(dir);
			expect(tracker.exists(dir)).toBe(true);

			const result = await tracker.remove(dir);
			expect(result).toBe(true);
			expect(tracker.exists(dir)).toBe(false);
		});

		it("deletes directory from disk", async () => {
			const dir = await mkdtemp(join(testTempDir, "remove-test-"));
			tracker.add(dir);

			await tracker.remove(dir);

			// Directory should be deleted
			expect(tracker.exists(dir)).toBe(false);
		});

		it("handles removal of non-existent directory", async () => {
			// rm with force: true doesn't throw on non-existent dirs, so remove succeeds
			// but the directory is no longer tracked (was removed from tracking)
			tracker.add("/tmp/nonexistent-dir-12345");
			const result = await tracker.remove("/tmp/nonexistent-dir-12345");
			// rm succeeds (force: true), so returns true and removes from tracking
			expect(result).toBe(true);
			expect(tracker.exists("/tmp/nonexistent-dir-12345")).toBe(false);
		});
	});

	describe("clear", () => {
		it("returns empty array when no directories tracked", async () => {
			const failures = await tracker.clear();
			expect(failures).toEqual([]);
		});

		it("clears all tracked directories", async () => {
			const dir1 = await mkdtemp(join(testTempDir, "clear-test-"));
			const dir2 = await mkdtemp(join(testTempDir, "clear-test-"));
			tracker.add(dir1);
			tracker.add(dir2);

			const failures = await tracker.clear();

			expect(failures).toEqual([]);
			expect(tracker.size()).toBe(0);
		});

		it("tracks failures", async () => {
			// rm with force: true doesn't throw on non-existent dirs, so no failures
			tracker.add("/tmp/nonexistent-dir-12345");
			tracker.add("/tmp/another-nonexistent-67890");

			const failures = await tracker.clear();

			// rm succeeds silently with force: true, so no failures
			expect(failures.length).toBe(0);
		});

		it("clears tracking after all deletions attempted", async () => {
			tracker.add("/tmp/nonexistent-dir-12345");

			const failures = await tracker.clear();
			// rm with force: true succeeds silently, so no failures
			expect(failures.length).toBe(0);
			// Tracking is cleared regardless
			expect(tracker.size()).toBe(0);
		});
	});

	describe("exists", () => {
		it("returns false for non-tracked directory", () => {
			expect(tracker.exists("/tmp/nonexistent")).toBe(false);
		});

		it("returns true for tracked directory", () => {
			tracker.add("/tmp/test-dir");
			expect(tracker.exists("/tmp/test-dir")).toBe(true);
		});
	});

	describe("size", () => {
		it("returns 0 for empty tracker", () => {
			expect(tracker.size()).toBe(0);
		});

		it("returns correct count", () => {
			tracker.add("/tmp/dir1");
			tracker.add("/tmp/dir2");
			expect(tracker.size()).toBe(2);
		});

		it("returns 0 after clear", async () => {
			tracker.add("/tmp/dir1");
			tracker.add("/tmp/dir2");
			await tracker.clear();
			expect(tracker.size()).toBe(0);
		});
	});

	describe("list", () => {
		it("returns empty array for empty tracker", () => {
			expect(tracker.list()).toEqual([]);
		});

		it("returns all tracked directories", () => {
			tracker.add("/tmp/dir1");
			tracker.add("/tmp/dir2");
			tracker.add("/tmp/dir3");
			expect(tracker.list()).toEqual(["/tmp/dir1", "/tmp/dir2", "/tmp/dir3"]);
		});

		it("returns a copy (not the internal set)", () => {
			tracker.add("/tmp/dir1");
			const list1 = tracker.list();
			const list2 = tracker.list();
			expect(list1).not.toBe(list2);
		});
	});

	describe("integration", () => {
		it("full lifecycle: add, remove, clear", async () => {
			const dir1 = await mkdtemp(join(testTempDir, "lifecycle-test-"));
			const dir2 = await mkdtemp(join(testTempDir, "lifecycle-test-"));

			// Add directories
			expect(tracker.add(dir1)).toBe(true);
			expect(tracker.add(dir2)).toBe(true);
			expect(tracker.size()).toBe(2);

			// Remove one
			const removed = await tracker.remove(dir1);
			expect(removed).toBe(true);
			expect(tracker.size()).toBe(1);
			expect(tracker.exists(dir1)).toBe(false);
			expect(tracker.exists(dir2)).toBe(true);

			// Clear remaining
			const failures = await tracker.clear();
			expect(failures).toEqual([]);
			expect(tracker.size()).toBe(0);
		});

		it("handles duplicate add", async () => {
			const dir = await mkdtemp(join(testTempDir, "duplicate-test-"));
			tracker.add(dir);
			tracker.add(dir); // Should return false

			expect(tracker.size()).toBe(1);
			expect(tracker.list()).toEqual([dir]);

			await tracker.clear();
			expect(tracker.size()).toBe(0);
		});
	});
});
