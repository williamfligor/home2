/**
 * GitHub API View
 *
 * Lightweight GitHub API-based views for repos that are too large to clone,
 * commit SHAs, and any case where cloning isn't appropriate.
 */

import { execFileSync } from "node:child_process";

import { GITHUB_API_TIMEOUT_MS } from "../constants";
import type { TreeEntry } from "./format";

export interface ApiViewOptions {
	execSync?: typeof execFileSync; // For DI in tests
}

/**
 * Validate owner and repo parameters
 */
function validateOwnerRepo(owner: string, repo: string): void {
	if (!owner || !repo) {
		throw new Error("owner and repo parameters are required");
	}
	if (owner.includes("/") || repo.includes("/")) {
		throw new Error("owner and repo should not contain '/'");
	}
}

/**
 * Validate path parameter to prevent injection
 */
function validatePath(path: string): void {
	if (path.includes("?") || path.includes("#") || path.includes("..") || path.startsWith("/")) {
		throw new Error(`Invalid path: ${path}`);
	}
}

/**
 * Get default branch name
 */
function getDefaultRef(ref?: string): string {
	return ref || "main";
}

/**
 * Execute gh api command with fallback to direct fetch
 */
async function ghApi(
	endpoint: string,
	options: ApiViewOptions = {},
	headers: Record<string, string> = {},
	textResponse: boolean = false,
): Promise<unknown> {
	const { execSync = execFileSync } = options;

	// Try gh api first (handles auth for private repos)
	let ghError: Error | undefined;
	try {
		const args = ["api", endpoint];
		for (const [key, value] of Object.entries(headers)) {
			args.push("-H", `${key}: ${value}`);
		}
		const result = execSync("gh", args, {
			encoding: "utf-8",
			timeout: GITHUB_API_TIMEOUT_MS,
		});
		if (textResponse) {
			return result;
		}
		return JSON.parse(result);
	} catch (error) {
		ghError = error as Error;
	}

	// Fallback to unauthenticated fetch
	try {
		const url = `https://api.github.com${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), GITHUB_API_TIMEOUT_MS);
		const response = await fetch(url, {
			signal: controller.signal,
			headers: {
				"User-Agent": "pi-browser-extension",
				Accept: "application/vnd.github.v3+json",
				...headers,
			},
		});
		clearTimeout(timeoutId);

		if (!response.ok) {
			throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
		}

		if (textResponse) {
			// Ensure response is a proper Response object before calling .text()
			if (typeof response.text !== "function") {
				throw new Error(`Invalid response from GitHub API: expected Response object`);
			}
			return response.text();
		}

		// Ensure response is a proper Response object before calling .json()
		if (typeof response.json !== "function") {
			throw new Error(`Invalid response from GitHub API: expected Response object`);
		}

		return response.json();
	} catch (fetchError) {
		const error = fetchError as Error | { message: string };
		throw new Error(
			`Failed to access GitHub API for ${endpoint}. ` +
				`gh CLI not available or rate limited. Original error: ${error.message}. ` +
				`Try forceClone:true.`,
			{ cause: ghError || error },
		);
	}
}

/**
 * Get repo tree + README as markdown (for root URLs on large repos)
 * @param owner GitHub repository owner
 * @param repo Repository name
 * @param ref Git reference (branch/tag/commit), defaults to "main"
 * @param options API view options including execSync override for testing
 * @returns Markdown representation of repository tree and README
 */
export async function getRepoTreeView(
	owner: string,
	repo: string,
	ref?: string,
	options: ApiViewOptions = {},
): Promise<string> {
	validateOwnerRepo(owner, repo);
	const refToUse = getDefaultRef(ref);

	// Get the tree
	const treeData = await ghApi(
		`repos/${owner}/${repo}/git/trees/${refToUse}?recursive=1`,
		options,
	);

	const treeEntries: TreeEntry[] = (treeData.tree || []).map(
		(item: { path: string; type: string; size?: number; mode?: number; sha?: string }) => ({
			path: item.path,
			type: item.type as "blob" | "tree",
			size: item.size,
			mode: item.mode,
			sha: item.sha,
		}),
	);

	// Get README
	let readmeContent: string | null = null;
	try {
		const readmeData = await ghApi(`repos/${owner}/${repo}/readme?ref=${refToUse}`, options);
		// README content is base64 encoded
		readmeContent = Buffer.from(readmeData.content, "base64").toString("utf-8");
	} catch (error: unknown) {
		const err = error as Error | { message: string };
		// Distinguish between expected (404) and unexpected errors
		if (err.message.includes("404")) {
			// README not found, that's ok
		} else {
			// Log unexpected errors (rate limit, auth failure, network errors)
			console.debug(`Could not fetch README for ${owner}/${repo}: ${err.message}`);
		}
	}

	// Import format function dynamically to avoid circular dependency
	const { formatRepoOverview } = await import("./format");
	return formatRepoOverview(treeEntries, readmeContent, owner, repo, null, refToUse);
}

/**
 * Get directory listing as markdown (for /tree/ paths on large repos)
 * @param owner GitHub repository owner
 * @param repo Repository name
 * @param path Directory path in the repository
 * @param ref Git reference (branch/tag/commit), defaults to "main"
 * @param options API view options including execSync override for testing
 * @returns Markdown representation of directory listing
 */
export async function getDirectoryListing(
	owner: string,
	repo: string,
	path: string,
	ref?: string,
	options: ApiViewOptions = {},
): Promise<string> {
	validateOwnerRepo(owner, repo);
	validatePath(path);
	const refToUse = getDefaultRef(ref);

	// Get the directory contents
	const dirData = await ghApi(`repos/${owner}/${repo}/contents/${path}?ref=${refToUse}`, options);

	const treeEntries: TreeEntry[] = (Array.isArray(dirData) ? dirData : []).map(
		(item: { name: string; type: string; size?: number; sha?: string }) => ({
			path: item.name,
			type: item.type as "blob" | "tree",
			size: item.size,
			sha: item.sha,
		}),
	);

	// Import format function dynamically
	const { formatDirectoryListing } = await import("./format");
	return formatDirectoryListing(treeEntries, path, owner, repo, null, refToUse);
}

/**
 * Get file contents as markdown (for /blob/ paths on large repos)
 * @param owner GitHub repository owner
 * @param repo Repository name
 * @param path File path in the repository
 * @param ref Git reference (branch/tag/commit), defaults to "main"
 * @param options API view options including execSync override for testing
 * @returns Markdown representation of file content
 */
export async function getFileContent(
	owner: string,
	repo: string,
	path: string,
	ref?: string,
	options: ApiViewOptions = {},
): Promise<string> {
	validateOwnerRepo(owner, repo);
	validatePath(path);
	const refToUse = getDefaultRef(ref);

	// Get file content
	const fileData = await ghApi(
		`repos/${owner}/${repo}/contents/${path}?ref=${refToUse}`,
		options,
	);

	// Validate content exists before decoding
	if (!fileData.content) {
		throw new Error(`No content returned for ${path}`);
	}

	// Content is base64 encoded
	const content = Buffer.from(fileData.content, fileData.encoding || "base64").toString("utf-8");

	// Import format function dynamically
	const { formatFileContent } = await import("./format");
	return formatFileContent(
		content,
		path,
		owner,
		repo,
		null,
		fileData.size,
		refToUse,
		fileData.encoding,
	);
}

/**
 * Get commit info as markdown
 * @param owner GitHub repository owner
 * @param repo Repository name
 * @param sha Commit SHA
 * @param options API view options including execSync override for testing
 * @returns Markdown representation of commit info
 */
export async function getCommitView(
	owner: string,
	repo: string,
	sha: string,
	options: ApiViewOptions = {},
): Promise<string> {
	validateOwnerRepo(owner, repo);
	// Get commit info
	const commitData = await ghApi(`repos/${owner}/${repo}/commits/${sha}`, options);

	let diff: string | undefined;
	try {
		// Get diff with special Accept header - use textResponse to avoid JSON parsing
		const diffResponse = await ghApi(
			`repos/${owner}/${repo}/commits/${sha}`,
			options,
			{ Accept: "application/vnd.github.v3.diff" },
			true, // textResponse
		);
		if (typeof diffResponse === "string") {
			diff = diffResponse;
		}
	} catch (error: unknown) {
		const err = error as Error | { message: string };
		// Distinguish between expected and unexpected errors
		if (err.message.includes("404") || err.message.includes("Not Found")) {
			// Diff not available, that's ok
		} else {
			// Log unexpected errors
			console.debug(`Could not fetch diff for ${owner}/${repo}@${sha}: ${err.message}`);
		}
	}

	const message = commitData.commit?.message || "";
	const author = commitData.commit?.author?.name || commitData.author?.login || "Unknown";
	const date = commitData.commit?.author?.date || commitData.commit?.committer?.date || "";

	// Import format function dynamically
	const { formatCommitView: formatCommit } = await import("./format");
	return formatCommit(sha, message, author, date, diff, owner, repo);
}
