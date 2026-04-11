/**
 * Clone Manager
 *
 * Manages session-scoped git clones. Clone on first access, reuse from cache.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	GITHUB_API_TIMEOUT_MS,
	GITHUB_CLONE_DIR_PREFIX,
	GITHUB_CLONE_TIMEOUT_MS,
	GITHUB_SIZE_THRESHOLD_MB,
} from "../constants";

// Regex for validating GitHub owner/repo names
const GITHUB_NAME_REGEX = /^[a-zA-Z0-9._-]+$/;
export interface RepoClone {
	localPath: string; // Absolute path to cloned repo on disk
	headSha: string; // HEAD SHA at clone time
	cloneUrl: string; // HTTPS clone URL used
	owner: string;
	repo: string;
	clonedAt: number; // Timestamp
}

export interface CloneManagerOptions {
	execSync?: typeof execFileSync; // For DI in tests
	tmpDir?: string; // Override temp directory
}

export class CloneManager {
	private cache: Map<string, RepoClone>;
	private pendingClones: Map<string, Promise<RepoClone>>;
	private execSync: typeof execFileSync;
	private tmpDir: string;
	private cleanupRegistered = false;
	constructor(options: CloneManagerOptions = {}) {
		this.cache = new Map();
		this.pendingClones = new Map();
		this.execSync = options.execSync ?? execFileSync;
		this.tmpDir = options.tmpDir ?? tmpdir();
		this.registerCleanup();
	}

	/**
	 * Register cleanup handlers for process exit
	 */
	private registerCleanup(): void {
		if (this.cleanupRegistered) return;
		this.cleanupRegistered = true;

		const cleanup = async () => {
			await this.clear();
		};

		process.on("SIGTERM", cleanup);
		process.on("SIGINT", cleanup);
		process.on("exit", () => {
			// Note: async cleanup won't work in exit handler, but we try anyway
			// for graceful shutdown scenarios
			void this.clear();
		});
	}

	/**
	 * Generate a cache key for owner/repo
	 */
	private cacheKey(owner: string, repo: string): string {
		return `${owner.toLowerCase()}/${repo.toLowerCase()}`;
	}

	/**
	 * Validate owner and repo parameters to prevent path traversal attacks
	 */
	private validateOwnerRepo(owner: string, repo: string): void {
		if (!owner || !repo) {
			throw new Error("Owner and repo parameters are required");
		}
		if (!GITHUB_NAME_REGEX.test(owner)) {
			throw new Error(`Invalid owner name: ${owner}. Must match ${GITHUB_NAME_REGEX}`);
		}
		if (!GITHUB_NAME_REGEX.test(repo)) {
			throw new Error(`Invalid repo name: ${repo}. Must match ${GITHUB_NAME_REGEX}`);
		}
	}

	/**
	 * Get existing clone or clone the repo. Throws on failure.
	 * @param owner - GitHub owner/organization name
	 * @param repo - GitHub repository name
	 * @param options - Optional clone options
	 * @param options.forceClone - Force re-clone even if cached
	 * @param options.ref - Specific branch, tag, or SHA to checkout
	 * @returns RepoClone object with local path and metadata
	 * @throws Error if validation fails, clone fails, or checkout fails
	 */
	async getOrClone(
		owner: string,
		repo: string,
		options: { forceClone?: boolean; ref?: string } = {},
	): Promise<RepoClone> {
		// Validate owner and repo parameters
		this.validateOwnerRepo(owner, repo);
		const { forceClone = false, ref } = options;
		const cacheKey = this.cacheKey(owner, repo);

		// Handle forceClone BEFORE cache check
		if (forceClone) {
			const cached = this.cache.get(cacheKey);
			if (cached && existsSync(cached.localPath)) {
				await rm(cached.localPath, { recursive: true, force: true });
			}
			this.cache.delete(cacheKey);
			this.pendingClones.delete(cacheKey);
		}

		let clone = this.cache.get(cacheKey);
		// Use try/catch to avoid TOCTOU race condition
		if (clone) {
			try {
				// Verify directory still exists by attempting to access it
				this.execSync("git", ["rev-parse", "--git-dir"], {
					cwd: clone.localPath,
					stdio: "pipe",
					timeout: GITHUB_API_TIMEOUT_MS,
				});
				// If a specific ref is requested, checkout to it
				if (ref && ref !== clone.headSha.slice(0, 7)) {
					this.checkoutRef(clone.localPath, ref);
				}
				return clone;
			} catch {
				// Directory deleted or inaccessible, remove from cache
				this.cache.delete(cacheKey);
				clone = undefined;
			}
		}

		// Check if a clone is already in-flight for this repo
		const pendingClone = this.pendingClones.get(cacheKey);
		if (pendingClone) {
			// Another clone is in progress, wait for it
			return pendingClone;
		}

		// Register the pending clone promise BEFORE any expensive operations
		// This prevents race conditions where concurrent callers both see no pending
		// clone and start duplicate work
		const clonePromise = (async (): Promise<RepoClone> => {
			// Create temp directory for this clone
			const cloneDir = await mkdtemp(
				join(this.tmpDir, `${GITHUB_CLONE_DIR_PREFIX}${owner}-${repo}-`),
			);

			try {
				// Try gh repo clone first (handles auth for private repos)
				const cloneUrl = `https://github.com/${owner}/${repo}.git`;
				let usedGh = false;
				try {
					// Try gh repo clone with specific branch if ref is provided
					const ghArgs = ref
						? ["repo", "clone", `${owner}/${repo}`, cloneDir, "--", "-b", ref]
						: ["repo", "clone", `${owner}/${repo}`, cloneDir];
					this.execSync("gh", ghArgs, {
						stdio: "pipe",
						timeout: GITHUB_CLONE_TIMEOUT_MS,
					});
					usedGh = true;
				} catch (ghError: unknown) {
					const _ghErr = ghError as Error | { message: string };
					// Fall back to git clone
					try {
						// For shallow clone with specific ref, use --branch instead of --depth 1 alone
						// This ensures we can checkout the requested ref
						const gitArgs = ref
							? ["clone", "--depth", "1", "--branch", ref, cloneUrl, cloneDir]
							: ["clone", "--depth", "1", cloneUrl, cloneDir];
						this.execSync("git", gitArgs, {
							stdio: "pipe",
							timeout: GITHUB_CLONE_TIMEOUT_MS,
						});
					} catch (gitError: unknown) {
						const gitErr = gitError as Error | { message: string };
						throw new Error(`Both gh and git clone failed`, { cause: gitErr });
					}
				}
				// Get HEAD SHA with timeout
				let headSha = this.execSync("git", ["rev-parse", "HEAD"], {
					cwd: cloneDir,
					encoding: "utf-8",
					timeout: GITHUB_API_TIMEOUT_MS,
				}).trim();
				// Checkout specific ref if requested (for non-shallow clones with gh)
				if (ref && usedGh) {
					// For git clone with --branch, we already have the ref
					// For gh clone, we need to checkout
					this.checkoutRef(cloneDir, ref);
					// Update HEAD SHA after checkout
					const newSha = this.execSync("git", ["rev-parse", "HEAD"], {
						cwd: cloneDir,
						encoding: "utf-8",
						timeout: GITHUB_API_TIMEOUT_MS,
					}).trim();
					headSha = newSha;
				}
				clone = {
					localPath: cloneDir,
					headSha,
					cloneUrl,
					owner,
					repo,
					clonedAt: Date.now(),
				};
				// Cache it
				this.cache.set(cacheKey, clone);
				return clone;
			} catch (error: unknown) {
				const err = error as Error | { message: string };
				// Clean up failed clone
				await rm(cloneDir, { recursive: true, force: true });
				throw new Error(`Failed to clone ${owner}/${repo}`, { cause: err });
			} finally {
				// Clean up the pending clone entry (success or failure)
				this.pendingClones.delete(cacheKey);
			}
		})();

		// Store the promise in pendingClones BEFORE returning it
		// This ensures concurrent callers await the same promise
		this.pendingClones.set(cacheKey, clonePromise);

		return clonePromise;
	}

	/**
	 * Checkout a specific ref (branch, tag, or SHA)
	 * @param clonePath - Local path to the cloned repository
	 * @param ref - Branch name, tag, or commit SHA to checkout
	 * @throws Error if checkout fails
	 */
	private checkoutRef(clonePath: string, ref: string): void {
		try {
			// Try to fetch the ref first (in case it's a remote branch)
			try {
				this.execSync("git", ["fetch", "origin", ref], {
					cwd: clonePath,
					stdio: "pipe",
					timeout: GITHUB_API_TIMEOUT_MS,
				});
			} catch (fetchError: unknown) {
				// Log fetch errors for debugging but don't fail - checkout may still work
				// for local branches or tags
				const err = fetchError as Error | { message: string };
				console.warn(`Fetch for ref ${ref} failed: ${err.message}`);
			}

			// Try checkout with timeout
			this.execSync("git", ["checkout", ref], {
				cwd: clonePath,
				stdio: "pipe",
				timeout: GITHUB_API_TIMEOUT_MS,
			});
		} catch (error: unknown) {
			const err = error as Error | { message: string };
			throw new Error(`Failed to checkout ref ${ref}`, { cause: err });
		}
	}

	/**
	 * Check if we already have a clone for this owner/repo
	 * @param owner - GitHub owner/organization name
	 * @param repo - GitHub repository name
	 * @returns true if a clone exists in cache and on disk
	 */
	has(owner: string, repo: string): boolean {
		this.validateOwnerRepo(owner, repo);
		const cacheKey = this.cacheKey(owner, repo);
		const clone = this.cache.get(cacheKey);
		if (!clone) return false;
		return existsSync(clone.localPath);
	}

	/**
	 * Check repo size via GitHub API. Returns size in MB.
	 * @param owner - GitHub owner/organization name
	 * @param repo - GitHub repository name
	 * @returns Size of the repository in MB
	 */
	async getRepoSize(owner: string, repo: string): Promise<number> {
		this.validateOwnerRepo(owner, repo);
		try {
			// Try gh api first (handles auth for private repos)
			const result = this.execSync("gh", ["api", `repos/${owner}/${repo}`], {
				encoding: "utf-8",
				timeout: GITHUB_API_TIMEOUT_MS,
			});
			const data = JSON.parse(result);
			return (data.size || 0) / 1024; // API returns KB, convert to MB
		} catch (err: unknown) {
			const error = err as Error | { message: string };
			// Fail-safe: assume repo is too large if we can't determine size
			console.warn(`Could not determine repo size for ${owner}/${repo}: ${error.message}`);
			return GITHUB_SIZE_THRESHOLD_MB + 1;
		}
	}

	/**
	 * Check if repo is too large to clone
	 * @param owner - GitHub owner/organization name
	 * @param repo - GitHub repository name
	 * @returns true if repo size exceeds threshold
	 */
	async isRepoTooLarge(owner: string, repo: string): Promise<boolean> {
		const sizeMb = await this.getRepoSize(owner, repo);
		return sizeMb > GITHUB_SIZE_THRESHOLD_MB;
	}

	/**
	 * Get a clone from cache (without cloning)
	 * @param owner - GitHub owner/organization name
	 * @param repo - GitHub repository name
	 * @returns RepoClone if cached, undefined otherwise
	 */
	get(owner: string, repo: string): RepoClone | undefined {
		this.validateOwnerRepo(owner, repo);
		const cacheKey = this.cacheKey(owner, repo);
		const clone = this.cache.get(cacheKey);
		if (!clone || !existsSync(clone.localPath)) {
			return undefined;
		}
		return clone;
	}

	/**
	 * Clear all clones (delete from disk + clear in-memory cache)
	 * Resets cleanup flag to allow re-registration if needed
	 */
	async clear(): Promise<void> {
		const clones = [...this.cache.values()];
		const paths = clones.map((c) => c.localPath);

		// Delete directories first, before clearing the cache
		// This ensures we don't orphan directories if deletion fails
		const deletionResults = await Promise.all(
			paths.map(async (p) => {
				try {
					await rm(p, { recursive: true, force: true });
					return { path: p, success: true };
				} catch (error) {
					const err = error as Error | { message: string };
					console.warn(`Failed to delete clone directory ${p}: ${err.message}`);
					return { path: p, success: false };
				}
			}),
		);

		// Clear cache entries only for successfully deleted directories
		const failedPaths = new Set(deletionResults.filter((r) => !r.success).map((r) => r.path));
		for (const clone of clones) {
			if (!failedPaths.has(clone.localPath)) {
				this.cache.delete(this.cacheKey(clone.owner, clone.repo));
			}
		}

		// Clear pending clones and reset cleanup flag
		this.pendingClones.clear();
		this.cleanupRegistered = false;
	}
}
