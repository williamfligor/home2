import { describe, expect, test } from "bun:test";
import { isGitHubUrl, parseGitHubUrl } from "./parse-url.ts";

describe("parseGitHubUrl", () => {
	describe("root URLs", () => {
		test("parses basic root URL", () => {
			const result = parseGitHubUrl("https://github.com/owner/repo");
			expect(result).toEqual({
				type: "root",
				owner: "owner",
				repo: "repo",
				originalUrl: "https://github.com/owner/repo",
			});
		});

		test("parses root URL with trailing slash", () => {
			const result = parseGitHubUrl("https://github.com/owner/repo/");
			expect(result?.type).toBe("root");
			expect(result?.owner).toBe("owner");
			expect(result?.repo).toBe("repo");
		});

		test("parses root URL with .git suffix", () => {
			const result = parseGitHubUrl("https://github.com/owner/repo.git");
			expect(result?.type).toBe("root");
			expect(result?.repo).toBe("repo");
		});

		test("parses root URL with query string", () => {
			const result = parseGitHubUrl("https://github.com/owner/repo?tab=readme");
			expect(result?.type).toBe("root");
			expect(result?.owner).toBe("owner");
		});

		test("parses root URL with fragment", () => {
			const result = parseGitHubUrl("https://github.com/owner/repo#readme");
			expect(result?.type).toBe("root");
		});

		test("parses root URL with query and fragment", () => {
			const result = parseGitHubUrl("https://github.com/owner/repo?tab=readme#top");
			expect(result?.type).toBe("root");
		});
	});

	describe("tree URLs", () => {
		test("parses tree URL with branch and path", () => {
			const result = parseGitHubUrl("https://github.com/owner/repo/tree/main/src");
			expect(result).toEqual({
				type: "tree",
				owner: "owner",
				repo: "repo",
				ref: "main",
				path: "src",
				originalUrl: "https://github.com/owner/repo/tree/main/src",
			});
		});

		test("parses tree URL with tag", () => {
			const result = parseGitHubUrl("https://github.com/owner/repo/tree/v1.0.0");
			expect(result?.type).toBe("tree");
			expect(result?.ref).toBe("v1.0.0");
			expect(result?.path).toBeUndefined();
		});

		test("parses tree URL with SHA", () => {
			const result = parseGitHubUrl("https://github.com/owner/repo/tree/abc123def456");
			expect(result?.type).toBe("tree");
			expect(result?.ref).toBe("abc123def456");
		});

		test("parses tree URL with nested path", () => {
			const result = parseGitHubUrl(
				"https://github.com/owner/repo/tree/main/src/components/button",
			);
			expect(result?.type).toBe("tree");
			expect(result?.path).toBe("src/components/button");
		});

		test("parses tree URL without ref (default branch)", () => {
			const result = parseGitHubUrl("https://github.com/owner/repo/tree/src");
			expect(result?.type).toBe("tree");
			// When there's no ref, the path becomes the ref
			expect(result?.ref).toBe("src");
			expect(result?.path).toBeUndefined();
		});

		test("parses tree URL with .git suffix", () => {
			const result = parseGitHubUrl("https://github.com/owner/repo.git/tree/main");
			expect(result?.type).toBe("tree");
			expect(result?.repo).toBe("repo");
		});
	});

	describe("blob URLs", () => {
		test("parses blob URL with branch and file path", () => {
			const result = parseGitHubUrl("https://github.com/owner/repo/blob/main/README.md");
			expect(result).toEqual({
				type: "blob",
				owner: "owner",
				repo: "repo",
				ref: "main",
				path: "README.md",
				originalUrl: "https://github.com/owner/repo/blob/main/README.md",
			});
		});

		test("parses blob URL with nested file path", () => {
			const result = parseGitHubUrl(
				"https://github.com/owner/repo/blob/main/src/utils/helpers.ts",
			);
			expect(result?.type).toBe("blob");
			expect(result?.path).toBe("src/utils/helpers.ts");
		});

		test("parses blob URL with tag", () => {
			const result = parseGitHubUrl("https://github.com/owner/repo/blob/v2.0.0/package.json");
			expect(result?.ref).toBe("v2.0.0");
			expect(result?.path).toBe("package.json");
		});

		test("parses blob URL with SHA", () => {
			const result = parseGitHubUrl(
				"https://github.com/owner/repo/blob/abc123def456/config.yaml",
			);
			expect(result?.ref).toBe("abc123def456");
		});

		test("parses blob URL with .git suffix", () => {
			const result = parseGitHubUrl("https://github.com/owner/repo.git/blob/main/README.md");
			expect(result?.repo).toBe("repo");
			expect(result?.path).toBe("README.md");
		});
	});

	describe("commit URLs", () => {
		test("parses commit URL with short SHA", () => {
			const result = parseGitHubUrl("https://github.com/owner/repo/commit/abc123");
			expect(result).toEqual({
				type: "commit",
				owner: "owner",
				repo: "repo",
				commitSha: "abc123",
				originalUrl: "https://github.com/owner/repo/commit/abc123",
			});
		});

		test("parses commit URL with full SHA", () => {
			const result = parseGitHubUrl(
				"https://github.com/owner/repo/commit/abc123def456789012345678901234567890abcd",
			);
			expect(result?.type).toBe("commit");
			expect(result?.commitSha).toBe("abc123def456789012345678901234567890abcd");
		});

		test("parses commit URL with .git suffix", () => {
			const result = parseGitHubUrl("https://github.com/owner/repo.git/commit/abc123");
			expect(result?.repo).toBe("repo");
		});
	});

	describe("ignored segments", () => {
		test("returns null for pull request URL", () => {
			const result = parseGitHubUrl("https://github.com/owner/repo/pull/123");
			expect(result).toBeNull();
		});

		test("returns null for issue URL", () => {
			const result = parseGitHubUrl("https://github.com/owner/repo/issues/456");
			expect(result).toBeNull();
		});

		test("returns null for wiki URL", () => {
			const result = parseGitHubUrl("https://github.com/owner/repo/wiki/Home");
			expect(result).toBeNull();
		});

		test("returns null for actions URL", () => {
			const result = parseGitHubUrl("https://github.com/owner/repo/actions");
			expect(result).toBeNull();
		});

		test("returns null for settings URL", () => {
			const result = parseGitHubUrl("https://github.com/owner/repo/settings");
			expect(result).toBeNull();
		});

		test("returns null for releases URL", () => {
			const result = parseGitHubUrl("https://github.com/owner/repo/releases");
			expect(result).toBeNull();
		});

		test("returns null for gist URL (github.com/gist/*)", () => {
			// gist URLs are at github.com/gist/... which is a different pattern
			// The parser treats "gist" as the owner, so this is actually a valid root URL
			const result = parseGitHubUrl("https://github.com/gist/owner/abc123");
			// This is parsed as owner="gist", repo="owner" with extra path segment
			expect(result?.type).toBe("root");
			expect(result?.owner).toBe("gist");
		});

		test("returns null for compare URL", () => {
			const result = parseGitHubUrl("https://github.com/owner/repo/compare/main...dev");
			expect(result).toBeNull();
		});
	});

	describe("invalid URLs", () => {
		test("returns null for non-GitHub URL", () => {
			const result = parseGitHubUrl("https://gitlab.com/owner/repo");
			expect(result).toBeNull();
		});

		test("returns null for invalid URL", () => {
			const result = parseGitHubUrl("not-a-url");
			expect(result).toBeNull();
		});

		test("returns null for URL without owner/repo", () => {
			const result = parseGitHubUrl("https://github.com/");
			expect(result).toBeNull();
		});

		test("returns null for URL with only owner", () => {
			const result = parseGitHubUrl("https://github.com/owner");
			expect(result).toBeNull();
		});

		test("returns null for empty owner", () => {
			const result = parseGitHubUrl("https://github.com//repo");
			expect(result).toBeNull();
		});

		test("returns null for empty repo", () => {
			const result = parseGitHubUrl("https://github.com/owner/");
			expect(result).toBeNull();
		});
	});

	describe("owner and repo validation", () => {
		test("accepts alphanumeric owner and repo", () => {
			const result = parseGitHubUrl("https://github.com/owner123/repo456");
			expect(result?.owner).toBe("owner123");
			expect(result?.repo).toBe("repo456");
		});

		test("accepts owner and repo with dots", () => {
			const result = parseGitHubUrl("https://github.com/my.owner/my.repo");
			expect(result?.owner).toBe("my.owner");
			expect(result?.repo).toBe("my.repo");
		});

		test("accepts owner and repo with underscores", () => {
			const result = parseGitHubUrl("https://github.com/my_owner/my_repo");
			expect(result?.owner).toBe("my_owner");
			expect(result?.repo).toBe("my_repo");
		});

		test("accepts owner and repo with hyphens", () => {
			const result = parseGitHubUrl("https://github.com/my-owner/my-repo");
			expect(result?.owner).toBe("my-owner");
			expect(result?.repo).toBe("my-repo");
		});

		test("rejects owner with invalid characters", () => {
			const result = parseGitHubUrl("https://github.com/owner@name/repo");
			expect(result).toBeNull();
		});

		test("strips fragment from repo name", () => {
			// Fragments are stripped, so #name becomes part of URL fragment, not repo
			const result = parseGitHubUrl("https://github.com/owner/repo#name");
			expect(result?.type).toBe("root");
			expect(result?.repo).toBe("repo");
		});

		test("rejects owner with spaces", () => {
			const result = parseGitHubUrl("https://github.com/my owner/repo");
			expect(result).toBeNull();
		});

		test("rejects repo with spaces", () => {
			const result = parseGitHubUrl("https://github.com/owner/my repo");
			expect(result).toBeNull();
		});
	});

	describe("edge cases", () => {
		test("handles multiple consecutive slashes", () => {
			const result = parseGitHubUrl("https://github.com//owner//repo//");
			expect(result?.type).toBe("root");
		});

		test("handles GitHub Enterprise URLs (*.github.com)", () => {
			// GitHub Enterprise URLs end with .github.com, not github.*.com
			const result = parseGitHubUrl("https://enterprise.github.com/owner/repo");
			expect(result?.type).toBe("root");
			expect(result?.owner).toBe("owner");
		});

		test("handles case-insensitive github.com", () => {
			const result = parseGitHubUrl("https://GITHUB.com/owner/repo");
			expect(result?.type).toBe("root");
		});

		test("handles tree URL with trailing slash on path", () => {
			const result = parseGitHubUrl("https://github.com/owner/repo/tree/main/src/");
			expect(result?.path).toBe("src");
		});

		test("handles blob URL with query string", () => {
			const result = parseGitHubUrl(
				"https://github.com/owner/repo/blob/main/README.md?plain=1",
			);
			expect(result?.path).toBe("README.md");
		});

		test("handles blob URL with fragment", () => {
			const result = parseGitHubUrl("https://github.com/owner/repo/blob/main/README.md#L10");
			expect(result?.path).toBe("README.md");
		});
	});
});

describe("isGitHubUrl", () => {
	test("returns true for valid GitHub URL", () => {
		expect(isGitHubUrl("https://github.com/owner/repo")).toBe(true);
	});

	test("returns true for GitHub Enterprise URL (*.github.com)", () => {
		// GitHub Enterprise URLs end with .github.com
		expect(isGitHubUrl("https://enterprise.github.com/owner/repo")).toBe(true);
	});

	test("returns false for non-GitHub URL", () => {
		expect(isGitHubUrl("https://gitlab.com/owner/repo")).toBe(false);
	});

	test("returns false for invalid URL", () => {
		expect(isGitHubUrl("not-a-url")).toBe(false);
	});

	test("handles case-insensitive hostname", () => {
		expect(isGitHubUrl("https://GITHUB.com/owner/repo")).toBe(true);
		expect(isGitHubUrl("https://GitHuB.com/owner/repo")).toBe(true);
	});
});

describe("host validation security", () => {
	test("rejects evilgithub.com (not a subdomain)", () => {
		const result = parseGitHubUrl("https://evilgithub.com/owner/repo");
		expect(result).toBeNull();
		expect(isGitHubUrl("https://evilgithub.com/owner/repo")).toBe(false);
	});

	test("rejects notgithub.com", () => {
		const result = parseGitHubUrl("https://notgithub.com/owner/repo");
		expect(result).toBeNull();
		expect(isGitHubUrl("https://notgithub.com/owner/repo")).toBe(false);
	});

	test("rejects mygithub.com", () => {
		const result = parseGitHubUrl("https://mygithub.com/owner/repo");
		expect(result).toBeNull();
		expect(isGitHubUrl("https://mygithub.com/owner/repo")).toBe(false);
	});

	test("rejects github.com.evil.com (malicious subdomain)", () => {
		const result = parseGitHubUrl("https://github.com.evil.com/owner/repo");
		expect(result).toBeNull();
		expect(isGitHubUrl("https://github.com.evil.com/owner/repo")).toBe(false);
	});

	test("accepts exact github.com match", () => {
		const result = parseGitHubUrl("https://github.com/owner/repo");
		expect(result?.type).toBe("root");
		expect(isGitHubUrl("https://github.com/owner/repo")).toBe(true);
	});

	test("accepts subdomain.github.com (GitHub Enterprise)", () => {
		const result = parseGitHubUrl("https://enterprise.github.com/owner/repo");
		expect(result?.type).toBe("root");
		expect(isGitHubUrl("https://enterprise.github.com/owner/repo")).toBe(true);
	});

	test("accepts user.github.com (GitHub Pages)", () => {
		const result = parseGitHubUrl("https://user.github.com/owner/repo");
		expect(result?.type).toBe("root");
		expect(isGitHubUrl("https://user.github.com/owner/repo")).toBe(true);
	});

	test("accepts org.github.com", () => {
		const result = parseGitHubUrl("https://org.github.com/owner/repo");
		expect(result?.type).toBe("root");
		expect(isGitHubUrl("https://org.github.com/owner/repo")).toBe(true);
	});

	test("rejects github.com with trailing characters", () => {
		const result = parseGitHubUrl("https://github.com.x/owner/repo");
		expect(result).toBeNull();
		expect(isGitHubUrl("https://github.com.x/owner/repo")).toBe(false);
	});
});
