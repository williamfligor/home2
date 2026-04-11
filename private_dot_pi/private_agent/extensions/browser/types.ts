/**
 * Shared TypeScript interfaces for the browser extension
 */

/**
 * Search result from DuckDuckGo search
 */
export interface SearchResult {
	title: string;
	href: string;
	body: string;
}

/**
 * DuckDuckGo extract result
 */
export interface DdgsExtractResult {
	url?: string;
	content?: string;
	error?: string;
}

/**
 * Valid extraction method values
 */
export type ExtractionMethod =
	| "html-readability"
	| "pdf-parse"
	| "github-clone"
	| "github-api-root"
	| "github-api-tree"
	| "github-api-blob"
	| "github-api-commit"
	| "ddg-extract";

/**
 * Result from fetching URL content
 */
export interface FetchResult {
	content: string;
	contentType: string;
	finalUrl: string;
	method: ExtractionMethod;
	error?: string;
}

/**
 * Base result from content extraction
 */
export interface ExtractResult {
	content: string;
	finalUrl: string;
	method: ExtractionMethod;
	localPath?: string; // Path to cloned repo on disk (if cloned)
}

/**
 * Result from text truncation
 */
export interface TruncateResult {
	text: string;
	truncated: boolean;
	totalLength: number;
}

/**
 * Page cache interface for caching extracted content
 */
export interface PageCache {
	get(url: string): string | undefined;
	has(url: string): boolean;
	set(url: string, content: string): void;
	clear(): void;
}

/**
 * Match result from find/search operation
 */
export interface FindMatch {
	line: number;
	context: string;
}

/**
 * GitHub-specific extract result
 */
export interface GitHubExtractResult extends ExtractResult {
	githubMethod?:
		| "github-clone"
		| "github-api-root"
		| "github-api-tree"
		| "github-api-blob"
		| "github-api-commit";
	repoInfo?: {
		owner: string;
		repo: string;
		ref?: string;
		path?: string;
	};
}
