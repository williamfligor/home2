/**
 * GitHub URL parser
 *
 * Parses GitHub URLs into structured objects for further processing.
 */

export type GitHubUrlType = "root" | "tree" | "blob" | "commit";

export interface GitHubUrlInfo {
	type: GitHubUrlType;
	owner: string;
	repo: string;
	ref?: string; // branch, tag, or SHA
	path?: string; // file/dir path within repo (no leading slash)
	commitSha?: string; // for type=commit
	originalUrl: string; // the original URL for reference
}

/**
 * Parse a GitHub URL into a structured object, or return null if not a GitHub URL.
 *
 * Supported patterns:
 * - github.com/owner/repo → { type: "root" }
 * - github.com/owner/repo/tree/ref/path → { type: "tree", ref, path }
 * - github.com/owner/repo/blob/ref/path → { type: "blob", ref, path }
 * - github.com/owner/repo/commit/sha → { type: "commit", commitSha: sha }
 *
 * URL fragments (#...) and query strings (?...) are ignored.
 * Trailing slashes are stripped. .git suffix is stripped.
 */

// GitHub URL segments we don't handle (settings, issues, PRs, etc.)
const IGNORED_SEGMENTS = new Set([
	"pull",
	"issue",
	"issues",
	"wiki",
	"actions",
	"settings",
	"compare",
	"commits",
	"releases",
	"tags",
	"branches",
	"graphs",
	"profiles",
	"organizations",
	"search",
	"market",
	"marketplace",
	"topics",
	"discussions",
	"security",
	"projects",
	"milestones",
	"labels",
	"environments",
	"deploy",
	"deploy-keys",
	"hooks",
	"pages",
	"stars",
	"watchers",
	"forks",
	"contributors",
	"networks",
	"dependents",
	"insights",
	"code",
	"community",
	"notifications",
	"activity",
	"received",
	"following",
	"followers",
	"repositories",
	"gpg",
	"tokens",
	"applications",
	"blocks",
	"blocked",
	"sponsors",
	"sponsoring",
	"copilot",
	"codespaces",
	"new",
	"login",
	"join",
	"pricing",
	"features",
	"enterprise",
	"explore",
	"s",
	"gist",
	"received",
]);
export function parseGitHubUrl(url: string): GitHubUrlInfo | null {
	try {
		const parsed = new URL(url);
		const host = parsed.hostname.toLowerCase();
		// Validate host: must be exactly "github.com" or a subdomain ending in ".github.com"
		// This prevents accepting domains like "evilgithub.com"
		if (host !== "github.com" && !host.endsWith(".github.com")) {
			return null;
		}

		// Get the path, stripping leading/trailing slashes
		let path = parsed.pathname.replace(/^\/+/, "").replace(/\/+$/, "");
		// Strip query string and fragment
		path = path.split("?")[0].split("#")[0];
		if (path.endsWith(".git")) {
			path = path.slice(0, -4);
		}
		// Split path into segments
		const segments = path.split("/").filter(Boolean);
		if (segments.length < 2) {
			return null;
		}
		const owner = segments[0];
		const repo = segments[1];
		if (!owner || !repo) {
			return null;
		}

		// Validate owner and repo names to prevent command injection
		const ownerPattern = /^[a-zA-Z0-9._-]+$/;
		const repoPattern = /^[a-zA-Z0-9._-]+$/;
		if (!ownerPattern.test(owner) || !repoPattern.test(repo)) {
			return null;
		}
		// Strip .git from repo name if present
		const cleanRepo = repo.endsWith(".git") ? repo.slice(0, -4) : repo;
		// Check if third segment is something we don't handle
		const thirdSegment = segments[2];
		if (thirdSegment && IGNORED_SEGMENTS.has(thirdSegment)) {
			return null;
		}

		// Handle commit URLs
		if (thirdSegment === "commit") {
			const commitSha = segments[3];
			if (!commitSha) {
				return null;
			}
			return {
				type: "commit",
				owner,
				repo: cleanRepo,
				commitSha,
				originalUrl: url,
			};
		}

		// Handle blob URLs (file views)
		if (thirdSegment === "blob") {
			const ref = segments[3];
			const filePath = segments.slice(4).join("/");
			if (!ref) {
				return null;
			}
			return {
				type: "blob",
				owner,
				repo: cleanRepo,
				ref,
				path: filePath || undefined,
				originalUrl: url,
			};
		}

		// Handle tree URLs (directory views)
		if (thirdSegment === "tree") {
			const ref = segments[3];
			const filePath = segments.slice(4).join("/");
			return {
				type: "tree",
				owner,
				repo: cleanRepo,
				ref: ref || undefined,
				path: filePath || undefined,
				originalUrl: url,
			};
		}
		// Default: root URL (just owner/repo)
		return {
			type: "root",
			owner,
			repo: cleanRepo,
			originalUrl: url,
		};
	} catch {
		// Invalid URL
		return null;
	}
}

/**
 * Check if a URL is a GitHub URL.
 */
export function isGitHubUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		const host = parsed.hostname.toLowerCase();
		// Validate host: must be exactly "github.com" or a subdomain ending in ".github.com"
		// This prevents accepting domains like "evilgithub.com"
		return host === "github.com" || host.endsWith(".github.com");
	} catch {
		return false;
	}
}
