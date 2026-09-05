// Single source of truth for the GitHub repo this build reports bugs against
// and, when app-update.yml cannot be read, the repo it updates from.
// Keep in sync with backend/internal/cli/start.go releaseRepo and
// frontend/forge.config.ts DEFAULT_RELEASE_REPO. See docs/release-repo.md.
export const GITHUB_OWNER = "ercs-second-brain";
export const GITHUB_REPO = "agent-orchestrator";
export const GITHUB_REPOSITORY = `${GITHUB_OWNER}/${GITHUB_REPO}`;
export const GITHUB_REPO_URL = `https://github.com/${GITHUB_REPOSITORY}`;
export const GITHUB_ISSUES_NEW_URL = `${GITHUB_REPO_URL}/issues/new`;
export const GITHUB_RELEASES_URL = `${GITHUB_REPO_URL}/releases`;
export const GITHUB_RELEASES_LATEST_URL = `${GITHUB_RELEASES_URL}/latest`;
