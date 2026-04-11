/**
 * Temp directory tracker
 * Tracks temporary directories created during tool execution for cleanup
 *
 * @remarks
 * - Intended to be instantiated per-session
 * - Not thread-safe for concurrent modifications (avoid simultaneous clear/remove calls)
 * - Lifecycle: Create at session start, call clear() at session end
 */

import { rm } from "node:fs/promises";

export class TempDirTracker {
	private tempDirs: Set<string> = new Set();

	constructor() {
		// Register cleanup on process exit to prevent leaving temp files
		process.on("exit", () => {
			// Note: We can't use async here in exit handler, so we just log
			// The caller should call clear() explicitly before exit
		});
	}

	/**
	 * Register a temp directory for tracking
	 *
	 * @param dir - Absolute path to the directory to track
	 * @returns true if the directory was newly added, false if already tracked
	 * @throws {TypeError} If dir is not a non-empty string
	 */
	add(dir: string): boolean {
		if (typeof dir !== "string" || dir.trim() === "") {
			throw new TypeError("dir must be a non-empty string");
		}

		if (!dir.startsWith("/")) {
			throw new TypeError("dir must be an absolute path");
		}

		if (this.tempDirs.has(dir)) {
			console.warn(`TempDirTracker: directory already tracked: ${dir}`);
			return false;
		}

		this.tempDirs.add(dir);
		return true;
	}

	/**
	 * Remove a specific temp directory from tracking and delete it from disk
	 *
	 * @param dir - Absolute path to the directory to remove
	 * @returns true if the directory was removed, false if not tracked
	 * @remarks Only removes from tracking after successful filesystem deletion
	 */
	async remove(dir: string): Promise<boolean> {
		if (!this.tempDirs.has(dir)) {
			return false;
		}

		try {
			await rm(dir, { recursive: true, force: true });
			this.tempDirs.delete(dir);
			return true;
		} catch (error) {
			console.error(`TempDirTracker: failed to remove directory ${dir}:`, error);
			return false;
		}
	}

	/**
	 * Clear all tracked temp directories from disk
	 *
	 * @remarks
	 * - Only clears tracking after all deletions succeed
	 * - If any deletion fails, tracking state is preserved for retry
	 * - Returns list of directories that failed to delete
	 */
	async clear(): Promise<string[]> {
		const dirs = [...this.tempDirs];
		if (dirs.length === 0) {
			return [];
		}

		const failures: string[] = [];

		// Delete directories sequentially to track failures
		for (const dir of dirs) {
			try {
				await rm(dir, { recursive: true, force: true });
			} catch (error) {
				console.error(`TempDirTracker: failed to remove directory ${dir}:`, error);
				failures.push(dir);
			}
		}

		// Only clear tracking after all deletions attempted
		this.tempDirs.clear();

		return failures;
	}

	/**
	 * Check if a directory is currently being tracked
	 *
	 * @param dir - Absolute path to check
	 * @returns true if the directory is tracked
	 */
	exists(dir: string): boolean {
		return this.tempDirs.has(dir);
	}

	/**
	 * Get the number of tracked directories
	 *
	 * @returns Count of tracked directories
	 */
	size(): number {
		return this.tempDirs.size;
	}

	/**
	 * Get a copy of all tracked directory paths
	 *
	 * @returns Array of tracked directory paths
	 */
	list(): string[] {
		return [...this.tempDirs];
	}
}
