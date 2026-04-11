import { describe, expect, it } from "bun:test";
import { MAX_CONTENT_LENGTH } from "../constants";
import {
	formatCommitView,
	formatDirectoryListing,
	formatFileContent,
	formatRepoOverview,
	type TreeEntry,
} from "./format";

describe("GitHub Format", () => {
	describe("escapeBackticks", () => {
		it("escapes backticks in file path", () => {
			// escapeBackticks is used in metadata (file path), not in content
			const result = formatFileContent(
				"content",
				"file`with`backticks.ts",
				"owner",
				"repo",
				null,
			);
			// Backticks are escaped with \\` in the output
			expect(result).toContain("file\\`with\\`backticks.ts");
		});

		it("handles multiple backticks in file path", () => {
			const result = formatFileContent("content", "``multiple``.ts", "owner", "repo", null);
			// Multiple backticks are escaped
			expect(result).toContain("\\`\\`multiple\\`\\`.ts");
		});
	});

	describe("truncateContent", () => {
		it("returns content unchanged when under limit", () => {
			const content = "short content";
			const result = formatFileContent(content, "file.ts", "owner", "repo", null);
			expect(result).toContain(content);
		});

		it("truncates content when over limit", () => {
			const longContent = "x".repeat(MAX_CONTENT_LENGTH + 1000);
			const result = formatFileContent(longContent, "file.ts", "owner", "repo", null);
			expect(result).toContain("⚠️ Content truncated to fit limits.");
		});
	});

	describe("buildHeader", () => {
		it("creates header with owner and repo", () => {
			const result = formatRepoOverview([], null, "owner", "repo", null, "main");
			expect(result).toContain("github.com/owner/repo");
		});

		it("includes metadata in header", () => {
			const result = formatFileContent(
				"content",
				"file.ts",
				"owner",
				"repo",
				null,
				1024,
				"main",
			);
			expect(result).toContain("**File:**");
			expect(result).toContain("**Branch:**");
		});

		it("filters out empty metadata values", () => {
			const result = formatRepoOverview([], null, "owner", "repo", null, "main");
			expect(result).toContain("**Branch:** main");
		});
	});

	describe("formatRepoOverview", () => {
		it("returns error for invalid owner", () => {
			const result = formatRepoOverview([], null, "", "repo", null);
			expect(result).toContain("(invalid repository: missing owner or repo name)");
		});

		it("returns error for invalid repo", () => {
			const result = formatRepoOverview([], null, "owner", "", null);
			expect(result).toContain("(invalid repository: missing owner or repo name)");
		});

		it("includes local path in output", () => {
			const result = formatRepoOverview(
				[],
				null,
				"owner",
				"repo",
				"/tmp/repo",
				"main",
				"abc123",
			);
			expect(result).toContain("/tmp/repo");
			expect(result).toContain("Local path");
		});

		it("includes branch info", () => {
			const result = formatRepoOverview([], null, "owner", "repo", null, "main", "abc123def");
			expect(result).toContain("main");
			expect(result).toContain("sha: abc123d");
		});

		it("includes tree listing", () => {
			const entries: TreeEntry[] = [
				{ path: "src", type: "tree" },
				{ path: "README.md", type: "blob", size: 100 },
			];
			const result = formatRepoOverview(entries, null, "owner", "repo", null);
			expect(result).toContain("## Repository Tree");
			expect(result).toContain("src/");
			expect(result).toContain("README.md");
		});

		it("includes README content", () => {
			const result = formatRepoOverview([], "# Hello", "owner", "repo", null);
			expect(result).toContain("## README.md");
			expect(result).toContain("# Hello");
		});

		it("includes exploration hints for local paths", () => {
			const result = formatRepoOverview([], null, "owner", "repo", "/tmp/repo");
			expect(result).toContain("You can explore this repo using");
			expect(result).toContain("read");
			expect(result).toContain("bash");
		});
	});

	describe("formatDirectoryListing", () => {
		it("returns error for invalid owner", () => {
			const result = formatDirectoryListing([], "path", "", "repo", null);
			expect(result).toContain("(invalid repository: missing owner or repo name)");
		});

		it("returns error for invalid repo", () => {
			const result = formatDirectoryListing([], "path", "owner", "", null);
			expect(result).toContain("(invalid repository: missing owner or repo name)");
		});

		it("includes path in metadata", () => {
			const result = formatDirectoryListing([], "src", "owner", "repo", null, "main");
			expect(result).toContain("src");
			expect(result).toContain("Path");
		});

		it("includes directory contents", () => {
			const entries: TreeEntry[] = [
				{ path: "file1.ts", type: "blob" },
				{ path: "file2.ts", type: "blob" },
			];
			const result = formatDirectoryListing(entries, "src", "owner", "repo", null);
			expect(result).toContain("## Directory Contents");
			expect(result).toContain("file1.ts");
			expect(result).toContain("file2.ts");
		});
	});

	describe("formatFileContent", () => {
		it("returns error for invalid owner", () => {
			const result = formatFileContent("content", "file.ts", "", "repo", null);
			expect(result).toContain("(invalid repository: missing owner or repo name)");
		});

		it("returns error for invalid repo", () => {
			const result = formatFileContent("content", "file.ts", "owner", "", null);
			expect(result).toContain("(invalid repository: missing owner or repo name)");
		});

		it("includes file metadata", () => {
			const result = formatFileContent(
				"content",
				"src/file.ts",
				"owner",
				"repo",
				null,
				1024,
				"main",
				"base64",
			);
			expect(result).toContain("src/file.ts");
			expect(result).toContain("File");
			expect(result).toContain("Size");
			expect(result).toContain("Encoding");
		});

		it("includes file content", () => {
			const result = formatFileContent("console.log('hi')", "file.ts", "owner", "repo", null);
			expect(result).toContain("## File Contents");
			expect(result).toContain("console.log('hi')");
		});

		it("truncates large file content", () => {
			const largeContent = "x".repeat(MAX_CONTENT_LENGTH + 1000);
			const result = formatFileContent(largeContent, "file.ts", "owner", "repo", null);
			expect(result).toContain("⚠️ Content truncated to fit limits.");
		});
	});

	describe("formatCommitView", () => {
		it("includes commit SHA", () => {
			const result = formatCommitView("abc123def456", "Fix bug", "Alice", "2024-01-01");
			expect(result).toContain("abc123d");
			expect(result).toContain("abc123def456");
		});

		it("includes repository info when provided", () => {
			const result = formatCommitView(
				"abc123",
				"Fix bug",
				"Alice",
				"2024-01-01",
				undefined,
				"owner",
				"repo",
			);
			expect(result).toContain("github.com/owner/repo");
		});

		it("includes author and date", () => {
			const result = formatCommitView("abc123", "Fix bug", "Alice", "2024-01-01");
			expect(result).toContain("Alice");
			expect(result).toContain("2024-01-01");
		});

		it("includes commit message", () => {
			const result = formatCommitView("abc123", "Fix critical bug", "Alice", "2024-01-01");
			expect(result).toContain("Fix critical bug");
			expect(result).toContain("Message");
		});

		it("includes diff when provided", () => {
			const result = formatCommitView(
				"abc123",
				"Fix bug",
				"Alice",
				"2024-01-01",
				"diff content",
			);
			expect(result).toContain("## Diff");
			expect(result).toContain("diff content");
		});

		it("truncates large diffs", () => {
			const largeDiff = "x".repeat(MAX_CONTENT_LENGTH + 1000);
			const result = formatCommitView("abc123", "Fix bug", "Alice", "2024-01-01", largeDiff);
			expect(result).toContain("⚠️ Content truncated to fit limits.");
		});
	});

	describe("formatTree", () => {
		it("returns (empty) for empty entries", () => {
			const result = formatRepoOverview([], null, "owner", "repo", null);
			expect(result).toContain("(empty)");
		});

		it("sorts directories before files", () => {
			const entries: TreeEntry[] = [
				{ path: "z-file.ts", type: "blob" },
				{ path: "a-dir", type: "tree" },
			];
			const result = formatRepoOverview(entries, null, "owner", "repo", null);
			const dirIndex = result.indexOf("a-dir/");
			const fileIndex = result.indexOf("z-file.ts");
			expect(dirIndex).toBeGreaterThan(0);
			expect(fileIndex).toBeGreaterThan(dirIndex);
		});

		it("sorts alphabetically within type", () => {
			const entries: TreeEntry[] = [
				{ path: "z-file.ts", type: "blob" },
				{ path: "a-file.ts", type: "blob" },
			];
			const result = formatRepoOverview(entries, null, "owner", "repo", null);
			const zIndex = result.indexOf("z-file.ts");
			const aIndex = result.indexOf("a-file.ts");
			expect(aIndex).toBeLessThan(zIndex);
		});

		it("adds trailing slash to directories", () => {
			const entries: TreeEntry[] = [{ path: "src", type: "tree" }];
			const result = formatRepoOverview(entries, null, "owner", "repo", null);
			expect(result).toContain("src/");
		});

		it("includes file sizes", () => {
			const entries: TreeEntry[] = [{ path: "file.ts", type: "blob", size: 1024 }];
			const result = formatRepoOverview(entries, null, "owner", "repo", null);
			expect(result).toContain("1.0 KB");
		});
	});

	describe("formatFileSize", () => {
		it("formats bytes", () => {
			const result = formatFileContent("x", "file.ts", "owner", "repo", null, 500);
			expect(result).toContain("500 B");
		});

		it("formats kilobytes", () => {
			const result = formatFileContent("x", "file.ts", "owner", "repo", null, 1536);
			expect(result).toContain("1.5 KB");
		});

		it("formats megabytes", () => {
			const result = formatFileContent("x", "file.ts", "owner", "repo", null, 2_097_152);
			expect(result).toContain("2.0 MB");
		});

		it("formats gigabytes", () => {
			const result = formatFileContent("x", "file.ts", "owner", "repo", null, 1_610_612_736);
			expect(result).toContain("1.5 GB");
		});
	});

	describe("integration", () => {
		it("full repo overview formatting", () => {
			const entries: TreeEntry[] = [
				{ path: "src", type: "tree" },
				{ path: "tests", type: "tree" },
				{ path: "README.md", type: "blob", size: 1024 },
				{ path: "package.json", type: "blob", size: 512 },
			];
			const readme = "# My Project\n\nA sample project.";
			const result = formatRepoOverview(
				entries,
				readme,
				"owner",
				"repo",
				"/tmp/repo",
				"main",
				"abc123def",
			);

			expect(result).toContain("github.com/owner/repo");
			expect(result).toContain("/tmp/repo");
			expect(result).toContain("main");
			expect(result).toContain("abc123d");
			expect(result).toContain("## Repository Tree");
			expect(result).toContain("## README.md");
			expect(result).toContain("My Project");
		});
	});
});
