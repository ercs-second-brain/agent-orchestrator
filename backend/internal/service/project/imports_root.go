package project

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/ercs-second-brain/agent-orchestrator/backend/internal/config"
)

const projectsSubdir = "projects"

// DefaultProjectsParent returns the daemon-local parent directory for cloned and
// uploaded repositories. It lives under AO data dir so paths stay on-server.
func DefaultProjectsParent() (string, error) {
	cfg, err := config.Load()
	if err != nil {
		return "", err
	}
	parent := filepath.Join(cfg.DataDir, projectsSubdir)
	if err := os.MkdirAll(parent, 0o750); err != nil {
		return "", fmt.Errorf("prepare projects directory: %w", err)
	}
	return parent, nil
}
