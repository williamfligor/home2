/**
 * URL fetching and content extraction orchestration
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { is_url_safe } from "dssrf";
import {
	FETCH_TIMEOUT_MS,
	GITHUB_GIT_OPERATION_TIMEOUT_MS,
	MAX_RESPONSE_SIZE,
	MIN_CONTENT_LENGTH,
} from "../constants";
import type { RunDdgsExtractOptions } from "../ddgs";
import { runDdgsExtract } from "../ddgs";
import {
	CloneManager,
	getCommitView,
	getDirectoryListing,
	getFileContent,
	getRepoTreeView,
	parseGitHubUrl,
} from "../github";
import type { DdgsExtractResult, ExtractResult, FetchResult, GitHubExtractResult } from "../types";
import { htmlToMarkdown } from "./html-to-markdown";
import type { PdfToMarkdownOptions } from "./pdf";
import { pdfBufferToMarkdown } from "./pdf";

/**
 * Detect if a URL points to a PDF based on extension or content-type
 */
export function isPdfUrl(url: string): boolean {
	try {
		const pathname = new URL(url).pathname.toLowerCase();
		if (pathname.endsWith(".pdf")) return true;
	} catch {
		// ignore
	}
	return false;
}

/**
 * Options for fetching a URL
 */
export interface FetchUrlOptions {
	htmlToMarkdown?: (html: string, url: string) => string;
	pdfToMarkdown?: (buffer: Buffer, options?: PdfToMarkdownOptions) => Promise<string>;
	timeoutMs?: number;
}

/**
 * Check if an IPv6 address is in a blocked range
 */
function isIPv6Blocked(ipv6: string): boolean {
	// ::1 (IPv6 loopback)
	if (ipv6 === "::1") return true;

	// fe80::/10 (IPv6 link-local) - starts with fe80, fe81, fe82, etc.
	const firstChar = ipv6[0];
	const secondChar = ipv6[1];
	if (firstChar === "f" && secondChar === "e" && ipv6[2] >= "8" && ipv6[2] <= "c") {
		return true;
	}

	// fc00::/7 (IPv6 unique local - includes fd00::)
	if (firstChar === "f" && (secondChar === "c" || secondChar === "d")) {
		return true;
	}

	return false;
}

/**
 * Validate a URL to prevent SSRF attacks using dssrf.
 * dssrf handles:
 * - Private/reserved IPv4 addresses (10.x, 172.16-31.x, 192.168.x, etc.)
 * - DNS rebinding protection
 *
 * We add explicit checks for:
 * - localhost hostname (dssrf doesn't block hostname, only resolved IPs)
 * - IPv6 addresses (dssrf doesn't block all IPv6)
 *
 * Note: We also manually check redirects since we use fetch with redirect: "manual"
 */
export async function validateUrl(url: string): Promise<void> {
	const parsedUrl = new URL(url);
	const hostname = parsedUrl.hostname.toLowerCase();

	// Block localhost hostname explicitly (dssrf doesn't handle hostnames)
	if (
		hostname === "localhost" ||
		hostname === "localhost.localdomain" ||
		hostname.endsWith(".local")
	) {
		throw new Error(`SSRF blocked: Access to ${url} is not allowed`);
	}

	// Check for IPv6 literals in brackets (e.g., [::1]) - dssrf doesn't block all IPv6
	if (hostname.startsWith("[") && hostname.endsWith("]")) {
		const ipv6 = hostname.slice(1, -1);
		if (isIPv6Blocked(ipv6)) {
			throw new Error(`SSRF blocked: Access to ${url} is not allowed`);
		}
	}

	// Use dssrf for IPv4 and hostname validation
	const safe = await is_url_safe(url);
	if (!safe) {
		throw new Error(`SSRF blocked: Access to ${url} is not allowed`);
	}
}

/**
 * Read a Response body with size limits to prevent OOM attacks.
 * First checks Content-Length header, then streams with byte counting as fallback.
 */
async function readResponseWithSizeLimit(response: Response): Promise<Buffer> {
	// First, check Content-Length header if available
	const contentLengthStr = response.headers.get("content-length");
	if (contentLengthStr !== null) {
		const contentLength = parseInt(contentLengthStr, 10);
		if (!Number.isNaN(contentLength) && contentLength > 0) {
			if (contentLength > MAX_RESPONSE_SIZE) {
				throw new Error(
					`Response size ${contentLength} bytes exceeds maximum allowed size of ${MAX_RESPONSE_SIZE} bytes`,
				);
			}
			// Safe to read entire body
			return Buffer.from(await response.arrayBuffer());
		}
	}

	// Content-Length not available or invalid - try streaming with size limit
	if (response.body) {
		const reader = response.body.getReader();
		const chunks: Uint8Array[] = [];
		let totalBytes = 0;

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				totalBytes += value.length;
				if (totalBytes > MAX_RESPONSE_SIZE) {
					throw new Error(
						`Response size ${totalBytes} bytes exceeds maximum allowed size of ${MAX_RESPONSE_SIZE} bytes`,
					);
				}

				chunks.push(value);
			}
		} finally {
			reader.releaseLock();
		}

		// Combine chunks safely
		const totalSize = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
		const result = new Uint8Array(totalSize);
		let offset = 0;
		for (const chunk of chunks) {
			result.set(chunk, offset);
			offset += chunk.length;
		}

		return Buffer.from(result);
	}

	// Fallback: streaming not available (e.g., test mocks), use arrayBuffer
	// This is less safe but necessary for compatibility
	return Buffer.from(await response.arrayBuffer());
}

/**
 * Fetch a URL and return { content (markdown), contentType, finalUrl, method }
 * Handles HTML and PDF content types.
 */
export async function fetchUrlAsMarkdown(
	url: string,
	options: FetchUrlOptions = {},
): Promise<FetchResult> {
	const {
		htmlToMarkdown: htmlToMd = htmlToMarkdown,
		pdfToMarkdown = pdfBufferToMarkdown,
		timeoutMs = FETCH_TIMEOUT_MS,
	} = options;

	// Validate the initial URL to prevent SSRF
	await validateUrl(url);

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const response = await fetch(url, {
			signal: controller.signal,
			headers: {
				"User-Agent":
					"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
				Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
				"Accept-Language": "en-US,en;q=0.5",
			},
			redirect: "manual",
		});

		// Handle redirects manually with SSRF validation
		if (
			response.status === 301 ||
			response.status === 302 ||
			response.status === 303 ||
			response.status === 307 ||
			response.status === 308
		) {
			const location = response.headers.get("location");
			if (!location) {
				throw new Error(`Redirect response missing Location header`);
			}

			// Resolve relative redirects
			const redirectUrl = new URL(location, url).href;

			// Validate the redirect target to prevent SSRF bypass
			await validateUrl(redirectUrl);

			// Follow the redirect with the same options
			const redirectResponse = await fetch(redirectUrl, {
				signal: controller.signal,
				headers: {
					"User-Agent":
						"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
					Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
					"Accept-Language": "en-US,en;q=0.5",
				},
				redirect: "manual",
			});

			const finalUrl = redirectResponse.url || redirectUrl;
			const contentType = redirectResponse.headers.get("content-type") || "";

			if (!redirectResponse.ok) {
				throw new Error(`HTTP ${redirectResponse.status} ${redirectResponse.statusText}`);
			}

			// Read response as buffer with size limit to prevent OOM
			const buffer = await readResponseWithSizeLimit(redirectResponse);

			// PDF handling: check content-type, URL extension, OR PDF magic bytes
			const isPdf =
				contentType.includes("pdf") ||
				isPdfUrl(finalUrl) ||
				buffer.toString("ascii", 0, 5) === "%PDF-"; // PDF magic number

			if (isPdf) {
				const markdown = await pdfToMarkdown(buffer);
				return {
					content: markdown,
					contentType: "application/pdf",
					finalUrl,
					method: "pdf-parse",
				};
			}

			// HTML handling
			if (contentType.includes("html") || contentType.includes("xml")) {
				const html = buffer.toString("utf-8");
				const markdown = htmlToMd(html, finalUrl);
				return { content: markdown, contentType, finalUrl, method: "html-readability" };
			}

			// Plain text / other — return as-is
			const text = buffer.toString("utf-8");
			return { content: text, contentType, finalUrl, method: "html-readability" };
		}

		const finalUrl = response.url || url;
		const contentType = response.headers.get("content-type") || "";

		if (!response.ok) {
			throw new Error(`HTTP ${response.status} ${response.statusText}`);
		}

		// Read response as buffer with size limit to prevent OOM
		const buffer = await readResponseWithSizeLimit(response);

		// PDF handling: check content-type, URL extension, OR PDF magic bytes
		const isPdf =
			contentType.includes("pdf") ||
			isPdfUrl(finalUrl) ||
			buffer.toString("ascii", 0, 5) === "%PDF-"; // PDF magic number

		if (isPdf) {
			const markdown = await pdfToMarkdown(buffer);
			return {
				content: markdown,
				contentType: "application/pdf",
				finalUrl,
				method: "pdf-parse",
			};
		}

		// HTML handling
		if (contentType.includes("html") || contentType.includes("xml")) {
			const html = buffer.toString("utf-8");
			const markdown = htmlToMd(html, finalUrl);
			return { content: markdown, contentType, finalUrl, method: "html-readability" };
		}

		// Plain text / other — return as-is
		const text = buffer.toString("utf-8");
		return { content: text, contentType, finalUrl, method: "html-readability" };
	} finally {
		clearTimeout(timeout);
	}
}

/**
 * Options for extracting content
 */
export interface ExtractContentOptions {
	fetchUrl?: (url: string, options?: FetchUrlOptions) => Promise<FetchResult>;
	ddgsExtract?: (url: string, options?: RunDdgsExtractOptions) => DdgsExtractResult;
	forceClone?: boolean;
	cloneManager?: CloneManager;
}

/**
 * High-level content extraction: tries direct fetch with reader mode first,
 * falls back to ddgs extract if that fails.
 */
export async function extractContent(
	url: string,
	options: ExtractContentOptions = {},
): Promise<ExtractResult> {
	const {
		fetchUrl = fetchUrlAsMarkdown,
		ddgsExtract = runDdgsExtract,
		forceClone = false,
		cloneManager: externalCloneManager,
	} = options;

	// GitHub URL handling
	const gitHubInfo = parseGitHubUrl(url);
	if (gitHubInfo) {
		const cloneManager = externalCloneManager || new CloneManager();
		return extractGitHubUrl(gitHubInfo, { forceClone, cloneManager });
	}

	// For PDFs, always go direct (ddgs extract can't handle PDFs)
	if (isPdfUrl(url)) {
		const result = await fetchUrl(url);
		return { content: result.content, finalUrl: result.finalUrl, method: result.method };
	}

	// Try direct fetch + reader mode first
	try {
		const result = await fetchUrl(url);
		if (result.content && result.content.trim().length > MIN_CONTENT_LENGTH) {
			return { content: result.content, finalUrl: result.finalUrl, method: result.method };
		}
		// Content too short — probably a JS-rendered page or paywall; fall through to ddgs
	} catch (error: unknown) {
		const err = error as Error | { message: string };
		// Direct fetch failed — fall through to ddgs extract
		console.debug(`Direct fetch failed for ${url}: ${err.message}`);
	}

	// Fallback: ddgs extract (works for some JS-rendered pages)
	try {
		const result = ddgsExtract(url);
		const content = typeof result === "string" ? result : result.content || "";
		const finalUrl = result.url || url;
		return { content, finalUrl, method: "ddg-extract" };
	} catch {
		// Both methods failed
		throw new Error(
			`Could not extract content from ${url}. Direct fetch and ddgs extract both failed.`,
		);
	}
}

/**
 * Extract content from a GitHub URL
 */
async function extractGitHubUrl(
	gitHubInfo: ReturnType<typeof parseGitHubUrl>,
	options: { forceClone: boolean; cloneManager: CloneManager },
): Promise<GitHubExtractResult> {
	const { forceClone, cloneManager } = options;

	if (!gitHubInfo) {
		throw new Error("Invalid GitHub URL");
	}

	// Commit URLs always use API
	if (gitHubInfo.type === "commit") {
		if (!gitHubInfo.commitSha) {
			throw new Error("Commit URL requires commitSha");
		}
		const content = await getCommitView(
			gitHubInfo.owner,
			gitHubInfo.repo,
			gitHubInfo.commitSha,
		);
		return {
			content,
			finalUrl: gitHubInfo.originalUrl,
			method: "github-api-commit",
			gitHubMethod: "github-api-commit",
			repoInfo: {
				owner: gitHubInfo.owner,
				repo: gitHubInfo.repo,
			},
		};
	}

	// Check repo size for non-forced clones
	if (!forceClone) {
		const isTooLarge = await cloneManager.isRepoTooLarge(gitHubInfo.owner, gitHubInfo.repo);
		if (isTooLarge) {
			return extractGitHubViaApi(gitHubInfo);
		}
	}

	// Clone the repo
	const clone = await cloneManager.getOrClone(gitHubInfo.owner, gitHubInfo.repo, {
		forceClone,
		ref: gitHubInfo.ref,
	});

	// Route by URL type
	switch (gitHubInfo.type) {
		case "root":
			return formatRootView(clone, gitHubInfo);
		case "tree":
			return formatTreeView(clone, gitHubInfo);
		case "blob":
			return await formatBlobView(clone, gitHubInfo);
	}
}

/**
 * Extract GitHub content via API (for large repos)
 */
async function extractGitHubViaApi(
	gitHubInfo: ReturnType<typeof parseGitHubUrl>,
): Promise<GitHubExtractResult> {
	if (!gitHubInfo) {
		throw new Error("Invalid GitHub URL");
	}

	switch (gitHubInfo.type) {
		case "root": {
			const rootContent = await getRepoTreeView(
				gitHubInfo.owner,
				gitHubInfo.repo,
				gitHubInfo.ref,
			);
			return {
				content: rootContent,
				finalUrl: gitHubInfo.originalUrl,
				method: "github-api-root",
				gitHubMethod: "github-api-root",
				repoInfo: {
					owner: gitHubInfo.owner,
					repo: gitHubInfo.repo,
					ref: gitHubInfo.ref,
				},
			};
		}

		case "tree": {
			if (!gitHubInfo.path) {
				// No path specified, treat as root
				const treeContent = await getRepoTreeView(
					gitHubInfo.owner,
					gitHubInfo.repo,
					gitHubInfo.ref,
				);
				return {
					content: treeContent,
					finalUrl: gitHubInfo.originalUrl,
					method: "github-api-tree",
					gitHubMethod: "github-api-tree",
					repoInfo: {
						owner: gitHubInfo.owner,
						repo: gitHubInfo.repo,
						ref: gitHubInfo.ref,
					},
				};
			}
			const dirContent = await getDirectoryListing(
				gitHubInfo.owner,
				gitHubInfo.repo,
				gitHubInfo.path,
				gitHubInfo.ref,
			);
			return {
				content: dirContent,
				finalUrl: gitHubInfo.originalUrl,
				method: "github-api-tree",
				gitHubMethod: "github-api-tree",
				repoInfo: {
					owner: gitHubInfo.owner,
					repo: gitHubInfo.repo,
					ref: gitHubInfo.ref,
					path: gitHubInfo.path,
				},
			};
		}

		case "blob": {
			if (!gitHubInfo.path) {
				throw new Error("Blob URL requires a path");
			}
			const fileContent = await getFileContent(
				gitHubInfo.owner,
				gitHubInfo.repo,
				gitHubInfo.path,
				gitHubInfo.ref,
			);
			return {
				content: fileContent,
				finalUrl: gitHubInfo.originalUrl,
				method: "github-api-blob",
				gitHubMethod: "github-api-blob",
				repoInfo: {
					owner: gitHubInfo.owner,
					repo: gitHubInfo.repo,
					ref: gitHubInfo.ref,
					path: gitHubInfo.path,
				},
			};
		}
	}
}

/**
 * Format root view from cloned repo
 */
async function formatRootView(
	clone: { localPath: string; headSha: string; owner: string; repo: string },
	gitHubInfo: ReturnType<typeof parseGitHubUrl>,
): Promise<GitHubExtractResult> {
	const { join } = await import("node:path");
	let treeOutput: string;
	try {
		// Use --name-only to get just paths (simpler format)
		treeOutput = execFileSync("git", ["ls-tree", "-r", "HEAD", "--name-only"], {
			cwd: clone.localPath,
			encoding: "utf-8",
			timeout: GITHUB_GIT_OPERATION_TIMEOUT_MS,
		});
	} catch (error) {
		throw new Error("Failed to read git tree", { cause: error });
	}

	const treeEntries: Array<{ path: string; type: "blob" | "tree"; size?: number }> = [];
	for (const line of treeOutput.trim().split("\n")) {
		if (!line.trim()) continue;
		// --name-only returns just paths, one per line
		const path = line.trim();
		// Determine type based on path structure
		// If path contains /, it's a file in a subdirectory (blob)
		// We'll treat root-level paths as blobs for simplicity
		const type: "blob" | "tree" = "blob";
		treeEntries.push({ path, type });
	}

	// Try to find and read README
	let readmeContent: string | null = null;
	const readmePaths = ["README.md", "README.txt", "README"];
	for (const readmePath of readmePaths) {
		const fullPath = join(clone.localPath, readmePath);
		try {
			readmeContent = readFileSync(fullPath, "utf-8");
			break;
		} catch {
			// Try next README path
		}
	}

	const { formatRepoOverview } = await import("../github/format");
	const content = formatRepoOverview(
		treeEntries,
		readmeContent,
		clone.owner,
		clone.repo,
		clone.localPath,
		gitHubInfo.ref,
		clone.headSha,
	);

	return {
		content,
		finalUrl: gitHubInfo.originalUrl,
		method: "github-clone",
		gitHubMethod: "github-clone",
		localPath: clone.localPath,
		repoInfo: {
			owner: clone.owner,
			repo: clone.repo,
			ref: gitHubInfo.ref,
		},
	};
}

/**
 * Format tree view from cloned repo
 */
async function formatTreeView(
	clone: { localPath: string; headSha: string; owner: string; repo: string },
	gitHubInfo: ReturnType<typeof parseGitHubUrl>,
): Promise<GitHubExtractResult> {
	// If no path specified, treat as root view fallback
	if (!gitHubInfo.path) {
		return formatRootView(clone, gitHubInfo);
	}

	let treeOutput: string;
	try {
		// Use "--" separator to list directory contents (not the entry itself)
		// Format: "mode type sha<TAB>path"
		treeOutput = execFileSync("git", ["ls-tree", "HEAD", "--", gitHubInfo.path], {
			cwd: clone.localPath,
			encoding: "utf-8",
			timeout: GITHUB_GIT_OPERATION_TIMEOUT_MS,
		});
	} catch (error) {
		throw new Error(`Failed to read git tree at ${gitHubInfo.path}`, { cause: error });
	}

	const treeEntries: Array<{ path: string; type: "blob" | "tree"; size?: number }> = [];
	for (const line of treeOutput.trim().split("\n")) {
		if (!line.trim()) continue;
		// Format: "mode type sha<TAB>path" - split by tab first
		const tabParts = line.split("\t");
		if (tabParts.length >= 2) {
			const meta = tabParts[0]; // "mode type sha"
			const fullPath = tabParts[1]; // "path/to/file"
			// Parse mode, type, sha from meta (space-separated)
			const metaParts = meta.split(" ");
			const type = metaParts[1]; // "blob" or "tree"
			// Extract just the basename for display
			const path = fullPath.split("/").pop() || fullPath;
			treeEntries.push({
				path,
				type: type === "blob" ? "blob" : "tree",
			});
		}
	}

	const { formatDirectoryListing } = await import("../github/format");
	const content = formatDirectoryListing(
		treeEntries,
		gitHubInfo.path,
		clone.owner,
		clone.repo,
		clone.localPath,
		gitHubInfo.ref,
	);

	return {
		content,
		finalUrl: gitHubInfo.originalUrl,
		method: "github-clone",
		gitHubMethod: "github-clone",
		localPath: clone.localPath,
		repoInfo: {
			owner: clone.owner,
			repo: clone.repo,
			ref: gitHubInfo.ref,
			path: gitHubInfo.path,
		},
	};
}

/**
 * Format blob view from cloned repo
 */
async function formatBlobView(
	clone: { localPath: string; owner: string; repo: string },
	gitHubInfo: ReturnType<typeof parseGitHubUrl>,
): Promise<GitHubExtractResult> {
	const { join, relative, isAbsolute } = await import("node:path");
	const fs = await import("node:fs");
	if (!gitHubInfo.path) {
		throw new Error("Blob URL requires a path");
	}

	// Validate path to prevent path traversal attacks
	const fullPath = join(clone.localPath, gitHubInfo.path);
	const realPath = await fs.promises.realpath(fullPath);
	const relativePath = relative(clone.localPath, realPath);
	// Reject if relative path starts with ".." (outside the clone directory)
	// or if it's absolute (shouldn't happen, but defense in depth)
	if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
		throw new Error(`Path traversal attempt detected: ${gitHubInfo.path}`);
	}

	let content: string;
	try {
		content = readFileSync(fullPath, "utf-8");
	} catch (error) {
		throw new Error(`Failed to read file at ${gitHubInfo.path}`, { cause: error });
	}

	const { formatFileContent } = await import("../github/format");
	const formatted = formatFileContent(
		content,
		gitHubInfo.path,
		clone.owner,
		clone.repo,
		clone.localPath,
		undefined,
		gitHubInfo.ref,
	);

	return {
		content: formatted,
		finalUrl: gitHubInfo.originalUrl,
		method: "github-clone",
		gitHubMethod: "github-clone",
		localPath: clone.localPath,
		repoInfo: {
			owner: clone.owner,
			repo: clone.repo,
			ref: gitHubInfo.ref,
			path: gitHubInfo.path,
		},
	};
}
