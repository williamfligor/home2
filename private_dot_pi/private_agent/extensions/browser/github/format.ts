/**
 * GitHub content formatters
 *
 * Format repo information into markdown suitable for LLM consumption.
 * All output is capped at MAX_CONTENT_LENGTH to prevent excessive token usage.
 */

import { MAX_CONTENT_LENGTH } from "../constants";

/** Truncation notice appended when content exceeds MAX_CONTENT_LENGTH */
const TRUNCATION_NOTICE = "\n\n---\n⚠️ Content truncated to fit limits.";

/** GitHub URL prefix for building repo links */
const GITHUB_URL_PREFIX = "github.com";

/**
 * Escape backticks in a string to prevent markdown injection
 * @param str - String to escape
 * @returns String with backticks escaped
 */
function escapeBackticks(str: string): string {
	return str.replace(/`/g, "\\`");
}

/**
 * Truncate content to MAX_CONTENT_LENGTH with a notice if it exceeds the limit
 * @param content - The content to potentially truncate
 * @returns Content, possibly truncated with a notice appended
 */
function truncateContent(content: string): string {
	if (content.length <= MAX_CONTENT_LENGTH) {
		return content;
	}
	return content.slice(0, MAX_CONTENT_LENGTH) + TRUNCATION_NOTICE;
}

export interface TreeEntry {
	path: string;
	type: "blob" | "tree";
	size?: number;
	mode?: string;
	sha?: string;
}

/**
 * Build a common header block for GitHub markdown formatters
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param metadata - Key-value pairs to include as bold metadata lines
 * @returns Markdown header string
 *
 * @example
 * buildHeader("octocat", "hello-world", { Path: "`src/`", Branch: "main" })
 * // => "# github.com/octocat/hello-world\n\n**Path:** `src/`\n\n**Branch:** main\n\n"
 */
function buildHeader(owner: string, repo: string, metadata: Record<string, string>): string {
	const metaLines = Object.entries(metadata)
		.filter(([, value]) => value !== "")
		.map(([key, value]) => `**${key}:** ${value}\n\n`)
		.join("");

	return `# ${GITHUB_URL_PREFIX}/${owner}/${repo}\n\n${metaLines}`;
}

/**
 * Format a repo overview: tree listing + README content
 *
 * @param treeEntries - Repository tree entries (files and directories)
 * @param readmeContent - README file content, or null if unavailable
 * @param owner - Repository owner (e.g., "octocat")
 * @param repo - Repository name (e.g., "hello-world")
 * @param localPath - Local filesystem path if cloned, null for API views
 * @param ref - Git ref (branch/tag), optional
 * @param headSha - HEAD commit SHA, optional
 * @returns Markdown-formatted repo overview
 *
 * @example
 * formatRepoOverview(entries, "# Hello", "octocat", "hi", "/tmp/repo", "main", "abc1234")
 * // => "# github.com/octocat/hi\n\n**Local path:** `/tmp/repo`\n\n..."
 */
export function formatRepoOverview(
	treeEntries: TreeEntry[],
	readmeContent: string | null,
	owner: string,
	repo: string,
	localPath: string | null,
	ref?: string,
	headSha?: string,
): string {
	if (!owner || !repo) {
		return "(invalid repository: missing owner or repo name)";
	}

	const metadata: Record<string, string> = {};

	if (localPath) {
		metadata["Local path"] = `\`${escapeBackticks(localPath)}\``;
	}

	const branchInfo = ref || "default";
	const shaInfo = headSha ? ` (sha: ${headSha.slice(0, 7)})` : "";
	metadata.Branch = `${branchInfo}${shaInfo}`;

	const parts: string[] = [buildHeader(owner, repo, metadata)];

	// Add local path exploration hints
	if (localPath) {
		const escaped = escapeBackticks(localPath);
		parts.push(
			`**You can explore this repo using:**\n`,
			`- \`read\` with paths like \`${escaped}/src/index.ts\`\n`,
			`- \`bash\` with \`cd ${escaped} && ...\`\n\n`,
		);
	}

	// Add repository tree
	parts.push(`## Repository Tree\n\n`, "```\n", formatTree(treeEntries ?? []), "```\n\n");

	// Add README content if available
	if (readmeContent) {
		parts.push(`## README.md\n\n`, truncateContent(readmeContent));
	}

	return parts.join("");
}

/**
 * Format a directory listing
 *
 * @param entries - Directory tree entries
 * @param path - Directory path within the repository
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param localPath - Local filesystem path if cloned, null for API views
 * @param ref - Git ref (branch/tag), optional
 * @returns Markdown-formatted directory listing
 *
 * @example
 * formatDirectoryListing(entries, "src", "octocat", "hi", null, "main")
 * // => "# github.com/octocat/hi\n\n**Path:** `src`\n\n..."
 */
export function formatDirectoryListing(
	entries: TreeEntry[],
	path: string,
	owner: string,
	repo: string,
	localPath: string | null,
	ref?: string,
): string {
	if (!owner || !repo) {
		return "(invalid repository: missing owner or repo name)";
	}

	const metadata: Record<string, string> = {
		Path: `\`${escapeBackticks(path)}\``,
	};

	if (localPath) {
		metadata["Local path"] = `\`${escapeBackticks(localPath)}\``;
	}
	if (ref) {
		metadata.Branch = ref;
	}

	const parts: string[] = [buildHeader(owner, repo, metadata)];

	parts.push(`## Directory Contents\n\n`, "```\n", formatTree(entries ?? []), "```\n\n");

	return parts.join("");
}

/**
 * Format file content with metadata header
 *
 * @param content - File content string
 * @param filePath - Path to the file within the repository
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param localPath - Local filesystem path if cloned, null for API views
 * @param fileSize - File size in bytes, optional
 * @param ref - Git ref (branch/tag), optional
 * @param encoding - File encoding, optional
 * @returns Markdown-formatted file content view
 *
 * @example
 * formatFileContent("console.log('hi')", "src/index.ts", "octocat", "hi", null, 42, "main")
 * // => "# github.com/octocat/hi\n\n**File:** `src/index.ts`\n\n..."
 */
export function formatFileContent(
	content: string,
	filePath: string,
	owner: string,
	repo: string,
	localPath: string | null,
	fileSize?: number,
	ref?: string,
	encoding?: string,
): string {
	if (!owner || !repo) {
		return "(invalid repository: missing owner or repo name)";
	}

	const metadata: Record<string, string> = {
		File: `\`${escapeBackticks(filePath)}\``,
	};

	if (localPath) {
		metadata["Local path"] = `\`${escapeBackticks(localPath)}\``;
	}
	if (ref) {
		metadata.Branch = ref;
	}
	if (fileSize) {
		metadata.Size = formatFileSize(fileSize);
	}
	if (encoding) {
		metadata.Encoding = encoding;
	}

	const parts: string[] = [buildHeader(owner, repo, metadata)];

	parts.push(`## File Contents\n\n`, "```\n", truncateContent(content), "\n```\n");

	return parts.join("");
}

/**
 * Format commit info
 *
 * @param sha - Full commit SHA
 * @param message - Commit message
 * @param author - Commit author name
 * @param date - Commit date string
 * @param diff - Diff content, optional
 * @param owner - Repository owner, optional
 * @param repo - Repository name, optional
 * @returns Markdown-formatted commit view
 *
 * @example
 * formatCommitView("abc1234def", "Fix bug", "Alice", "2024-01-01", "diff...", "octocat", "hi")
 * // => "# Commit abc1234\n\n**Repository:** github.com/octocat/hi\n\n..."
 */
export function formatCommitView(
	sha: string,
	message: string,
	author: string,
	date: string,
	diff?: string,
	owner?: string,
	repo?: string,
): string {
	const parts: string[] = [`# Commit ${sha.slice(0, 7)}\n\n`];

	if (owner && repo) {
		parts.push(`**Repository:** ${GITHUB_URL_PREFIX}/${owner}/${repo}\n\n`);
	}

	parts.push(
		`**SHA:** \`${sha}\`\n\n`,
		`**Author:** ${author}\n\n`,
		`**Date:** ${date}\n\n`,
		`**Message:**\n\n${message}\n\n`,
	);

	if (diff) {
		parts.push(`## Diff\n\n`, "```\n", truncateContent(diff), "\n```\n");
	}

	return parts.join("");
}

/**
 * Format tree entries into a visual tree structure
 *
 * Directories are listed before files, both sorted alphabetically.
 *
 * @param entries - Tree entries to format
 * @param prefix - Line prefix for tree connectors (used internally)
 * @returns Visual tree string or "(empty)" for empty directories
 *
 * @example
 * formatTree([{ path: "src", type: "tree" }, { path: "README.md", type: "blob", size: 42 }])
 * // => "├── src/\n└── README.md (42 B)"
 */
function formatTree(entries: TreeEntry[], prefix: string = ""): string {
	if (!entries || entries.length === 0) {
		return "(empty)";
	}

	// Sort entries: directories first, then files, alphabetically
	const sorted = [...entries].sort((a, b) => {
		const aIsDir = a.type === "tree";
		const bIsDir = b.type === "tree";
		if (aIsDir && !bIsDir) return -1;
		if (!aIsDir && bIsDir) return 1;
		return a.path.localeCompare(b.path);
	});

	const lines: string[] = [];

	for (let i = 0; i < sorted.length; i++) {
		const entry = sorted[i];
		const isLast = i === sorted.length - 1;
		const connector = isLast ? "└── " : "├── ";

		let line = `${prefix}${connector}${entry.path}${entry.type === "tree" ? "/" : ""}`;

		// Add size for files
		if (entry.type === "blob" && entry.size) {
			line += ` (${formatFileSize(entry.size)})`;
		}

		lines.push(line);
	}

	return lines.join("\n");
}

/**
 * Format file size in human-readable form
 *
 * Supports B, KB, MB, and GB units.
 *
 * @param bytes - File size in bytes
 * @returns Human-readable size string
 *
 * @example
 * formatFileSize(500)       // => "500 B"
 * formatFileSize(1536)      // => "1.5 KB"
 * formatFileSize(2_097_152) // => "2.0 MB"
 * formatFileSize(1_610_612_736) // => "1.5 GB"
 */
function formatFileSize(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes} B`;
	}
	if (bytes < 1024 * 1024) {
		return `${(bytes / 1024).toFixed(1)} KB`;
	}
	if (bytes < 1024 ** 3) {
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}
	return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
