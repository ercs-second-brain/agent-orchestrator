package project

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/aoagents/agent-orchestrator/backend/internal/domain"
	"github.com/aoagents/agent-orchestrator/backend/internal/gitdefault"
	"github.com/aoagents/agent-orchestrator/backend/internal/httpd/apierr"
	aoprocess "github.com/aoagents/agent-orchestrator/backend/internal/process"
)

// HostedRepositoryCreate is the local checkout that `gh` (or a test fake)
// publishes as a new hosted repository.
type HostedRepositoryCreate struct {
	Name    string
	Private bool
	Path    string
}

// CreateHostedRepositoryFunc publishes an initialized local git checkout.
type CreateHostedRepositoryFunc func(ctx context.Context, in HostedRepositoryCreate) error

var hostedRepositoryName = regexp.MustCompile(`^[A-Za-z0-9._][A-Za-z0-9._-]{0,99}$`)

// CreateRepository initializes a new git checkout, creates a hosted GitHub
// repository (private by default), and registers the project.
func (m *Service) CreateRepository(ctx context.Context, in CreateRepositoryInput) (Project, error) {
	name := strings.TrimSpace(in.Name)
	owner, repo, err := parseHostedRepositoryName(name)
	if err != nil {
		return Project{}, err
	}
	private := true
	if in.Private != nil {
		private = *in.Private
	}
	if in.Config != nil {
		if err := in.Config.Validate(); err != nil {
			return Project{}, apierr.Invalid("INVALID_PROJECT_CONFIG", err.Error(), nil)
		}
	}

	parent := strings.TrimSpace(in.DestinationParent)
	if parent == "" {
		home, homeErr := os.UserHomeDir()
		if homeErr != nil || strings.TrimSpace(home) == "" {
			return Project{}, apierr.Invalid("CLONE_DESTINATION_UNAVAILABLE", "AO could not determine where to create the repository.", nil)
		}
		parent = filepath.Join(home, "projects")
	}
	parent, err = normalizePath(parent)
	if err != nil {
		return Project{}, err
	}
	if err := os.MkdirAll(parent, 0o750); err != nil {
		return Project{}, apierr.Invalid("CLONE_DESTINATION_UNAVAILABLE", "AO could not prepare the repository destination.", map[string]any{"error": err.Error()})
	}
	if err := ensureDirectoryPath(parent); err != nil {
		return Project{}, err
	}

	target := filepath.Join(parent, repo)
	if err := validateRepositorySetupPathSafety(target); err != nil {
		return Project{}, err
	}
	if _, err := os.Lstat(target); err == nil {
		return Project{}, apierr.Conflict("CLONE_DESTINATION_EXISTS", "A folder with this repository name already exists.", map[string]any{"path": target})
	} else if !errors.Is(err, os.ErrNotExist) {
		return Project{}, apierr.Invalid("CLONE_DESTINATION_UNAVAILABLE", "The repository destination could not be inspected.", map[string]any{"path": target})
	}

	if err := os.Mkdir(target, 0o750); err != nil {
		return Project{}, apierr.Invalid("CLONE_DESTINATION_UNAVAILABLE", "AO could not create the repository folder.", map[string]any{"error": err.Error()})
	}
	cleanupPath := target
	defer func() {
		if cleanupPath != "" {
			_ = os.RemoveAll(cleanupPath)
		}
	}()

	if err := initializeCreatedRepository(ctx, target, repo); err != nil {
		return Project{}, err
	}

	hostedName := repo
	if owner != "" {
		hostedName = owner + "/" + repo
	}
	creator := m.createHostedRepository
	if creator == nil {
		creator = createHostedRepositoryWithGh
	}
	if err := creator(ctx, HostedRepositoryCreate{Name: hostedName, Private: private, Path: target}); err != nil {
		return Project{}, err
	}

	displayName := repo
	project, err := m.Add(ctx, AddInput{
		Path:      target,
		ProjectID: in.ProjectID,
		Name:      &displayName,
		Config:    in.Config,
	})
	if err != nil {
		return Project{}, err
	}
	cleanupPath = ""
	return project, nil
}

func parseHostedRepositoryName(raw string) (owner, repo string, err error) {
	if raw == "" || strings.ContainsAny(raw, " \t\r\n") {
		return "", "", invalidRepositoryName()
	}
	owner, repo, ok := strings.Cut(raw, "/")
	if !ok {
		repo = owner
		owner = ""
	}
	if owner != "" && !validHostedRepositorySegment(owner) {
		return "", "", invalidRepositoryName()
	}
	if !validHostedRepositorySegment(repo) {
		return "", "", invalidRepositoryName()
	}
	return owner, repo, nil
}

func validHostedRepositorySegment(value string) bool {
	if value == "." || value == ".." {
		return false
	}
	return hostedRepositoryName.MatchString(value)
}

func invalidRepositoryName() error {
	return apierr.Invalid("INVALID_REPOSITORY_NAME", "Enter a repository name using letters, numbers, dots, hyphens, or underscores. An owner/name pair is also allowed.", nil)
}

func initializeCreatedRepository(ctx context.Context, path, repo string) error {
	if _, err := gitOutput(ctx, path, "init", "-b", domain.DefaultBranchName); err != nil {
		return apierr.Invalid("GIT_INIT_FAILED", "Could not initialize a Git repository.", map[string]any{"error": err.Error()})
	}
	if _, err := gitOutput(ctx, path, "config", "--local", gitdefault.ManagedDefaultConfigKey, domain.DefaultBranchName); err != nil {
		return apierr.Invalid("GIT_INIT_FAILED", "Could not record the default branch for this repository.", map[string]any{"error": err.Error()})
	}
	readme := []byte("# " + repo + "\n")
	if err := os.WriteFile(filepath.Join(path, "README.md"), readme, 0o644); err != nil {
		return apierr.Invalid("GIT_INIT_FAILED", "Could not write the repository README.", map[string]any{"error": err.Error()})
	}
	if _, err := gitOutput(ctx, path, "add", "-A"); err != nil {
		return apierr.Invalid("GIT_ADD_FAILED", "Could not stage files for the initial commit.", map[string]any{"error": err.Error()})
	}
	if _, err := gitOutput(ctx, path, "-c", "user.name=Agent Orchestrator", "-c", "user.email=ao@example.com", "commit", "-m", "initial commit"); err != nil {
		return apierr.Invalid("INITIAL_COMMIT_FAILED", "Could not create the initial commit.", map[string]any{"error": err.Error()})
	}
	return nil
}

func createHostedRepositoryWithGh(ctx context.Context, in HostedRepositoryCreate) error {
	visibility := "--public"
	if in.Private {
		visibility = "--private"
	}
	cmd := aoprocess.CommandContext(ctx, "gh", "repo", "create", in.Name, visibility, "--source", in.Path, "--remote", "origin", "--push")
	cmd.Dir = in.Path
	cmd.Env = hostedGitHubEnv()
	out, err := cmd.CombinedOutput()
	if err == nil {
		return nil
	}
	var executableError *exec.Error
	if errors.As(err, &executableError) {
		return apierr.Invalid("GH_NOT_FOUND", "GitHub CLI (gh) is required to create a repository. Install it and run `gh auth login`, or set AO_GITHUB_TOKEN.", nil)
	}
	if ctx.Err() != nil {
		return apierr.Invalid("REPOSITORY_CREATE_CANCELLED", "Repository creation was cancelled.", nil)
	}
	detail := strings.TrimSpace(string(out))
	if detail == "" {
		detail = err.Error()
	}
	return hostedRepositoryCreateError(detail)
}

func hostedGitHubEnv() []string {
	env := append(os.Environ(), "GIT_TERMINAL_PROMPT=0", "GCM_INTERACTIVE=Never", "GH_PROMPT_DISABLED=1")
	for _, name := range []string{"AO_GITHUB_TOKEN", "GITHUB_TOKEN", "GH_TOKEN"} {
		if token := strings.TrimSpace(os.Getenv(name)); token != "" {
			return append(env, "GH_TOKEN="+token)
		}
	}
	return env
}

func hostedRepositoryCreateError(detail string) error {
	lower := strings.ToLower(detail)
	switch {
	case strings.Contains(lower, "read:org") || (strings.Contains(lower, "missing required") && strings.Contains(lower, "scope")):
		return apierr.Invalid("GH_AUTH_SCOPES", "GitHub CLI is missing the read:org token scope. On the AO host run `gh auth refresh -h github.com -s repo,read:org,workflow`, then restart the daemon.", map[string]any{"error": detail})
	case strings.Contains(lower, "not logged") || strings.Contains(lower, "no github token") || strings.Contains(lower, "gh auth login") || strings.Contains(lower, "authentication required"):
		return apierr.Invalid("GH_AUTH_REQUIRED", "GitHub CLI is not authenticated for the AO daemon. Run `gh auth login` as the daemon user, or set AO_GITHUB_TOKEN, then restart the daemon.", map[string]any{"error": detail})
	case strings.Contains(lower, "already exists"):
		return apierr.Conflict("REPOSITORY_CREATE_EXISTS", "A GitHub repository with this name already exists.", map[string]any{"error": detail})
	default:
		message := "Could not create the GitHub repository."
		if snippet := sanitizeGhOutput(detail); snippet != "" {
			message = message + " " + snippet
		}
		return apierr.Invalid("REPOSITORY_CREATE_FAILED", message, map[string]any{"error": detail})
	}
}

func sanitizeGhOutput(raw string) string {
	collapsed := strings.Join(strings.Fields(raw), " ")
	redacted := hostedTokenPattern.ReplaceAllString(collapsed, "[redacted]")
	if len(redacted) > 280 {
		return strings.TrimSpace(redacted[:280]) + "…"
	}
	return redacted
}

var hostedTokenPattern = regexp.MustCompile(`(?i)\b(?:gh[pousr]_|github_pat_)[a-z0-9_]+`)
