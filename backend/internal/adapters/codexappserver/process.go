package codexappserver

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"time"

	"github.com/ercs-second-brain/agent-orchestrator/backend/internal/agentlaunch"
	"github.com/ercs-second-brain/agent-orchestrator/backend/internal/ports"
	aoprocess "github.com/ercs-second-brain/agent-orchestrator/backend/internal/process"
)

// codexPlugin is the subset of AO's existing Codex agent plugin that the
// account client reuses. Binary resolution and local auth probing already live
// there and must not be reimplemented: a second copy would drift from what TUI
// sessions do.
type codexPlugin interface {
	ResolveBinary(ctx context.Context) (string, error)
	AuthStatus(ctx context.Context) (ports.AgentAuthStatus, error)
}

// process is a running app-server, abstracted so tests can substitute pipes for
// a child process.
type process struct {
	stdin  io.WriteCloser
	stdout io.Reader
	// reconnected means the provider process and initialized protocol connection
	// survived a prior daemon. The replacement must not initialize/resume it a
	// second time.
	reconnected   bool
	nextRequestID int64
	// stop releases the process. It must be safe to call more than once.
	stop func() error
}

// envSlice overlays session-specific values on the daemon environment and
// returns the KEY=VALUE form expected by os/exec.
func envSlice(overlay map[string]string) []string {
	merged := make(map[string]string, len(os.Environ())+len(overlay))
	for _, entry := range os.Environ() {
		if key, value, ok := cutEnv(entry); ok {
			merged[key] = value
		}
	}
	for key, value := range overlay {
		merged[key] = value
	}
	out := make([]string, 0, len(merged))
	for key, value := range merged {
		out = append(out, key+"="+value)
	}
	return out
}

func cutEnv(entry string) (string, string, bool) {
	for i := 0; i < len(entry); i++ {
		if entry[i] == '=' {
			return entry[:i], entry[i+1:], true
		}
	}
	return entry, "", false
}

// codexProcessEnv applies the same executable-aware PATH augmentation as the
// TUI runtime before the compatibility probe or app-server starts. The resolved
// npm launcher can be absolute and still depend on `#!/usr/bin/env node`;
// Finder-launched daemons commonly resolve the launcher from inventory while
// omitting the Node version manager from PATH.
func codexProcessEnv(ctx context.Context, bin string, env map[string]string) []string {
	overlay := make(map[string]string, len(env)+1)
	for key, value := range env {
		overlay[key] = value
	}
	if _, ok := overlay["PATH"]; !ok {
		overlay["PATH"] = os.Getenv("PATH")
	}
	agentlaunch.AugmentRuntimePATHForLaunchBinary(ctx, overlay, []string{bin}, exec.LookPath)
	return envSlice(overlay)
}

// handshakeTimeout bounds initialize. This is a local IPC call that normally
// settles in well under a second.
const handshakeTimeout = 60 * time.Second

// clientName identifies AO to the provider. It shows up in the app-server's
// reported user agent, which makes a stray process attributable.
const (
	clientName    = "agent-orchestrator"
	clientTitle   = "Agent Orchestrator"
	clientVersion = "0.1.0"
)

func initializeConnection(ctx context.Context, connection *conn) error {
	initCtx, cancel := context.WithTimeout(ctx, handshakeTimeout)
	defer cancel()
	if err := connection.request(initCtx, "initialize", map[string]any{
		"clientInfo":   map[string]any{"name": clientName, "title": clientTitle, "version": clientVersion},
		"capabilities": map[string]any{"experimentalApi": true, "optOutNotificationMethods": nil},
	}, nil); err != nil {
		return fmt.Errorf("initialize: %w", err)
	}
	if err := connection.notify("initialized", nil); err != nil {
		return fmt.Errorf("notify initialized: %w", err)
	}
	return nil
}

func installedCodexVersion(ctx context.Context, bin string) (string, error) {
	cmd := aoprocess.CommandContext(ctx, bin, "--version")
	cmd.Env = codexProcessEnv(ctx, bin, nil)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", err
	}
	return string(output), nil
}
