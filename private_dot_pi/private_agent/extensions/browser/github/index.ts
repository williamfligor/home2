/**
 * GitHub module barrel exports
 *
 * Provides GitHub URL parsing, clone management, API views, and formatting.
 */

export {
	type ApiViewOptions,
	getCommitView,
	getDirectoryListing,
	getFileContent,
	getRepoTreeView,
} from "./api-view";

export {
	CloneManager,
	type CloneManagerOptions,
	type RepoClone,
} from "./clone-manager";
export {
	formatCommitView,
	formatDirectoryListing,
	formatFileContent,
	formatRepoOverview,
	type TreeEntry,
} from "./format";
export {
	type GitHubUrlInfo,
	type GitHubUrlType,
	isGitHubUrl,
	parseGitHubUrl,
} from "./parse-url";
