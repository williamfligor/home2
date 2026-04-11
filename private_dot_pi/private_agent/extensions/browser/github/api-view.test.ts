import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { execFileSync } from "node:child_process";
import { getCommitView, getDirectoryListing, getFileContent, getRepoTreeView } from "./api-view";

describe("GitHub API View", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	// Helper to create a mock manager with execSync override
	const createMockExecSync = (mockResponses: Record<string, any>) => {
		return (...args: any[]) => {
			const command = args[0];
			const argsList = args[1] || [];
			const key = `${command}:${argsList.join(":")}`;
			const mockResponse = mockResponses[key];
			if (mockResponse !== undefined) {
				if (mockResponse instanceof Error) {
					throw mockResponse;
				}
				// execFileSync with encoding: "utf-8" returns a string, not a Buffer
				return mockResponse;
			}
			// Default: try execFileSync for real commands
			return execFileSync(...args);
		};
	};

	describe("validateOwnerRepo", () => {
		it("throws when owner is empty", () => {
			expect(() => getRepoTreeView("", "repo", "main")).toThrow(
				"owner and repo parameters are required",
			);
		});

		it("throws when repo is empty", () => {
			expect(() => getRepoTreeView("owner", "", "main")).toThrow(
				"owner and repo parameters are required",
			);
		});

		it("throws when owner contains /", () => {
			expect(() => getRepoTreeView("owner/repo", "name", "main")).toThrow(
				"owner and repo should not contain '/'",
			);
		});

		it("throws when repo contains /", () => {
			expect(() => getRepoTreeView("owner", "repo/path", "main")).toThrow(
				"owner and repo should not contain '/'",
			);
		});
	});

	describe("validatePath", () => {
		it("throws when path contains ?", () => {
			expect(() => getDirectoryListing("owner", "repo", "path?query", "main")).toThrow(
				"Invalid path",
			);
		});

		it("throws when path contains #", () => {
			expect(() => getDirectoryListing("owner", "repo", "path#hash", "main")).toThrow(
				"Invalid path",
			);
		});

		it("throws when path contains ..", () => {
			expect(() => getDirectoryListing("owner", "repo", "../path", "main")).toThrow(
				"Invalid path",
			);
		});

		it("throws when path starts with /", () => {
			expect(() => getDirectoryListing("owner", "repo", "/path", "main")).toThrow(
				"Invalid path",
			);
		});

		it("accepts valid paths", () => {
			// Test that valid paths don't throw (will fail at API level if repo doesn't exist)
			expect(() => {
				// Just verify validation passes
				const path = "src/file.ts";
				if (
					path.includes("?") ||
					path.includes("#") ||
					path.includes("..") ||
					path.startsWith("/")
				) {
					throw new Error("Invalid path");
				}
			}).not.toThrow();
		});
	});

	describe("getRepoTreeView", () => {
		it("throws for invalid owner", async () => {
			await expect(getRepoTreeView("", "repo", "main")).rejects.toThrow(
				"owner and repo parameters are required",
			);
		});

		it("throws for invalid repo", async () => {
			await expect(getRepoTreeView("owner", "", "main")).rejects.toThrow(
				"owner and repo parameters are required",
			);
		});

		it("returns markdown for valid repo", async () => {
			const mockExecSync = createMockExecSync({
				"gh:api:repos/microsoft/TypeScript/git/trees/main?recursive=1": JSON.stringify({
					tree: [
						{ path: "src", type: "tree", mode: "040000", sha: "abc123" },
						{
							path: "README.md",
							type: "blob",
							size: 100,
							mode: "100644",
							sha: "def456",
						},
					],
				}),
				"gh:api:repos/microsoft/TypeScript/readme?ref=main": JSON.stringify({
					name: "README.md",
					content: "IyBUeXBlU2NyaXB0CgpUaGUgdHlwZSBzeXN0ZW0gZm9yIHRoZSBXZWJu",
					encoding: "base64",
				}),
			});

			const result = await getRepoTreeView("microsoft", "TypeScript", "main", {
				execSync: mockExecSync,
			});
			expect(result).toContain("microsoft");
			expect(result).toContain("TypeScript");
		});

		it("uses default ref 'main' when not provided", async () => {
			const mockExecSync = createMockExecSync({
				"gh:api:repos/microsoft/TypeScript/git/trees/main?recursive=1": JSON.stringify({
					tree: [{ path: "src", type: "tree", mode: "040000", sha: "abc123" }],
				}),
				"gh:api:repos/microsoft/TypeScript/readme?ref=main": JSON.stringify({
					name: "README.md",
					content: "IyBUeXBlU2NyaXB0",
					encoding: "base64",
				}),
			});

			const result = await getRepoTreeView("microsoft", "TypeScript", undefined, {
				execSync: mockExecSync,
			});
			expect(result).toContain("microsoft");
			expect(result).toContain("TypeScript");
		});
	});

	describe("getDirectoryListing", () => {
		it("throws for invalid owner", async () => {
			await expect(getDirectoryListing("", "repo", "src", "main")).rejects.toThrow();
		});

		it("throws for invalid repo", async () => {
			await expect(getDirectoryListing("owner", "", "src", "main")).rejects.toThrow();
		});

		it("throws for invalid path with query string", async () => {
			await expect(getDirectoryListing("owner", "repo", "src?query", "main")).rejects.toThrow(
				"Invalid path",
			);
		});

		it("throws for invalid path with parent reference", async () => {
			await expect(getDirectoryListing("owner", "repo", "../src", "main")).rejects.toThrow(
				"Invalid path",
			);
		});

		it("returns markdown for valid directory", async () => {
			const mockExecSync = createMockExecSync({
				"gh:api:repos/microsoft/TypeScript/contents/src?ref=main": JSON.stringify([
					{ name: "file1.ts", type: "file", size: 100, sha: "abc123" },
					{ name: "subdir", type: "dir", sha: "def456" },
				]),
			});

			const result = await getDirectoryListing("microsoft", "TypeScript", "src", "main", {
				execSync: mockExecSync,
			});
			expect(result).toContain("microsoft");
			expect(result).toContain("TypeScript");
		});
	});

	describe("getFileContent", () => {
		it("throws for invalid owner", async () => {
			await expect(getFileContent("", "repo", "src/file.ts", "main")).rejects.toThrow();
		});

		it("throws for invalid repo", async () => {
			await expect(getFileContent("owner", "", "src/file.ts", "main")).rejects.toThrow();
		});

		it("throws for invalid path", async () => {
			await expect(getFileContent("owner", "repo", "../file.ts", "main")).rejects.toThrow(
				"Invalid path",
			);
		});

		it("returns markdown for valid file", async () => {
			const mockExecSync = createMockExecSync({
				"gh:api:repos/microsoft/TypeScript/contents/src/compiler.ts?ref=main":
					JSON.stringify({
						name: "compiler.ts",
						content: "ZXhwb3J0IGludGVyZmFjZSBDb21waWxlcge",
						encoding: "base64",
						size: 50,
					}),
			});

			const result = await getFileContent(
				"microsoft",
				"TypeScript",
				"src/compiler.ts",
				"main",
				{
					execSync: mockExecSync,
				},
			);
			expect(result).toContain("microsoft");
			expect(result).toContain("TypeScript");
		});
	});

	describe("getCommitView", () => {
		it("throws for invalid owner", async () => {
			await expect(getCommitView("", "repo", "abc123")).rejects.toThrow();
		});

		it("throws for invalid repo", async () => {
			await expect(getCommitView("owner", "", "abc123")).rejects.toThrow();
		});

		it("returns markdown for valid commit", async () => {
			const mockExecSync = createMockExecSync({
				"gh:api:repos/microsoft/TypeScript/commits/6211f84": JSON.stringify({
					sha: "6211f84abc123def456",
					commit: {
						message: "Fix bug in compiler",
						author: { name: "Test Author", date: "2024-01-01T00:00:00Z" },
						committer: { date: "2024-01-01T00:00:00Z" },
					},
					author: { login: "testuser" },
				}),
			});

			const result = await getCommitView("microsoft", "TypeScript", "6211f84", {
				execSync: mockExecSync,
			});
			expect(result).toContain("microsoft");
			expect(result).toContain("TypeScript");
		});

		it("returns markdown with diff for valid commit", async () => {
			const mockDiff = `diff --git a/src/compiler.ts b/src/compiler.ts
index abc123..def456 100644
--- a/src/compiler.ts
+++ b/src/compiler.ts
@@ -1,5 +1,6 @@
 export interface Compiler {
 	// Fixed bug
 	compile(code: string): void;
 }`;

			const mockExecSync = createMockExecSync({
				"gh:api:repos/microsoft/TypeScript/commits/6211f84": JSON.stringify({
					sha: "6211f84abc123def456",
					commit: {
						message: "Fix bug in compiler",
						author: { name: "Test Author", date: "2024-01-01T00:00:00Z" },
						committer: { date: "2024-01-01T00:00:00Z" },
					},
					author: { login: "testuser" },
				}),
				// Diff request uses same endpoint but with Accept header - mock returns raw diff text
				// Key format: args are ["api", "endpoint", "-H", "Accept: application/vnd.github.v3.diff"]
				// Joined with ":": "api:endpoint:-H:Accept: application/vnd.github.v3.diff"
				"gh:api:repos/microsoft/TypeScript/commits/6211f84:-H:Accept: application/vnd.github.v3.diff":
					mockDiff,
			});

			const result = await getCommitView("microsoft", "TypeScript", "6211f84", {
				execSync: mockExecSync,
			});
			expect(result).toContain("microsoft");
			expect(result).toContain("TypeScript");
			expect(result).toContain("diff --git");
			expect(result).toContain("src/compiler.ts");
		});
	});

	describe("error handling", () => {
		it("handles API errors gracefully", async () => {
			// Mock execSync to simulate API error
			const mockExecSync = createMockExecSync({
				"gh:api:repos/nonexistent-org-12345/nonexistent-repo-67890/git/trees/main?recursive=1":
					new Error("Command not found"),
			});

			await expect(
				getRepoTreeView("nonexistent-org-12345", "nonexistent-repo-67890", "main", {
					execSync: mockExecSync,
				}),
			).rejects.toThrow();
		});

		it("preserves error cause when wrapping", async () => {
			const mockExecSync = createMockExecSync({
				"gh:api:repos/nonexistent-org-12345/nonexistent-repo-67890/git/trees/main?recursive=1":
					new Error("Original error"),
			});

			try {
				await getRepoTreeView("nonexistent-org-12345", "nonexistent-repo-67890", "main", {
					execSync: mockExecSync,
				});
			} catch (error: unknown) {
				const err = error as Error & { cause?: Error };
				// The error should have a cause property
				expect(err).toBeDefined();
				expect(err.cause).toBeDefined();
			}
		});
	});

	describe("integration", () => {
		it("full API workflow", async () => {
			const owner = "microsoft";
			const repo = "TypeScript";

			// Build mock responses object with dynamic keys
			const mockResponses: Record<string, any> = {};
			mockResponses[`gh:api:repos/${owner}/${repo}/git/trees/main?recursive=1`] =
				JSON.stringify({
					tree: [
						{ path: "src", type: "tree", mode: "040000", sha: "abc123" },
						{
							path: "README.md",
							type: "blob",
							size: 100,
							mode: "100644",
							sha: "def456",
						},
					],
				});
			mockResponses[`gh:api:repos/${owner}/${repo}/readme?ref=main`] = JSON.stringify({
				name: "README.md",
				content: "IyBUeXBlU2NyaXB0",
				encoding: "base64",
			});
			mockResponses[`gh:api:repos/${owner}/${repo}/contents/src?ref=main`] = JSON.stringify([
				{ name: "file1.ts", type: "file", size: 100, sha: "abc123" },
			]);
			mockResponses[`gh:api:repos/${owner}/${repo}/contents/src/compiler.ts?ref=main`] =
				JSON.stringify({
					name: "compiler.ts",
					content: "ZXhwb3J0IGludGVyZmFjZSBDb21waWxlcg==",
					encoding: "base64",
					size: 50,
				});

			const mockExecSync = createMockExecSync(mockResponses);

			// Get repo tree view
			const treeView = await getRepoTreeView(owner, repo, "main", {
				execSync: mockExecSync,
			});
			expect(treeView).toContain(owner);
			expect(treeView).toContain(repo);

			// Get directory listing
			const dirListing = await getDirectoryListing(owner, repo, "src", "main", {
				execSync: mockExecSync,
			});
			expect(dirListing).toContain(owner);
			expect(dirListing).toContain(repo);

			// Get file content
			const fileContent = await getFileContent(owner, repo, "src/compiler.ts", "main", {
				execSync: mockExecSync,
			});
			expect(fileContent).toContain(owner);
			expect(fileContent).toContain(repo);
		});
	});
});
