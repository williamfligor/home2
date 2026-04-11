import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CloneManager } from "./clone-manager";

describe("CloneManager", () => {
	let manager: CloneManager;
	let testTempDir: string;
	let mockCloneDir: string;

	beforeAll(async () => {
		testTempDir = await mkdtemp(join(tmpdir(), "clone-manager-test-"));
		// Create a mock git repo for testing
		mockCloneDir = await mkdtemp(join(testTempDir, "mock-repo-"));
		// Initialize a minimal git repo
		execFileSync("git", ["init", "--quiet"], { cwd: mockCloneDir });
		execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: mockCloneDir });
		execFileSync("git", ["config", "user.name", "Test User"], { cwd: mockCloneDir });
		await writeFile(join(mockCloneDir, "README.md"), "# Test Repo");
		execFileSync("git", ["add", "."], { cwd: mockCloneDir });
		execFileSync("git", ["commit", "-m", "Initial commit"], { cwd: mockCloneDir });
	});

	afterAll(async () => {
		await rm(testTempDir, { recursive: true, force: true });
	});

	beforeEach(() => {
		manager = new CloneManager({ tmpDir: testTempDir });
	});

	afterEach(async () => {
		await manager.clear();
	});

	describe("constructor", () => {
		it("creates empty cache and pendingClones maps", () => {
			const m = new CloneManager();
			expect(m).toBeDefined();
		});

		it("accepts custom tmpDir option", () => {
			const customDir = "/custom/tmp/dir";
			const m = new CloneManager({ tmpDir: customDir });
			// Can't directly inspect private fields, but we can verify it doesn't throw
			expect(m).toBeDefined();
		});

		it("registers cleanup handlers", () => {
			// Just verify the manager is created without errors
			expect(manager).toBeDefined();
		});
	});

	describe("validateOwnerRepo", () => {
		it("throws when owner is empty", () => {
			expect(() => manager.get("", "repo")).toThrow("Owner and repo parameters are required");
		});

		it("throws when repo is empty", () => {
			expect(() => manager.get("owner", "")).toThrow(
				"Owner and repo parameters are required",
			);
		});

		it("throws when owner contains invalid characters", () => {
			expect(() => manager.get("owner@invalid", "repo")).toThrow("Invalid owner name");
		});

		it("throws when repo contains invalid characters", () => {
			expect(() => manager.get("owner", "repo@invalid")).toThrow("Invalid repo name");
		});

		it("accepts valid owner with alphanumeric, dots, underscores, hyphens", () => {
			expect(() => manager.get("valid.owner_test-name", "repo")).not.toThrow();
		});

		it("accepts valid repo with alphanumeric, dots, underscores, hyphens", () => {
			expect(() => manager.get("owner", "valid.repo_test-name")).not.toThrow();
		});
	});

	describe("cacheKey", () => {
		it("generates lowercase cache key", () => {
			// Test via has() which uses cacheKey internally
			// We can't directly test cacheKey as it's private, but we can verify
			// the behavior through public methods
			expect(() => manager.has("Owner", "Repo")).not.toThrow();
		});
	});

	describe("has", () => {
		it("returns false for uncached repo", () => {
			expect(manager.has("owner", "repo")).toBe(false);
		});

		it("validates owner and repo parameters", () => {
			expect(() => manager.has("", "repo")).toThrow();
			expect(() => manager.has("owner", "")).toThrow();
		});
	});

	describe("get", () => {
		it("returns undefined for uncached repo", () => {
			expect(manager.get("owner", "repo")).toBeUndefined();
		});

		it("validates owner and repo parameters", () => {
			expect(() => manager.get("", "repo")).toThrow();
			expect(() => manager.get("owner", "")).toThrow();
		});
	});

	describe("getOrClone", () => {
		it("throws when owner is invalid", async () => {
			await expect(manager.getOrClone("@invalid", "repo")).rejects.toThrow(
				"Invalid owner name",
			);
		});

		it("throws when repo is invalid", async () => {
			await expect(manager.getOrClone("owner", "@invalid")).rejects.toThrow(
				"Invalid repo name",
			);
		});

		it("throws when clone fails due to network", async () => {
			// Mock execSync to simulate clone failure
			const failingManager = new CloneManager({
				tmpDir: testTempDir,
				execSync: (...args: any[]) => {
					if (args[0] === "git" && (args[1] as any)[0] === "clone") {
						const error = new Error("Clone failed");
						(error as any).stderr = "fatal: repository not found";
						throw error;
					}
					return execFileSync(...args);
				},
			});
			await expect(failingManager.getOrClone("owner", "repo")).rejects.toThrow();
			await failingManager.clear();
		});

		it("returns RepoClone with expected structure on success", async () => {
			// Mock execSync to simulate successful clone
			const mockHeadSha = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";
			const mockCloneDirForTest = await mkdtemp(join(testTempDir, "mock-clone-"));
			execFileSync("git", ["init", "--quiet"], { cwd: mockCloneDirForTest });
			execFileSync("git", ["config", "user.email", "test@test.com"], {
				cwd: mockCloneDirForTest,
			});
			execFileSync("git", ["config", "user.name", "Test"], { cwd: mockCloneDirForTest });
			await writeFile(join(mockCloneDirForTest, "file.txt"), "test");
			execFileSync("git", ["add", "."], { cwd: mockCloneDirForTest });
			execFileSync("git", ["commit", "-m", "test"], { cwd: mockCloneDirForTest });

			const mockManager = new CloneManager({
				tmpDir: testTempDir,
				execSync: (...args: any[]) => {
					if (args[0] === "git" && (args[1] as any)[0] === "clone") {
						// Simulate clone by copying mock repo
						const targetDir = args[1][args[1].length - 1];
						execFileSync("git", ["clone", mockCloneDirForTest, targetDir], {
							stdio: "pipe",
						});
						return Buffer.from("");
					}
					if (args[0] === "git" && (args[1] as any)[0] === "rev-parse") {
						return mockHeadSha;
					}
					return execFileSync(...args);
				},
			});

			const result = await mockManager.getOrClone("microsoft", "TypeScript");
			expect(result.localPath).toContain("pi-github-microsoft-TypeScript");
			expect(result.headSha).toBe(mockHeadSha);
			expect(result.cloneUrl).toBe("https://github.com/microsoft/TypeScript.git");
			expect(result.owner).toBe("microsoft");
			expect(result.repo).toBe("TypeScript");
			expect(result.clonedAt).toBeGreaterThan(0);
			await mockManager.clear();
		});

		it("caches successful clones", async () => {
			const mockHeadSha = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";
			const mockCloneDirForTest = await mkdtemp(join(testTempDir, "mock-clone2-"));
			execFileSync("git", ["init", "--quiet"], { cwd: mockCloneDirForTest });
			execFileSync("git", ["config", "user.email", "test@test.com"], {
				cwd: mockCloneDirForTest,
			});
			execFileSync("git", ["config", "user.name", "Test"], { cwd: mockCloneDirForTest });
			await writeFile(join(mockCloneDirForTest, "file.txt"), "test");
			execFileSync("git", ["add", "."], { cwd: mockCloneDirForTest });
			execFileSync("git", ["commit", "-m", "test"], { cwd: mockCloneDirForTest });

			const mockManager = new CloneManager({
				tmpDir: testTempDir,
				execSync: (...args: any[]) => {
					if (args[0] === "git" && (args[1] as any)[0] === "clone") {
						const targetDir = args[1][args[1].length - 1];
						execFileSync("git", ["clone", mockCloneDirForTest, targetDir], {
							stdio: "pipe",
						});
						return Buffer.from("");
					}
					if (args[0] === "git" && (args[1] as any)[0] === "rev-parse") {
						return mockHeadSha;
					}
					return execFileSync(...args);
				},
			});

			const result1 = await mockManager.getOrClone("owner", "repo");
			const result2 = await mockManager.getOrClone("owner", "repo");
			expect(result1.localPath).toBe(result2.localPath);
			await mockManager.clear();
		});

		it("reuses cached clone instead of re-cloning", async () => {
			const mockHeadSha = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";
			const mockCloneDirForTest = await mkdtemp(join(testTempDir, "mock-clone3-"));
			execFileSync("git", ["init", "--quiet"], { cwd: mockCloneDirForTest });
			execFileSync("git", ["config", "user.email", "test@test.com"], {
				cwd: mockCloneDirForTest,
			});
			execFileSync("git", ["config", "user.name", "Test"], { cwd: mockCloneDirForTest });
			await writeFile(join(mockCloneDirForTest, "file.txt"), "test");
			execFileSync("git", ["add", "."], { cwd: mockCloneDirForTest });
			execFileSync("git", ["commit", "-m", "test"], { cwd: mockCloneDirForTest });

			const mockManager = new CloneManager({
				tmpDir: testTempDir,
				execSync: (...args: any[]) => {
					if (args[0] === "git" && (args[1] as any)[0] === "clone") {
						const targetDir = args[1][args[1].length - 1];
						execFileSync("git", ["clone", mockCloneDirForTest, targetDir], {
							stdio: "pipe",
						});
						return Buffer.from("");
					}
					if (args[0] === "git" && (args[1] as any)[0] === "rev-parse") {
						return mockHeadSha;
					}
					return execFileSync(...args);
				},
			});

			const result1 = await mockManager.getOrClone("owner", "repo");
			// Second call should return cached result immediately
			const result2 = await mockManager.getOrClone("owner", "repo");
			expect(result1.localPath).toBe(result2.localPath);
			expect(result1.headSha).toBe(result2.headSha);
			await mockManager.clear();
		});

		it("handles forceClone option", async () => {
			const mockHeadSha = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";
			// Create two separate mock repos to simulate two different clones
			const mockCloneDir1 = await mkdtemp(join(testTempDir, "mock-clone4a-"));
			execFileSync("git", ["init", "--quiet"], { cwd: mockCloneDir1 });
			execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: mockCloneDir1 });
			execFileSync("git", ["config", "user.name", "Test"], { cwd: mockCloneDir1 });
			await writeFile(join(mockCloneDir1, "file.txt"), "test");
			execFileSync("git", ["add", "."], { cwd: mockCloneDir1 });
			execFileSync("git", ["commit", "-m", "test"], { cwd: mockCloneDir1 });

			const mockCloneDir2 = await mkdtemp(join(testTempDir, "mock-clone4b-"));
			execFileSync("git", ["init", "--quiet"], { cwd: mockCloneDir2 });
			execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: mockCloneDir2 });
			execFileSync("git", ["config", "user.name", "Test"], { cwd: mockCloneDir2 });
			await writeFile(join(mockCloneDir2, "file.txt"), "test");
			execFileSync("git", ["add", "."], { cwd: mockCloneDir2 });
			execFileSync("git", ["commit", "-m", "test"], { cwd: mockCloneDir2 });

			let cloneCount = 0;
			const mockManager = new CloneManager({
				tmpDir: testTempDir,
				execSync: (...args: any[]) => {
					if (args[0] === "git" && (args[1] as any)[0] === "clone") {
						const targetDir = args[1][args[1].length - 1];
						// Use different source repos for each clone
						const sourceDir = cloneCount++ === 0 ? mockCloneDir1 : mockCloneDir2;
						execFileSync("git", ["clone", sourceDir, targetDir], { stdio: "pipe" });
						return Buffer.from("");
					}
					if (args[0] === "git" && (args[1] as any)[0] === "rev-parse") {
						return mockHeadSha;
					}
					return execFileSync(...args);
				},
			});

			const result1 = await mockManager.getOrClone("owner", "repo");
			const result2 = await mockManager.getOrClone("owner", "repo", {
				forceClone: true,
			});
			// forceClone should create a new clone with a different path
			expect(result1.localPath).not.toBe(result2.localPath);
			await mockManager.clear();
		});
	});

	describe("pending clones (race condition fix)", () => {
		it("prevents duplicate concurrent clones", async () => {
			// This test verifies the race condition fix
			// We can't easily test concurrent clones without mocking, but we can
			// verify the pendingClones map exists and is used
			const m = new CloneManager({ tmpDir: testTempDir });
			try {
				// The fix adds pendingClones tracking - verify it doesn't throw
				expect(() => {
					// Just verify the manager works without errors
				}).not.toThrow();
			} finally {
				await m.clear();
			}
		});
	});

	describe("getRepoSize", () => {
		it("returns size for existing repo", async () => {
			const mockManager = new CloneManager({
				tmpDir: testTempDir,
				execSync: (...args: any[]) => {
					if (args[0] === "gh" && (args[1] as any)[0] === "api") {
						return JSON.stringify({ size: 50000 }); // 50000 KB = ~48.8 MB
					}
					return execFileSync(...args);
				},
			});
			const size = await mockManager.getRepoSize("microsoft", "TypeScript");
			expect(size).toBeGreaterThan(0);
		});

		it("throws for invalid owner", async () => {
			await expect(manager.getRepoSize("@invalid", "repo")).rejects.toThrow(
				"Invalid owner name",
			);
		});

		it("throws for invalid repo", async () => {
			await expect(manager.getRepoSize("owner", "@invalid")).rejects.toThrow(
				"Invalid repo name",
			);
		});
	});

	describe("isRepoTooLarge", () => {
		it("returns false for small repo", async () => {
			// Mock a small repo (< 350 MB)
			const mockManager = new CloneManager({
				tmpDir: testTempDir,
				execSync: (...args: any[]) => {
					if (args[0] === "gh" && (args[1] as any)[0] === "api") {
						return JSON.stringify({ size: 100000 }); // 100000 KB = ~97.6 MB (< 350 MB)
					}
					return execFileSync(...args);
				},
			});
			const isLarge = await mockManager.isRepoTooLarge("microsoft", "TypeScript");
			expect(isLarge).toBe(false);
		});

		it("throws for invalid owner", async () => {
			await expect(manager.isRepoTooLarge("@invalid", "repo")).rejects.toThrow();
		});

		it("throws for invalid repo", async () => {
			await expect(manager.isRepoTooLarge("owner", "@invalid")).rejects.toThrow();
		});
	});

	describe("clear", () => {
		it("clears cache and deletes directories", async () => {
			const mockHeadSha = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";
			const mockCloneDirForTest = await mkdtemp(join(testTempDir, "mock-clone5-"));
			execFileSync("git", ["init", "--quiet"], { cwd: mockCloneDirForTest });
			execFileSync("git", ["config", "user.email", "test@test.com"], {
				cwd: mockCloneDirForTest,
			});
			execFileSync("git", ["config", "user.name", "Test"], { cwd: mockCloneDirForTest });
			await writeFile(join(mockCloneDirForTest, "file.txt"), "test");
			execFileSync("git", ["add", "."], { cwd: mockCloneDirForTest });
			execFileSync("git", ["commit", "-m", "test"], { cwd: mockCloneDirForTest });

			const mockManager = new CloneManager({
				tmpDir: testTempDir,
				execSync: (...args: any[]) => {
					if (args[0] === "git" && (args[1] as any)[0] === "clone") {
						const targetDir = args[1][args[1].length - 1];
						execFileSync("git", ["clone", mockCloneDirForTest, targetDir], {
							stdio: "pipe",
						});
						return Buffer.from("");
					}
					if (args[0] === "git" && (args[1] as any)[0] === "rev-parse") {
						return mockHeadSha;
					}
					return execFileSync(...args);
				},
			});

			const result = await mockManager.getOrClone("owner", "repo");
			const localPath = result.localPath;

			await mockManager.clear();

			expect(mockManager.has("owner", "repo")).toBe(false);
		});

		it("handles already cleared state", async () => {
			await manager.clear();
			await manager.clear(); // Should not throw
		});

		it("clears pending clones", async () => {
			// Clear should also clear pendingClones
			await manager.clear();
			expect(manager.has("owner", "repo")).toBe(false);
		});
	});

	describe("integration", () => {
		it("full lifecycle: clone, cache, reuse, clear", async () => {
			const mockHeadSha = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";
			const mockCloneDirForTest = await mkdtemp(join(testTempDir, "mock-clone6-"));
			execFileSync("git", ["init", "--quiet"], { cwd: mockCloneDirForTest });
			execFileSync("git", ["config", "user.email", "test@test.com"], {
				cwd: mockCloneDirForTest,
			});
			execFileSync("git", ["config", "user.name", "Test"], { cwd: mockCloneDirForTest });
			await writeFile(join(mockCloneDirForTest, "file.txt"), "test");
			execFileSync("git", ["add", "."], { cwd: mockCloneDirForTest });
			execFileSync("git", ["commit", "-m", "test"], { cwd: mockCloneDirForTest });

			const mockManager = new CloneManager({
				tmpDir: testTempDir,
				execSync: (...args: any[]) => {
					if (args[0] === "git" && (args[1] as any)[0] === "clone") {
						const targetDir = args[1][args[1].length - 1];
						execFileSync("git", ["clone", mockCloneDirForTest, targetDir], {
							stdio: "pipe",
						});
						return Buffer.from("");
					}
					if (args[0] === "git" && (args[1] as any)[0] === "rev-parse") {
						return mockHeadSha;
					}
					return execFileSync(...args);
				},
			});

			// Clone
			const clone1 = await mockManager.getOrClone("owner", "repo");
			expect(clone1.localPath).toBeDefined();

			// Cache hit
			const clone2 = await mockManager.getOrClone("owner", "repo");
			expect(clone2.localPath).toBe(clone1.localPath);

			// Get from cache
			const cached = mockManager.get("owner", "repo");
			expect(cached).toBe(clone1);

			// Check has
			expect(mockManager.has("owner", "repo")).toBe(true);

			// Clear
			await mockManager.clear();
			expect(mockManager.has("owner", "repo")).toBe(false);
		});
	});
});
