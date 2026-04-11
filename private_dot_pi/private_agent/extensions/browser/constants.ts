/**
 * Constants for the browser extension
 */

export const MAX_CONTENT_LENGTH = 80_000; // ~20k tokens, generous but bounded
export const MAX_HTML_SIZE = 1024 * 1024; // 1MB max HTML size
export const MAX_PDF_SIZE = 10 * 1024 * 1024; // 10MB max PDF size
export const SEARCH_TIMEOUT_MS = 30_000;
export const EXTRACT_TIMEOUT_MS = 30_000;
export const FETCH_TIMEOUT_MS = 30_000;
export const MAX_RESPONSE_SIZE = 10 * 1024 * 1024; // 10MB max response body
export const MAX_CACHE_SIZE = 20;
export const MAX_FIND_MATCHES = 50;
export const URL_DISPLAY_LENGTH = 40; // Max chars to show in find tool display
export const MAX_SEARCH_PHRASE_LENGTH = 500; // Max length for search phrase
export const GREP_TIMEOUT_MS = 10_000; // Timeout for grep command (10 seconds)

// GitHub-specific constants
export const GITHUB_SIZE_THRESHOLD_MB = 350; // MB - threshold for API vs clone
export const GITHUB_CLONE_DIR_PREFIX = "pi-github-"; // Temp dir prefix
export const GITHUB_API_TIMEOUT_MS = 30_000; // Timeout for gh api calls
export const GITHUB_CLONE_TIMEOUT_MS = 120_000; // Timeout for git clone (2 min for large repos)
export const GITHUB_GIT_OPERATION_TIMEOUT_MS = 30_000; // Timeout for git operations (ls-tree, etc.)
// Utility constants
export const MIN_TRUNCATION_RATIO = 0.5;
export const README_PATHS = ["README.md", "README.txt", "README"] as const;
export const MIN_CONTENT_LENGTH = 100;
export const GITHUB_DEFAULT_BRANCH = "main";
