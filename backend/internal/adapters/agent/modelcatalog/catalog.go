// Package modelcatalog normalizes the model-list surface exposed by pi, the
// single supported harness (ADR 0005).
package modelcatalog

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/ercs-second-brain/agent-orchestrator/backend/internal/ports"
	aoprocess "github.com/ercs-second-brain/agent-orchestrator/backend/internal/process"
)

const (
	// Model-list commands may initialize provider registries or refresh remote
	// metadata before printing their catalog, so keep one consistent, bounded
	// allowance.
	commandTimeout = 20 * time.Second

	// Some CLIs leave descendants holding stdout/stderr open after the parent is
	// canceled. Bound that pipe-drain wait so a timed-out discovery request does
	// not linger well beyond commandTimeout.
	commandTerminationWait = 2 * time.Second
)

type commandSpec struct {
	args   []string
	parser func([]byte) ([]ports.AgentModelInfo, error)
}

var ansiPattern = regexp.MustCompile(`\x1b\[[0-9;]*[[:alpha:]]`)

type commandSpecMap = map[string]commandSpec

var commandSpecs = commandSpecMap{
	"pi": {args: []string{"--list-models"}, parser: parsePiModels},
}

// Base returns the picker behavior AO can provide without executing a CLI.
func Base(agentID string) ports.AgentModelCatalog {
	now := time.Now().UTC()
	entryMode := customModelEntryMode(agentID)
	if hasDiscoverySource(agentID) {
		return ports.AgentModelCatalog{
			AgentID:          agentID,
			SelectionMode:    ports.ModelSelectionCatalog,
			Models:           []ports.AgentModelInfo{},
			CustomModelEntry: entryMode,
			AllowCustom:      entryMode == ports.CustomModelEntryDirect,
			Source:           "cli",
			FetchedAt:        now,
		}
	}
	return Manual(agentID)
}

// Manual returns the capability-aware fallback used when discovery fails before
// AO has a successful cache.
func Manual(agentID string) ports.AgentModelCatalog {
	entryMode := customModelEntryMode(agentID)
	selectionMode := ports.ModelSelectionCatalog
	if entryMode == ports.CustomModelEntryDirect {
		selectionMode = ports.ModelSelectionText
	}
	return ports.AgentModelCatalog{
		AgentID:          agentID,
		SelectionMode:    selectionMode,
		Models:           []ports.AgentModelInfo{},
		CustomModelEntry: entryMode,
		AllowCustom:      entryMode == ports.CustomModelEntryDirect,
		Source:           "manual",
		FetchedAt:        time.Now().UTC(),
	}
}

// customModelEntryMode is stable adapter capability policy. Model names and
// availability remain agent-owned and are never listed here.
func customModelEntryMode(agentID string) ports.CustomModelEntryMode {
	if agentID == "pi" {
		return ports.CustomModelEntryConfigured
	}
	return ports.CustomModelEntryNone
}

// Discoverer implements the model-discovery port for production daemon wiring.
type Discoverer struct{}

// Discover uses pi's own `--list-models` surface.
func (d Discoverer) Discover(ctx context.Context, request ports.AgentModelDiscoveryRequest) (ports.AgentModelCatalog, error) {
	return Discover(ctx, request.AgentID, request.Binary, request.WorkingDir, request.Env)
}

// CatalogFingerprint returns a stable fingerprint of the discovery inputs: the
// installed agent binary. Folding configuration in is what lets a settings edit
// invalidate a cached catalog, since the binary alone does not change when
// settings do. pi's catalog depends on the binary alone today.
func (Discoverer) CatalogFingerprint(ctx context.Context, request ports.AgentModelDiscoveryRequest) string {
	return CatalogFingerprint(ctx, request.AgentID, request.Binary, request.WorkingDir, request.Env)
}

// Manual returns the manual-entry fallback catalog for an agent.
func (Discoverer) Manual(agentID string) ports.AgentModelCatalog { return Manual(agentID) }

// Discover executes model catalog discovery for an agent binary.
func Discover(ctx context.Context, agentID, binary, workingDir string, env map[string]string) (ports.AgentModelCatalog, error) {
	base := Base(agentID)
	spec, ok := commandSpecs[agentID]
	if !ok {
		return base, nil
	}
	if strings.TrimSpace(binary) == "" {
		return base, errors.New("agent binary is not installed")
	}
	runCtx, cancel := context.WithTimeout(ctx, commandTimeout)
	defer cancel()
	cmd := modelCommand(runCtx, binary, spec.args, workingDir, env)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return base, modelDiscoveryError(runCtx, agentID, err)
	}
	models, err := spec.parser(output)
	if err != nil {
		return base, fmt.Errorf("%s model discovery: %w", agentID, err)
	}
	models = normalize(models)
	if len(models) == 0 {
		return base, fmt.Errorf("%s model discovery returned no models", agentID)
	}
	base.Models = models
	base.Source = "cli"
	base.FetchedAt = time.Now().UTC()
	return base, nil
}

func hasDiscoverySource(agentID string) bool {
	_, hasCommand := commandSpecs[agentID]
	return hasCommand
}

func modelCommand(ctx context.Context, binary string, args []string, workingDir string, env map[string]string) *exec.Cmd {
	cmd := aoprocess.CommandContext(ctx, binary, args...) //nolint:gosec // binary is adapter-resolved, args are static
	cmd.WaitDelay = commandTerminationWait
	if strings.TrimSpace(workingDir) != "" {
		cmd.Dir = workingDir
	}
	cmd.Env = mergedEnvironment(os.Environ(), env)
	return cmd
}

func mergedEnvironment(base []string, overrides map[string]string) []string {
	if len(overrides) == 0 {
		return base
	}
	filtered := make([]string, 0, len(base)+len(overrides))
	for _, item := range base {
		key, _, _ := strings.Cut(item, "=")
		if _, overridden := overrides[key]; !overridden {
			filtered = append(filtered, item)
		}
	}
	for key, value := range overrides {
		filtered = append(filtered, key+"="+value)
	}
	return filtered
}

func modelDiscoveryError(runCtx context.Context, agentID string, commandErr error) error {
	if errors.Is(runCtx.Err(), context.DeadlineExceeded) {
		return fmt.Errorf("%s model discovery timed out after %s", agentID, commandTimeout)
	}
	if errors.Is(runCtx.Err(), context.Canceled) {
		return fmt.Errorf("%s model discovery canceled: %w", agentID, context.Canceled)
	}
	return fmt.Errorf("%s model discovery: %w", agentID, commandErr)
}

// BinaryVersion returns the binary's reported version string, or "" when the
// binary cannot be resolved or probed.
func BinaryVersion(ctx context.Context, binary string) string {
	if ctx.Err() != nil || strings.TrimSpace(binary) == "" {
		return ""
	}
	resolved, err := exec.LookPath(binary)
	if err != nil {
		return ""
	}
	if evaluated, evalErr := filepath.EvalSymlinks(resolved); evalErr == nil {
		resolved = evaluated
	}
	info, err := os.Stat(resolved)
	if err != nil || !info.Mode().IsRegular() {
		return ""
	}
	hash := sha256.New()
	_, _ = hash.Write([]byte(resolved))
	_, _ = hash.Write([]byte{0})
	_, _ = hash.Write([]byte(strconv.FormatInt(info.Size(), 10)))
	_, _ = hash.Write([]byte{0})
	_, _ = hash.Write([]byte(strconv.FormatInt(info.ModTime().UnixNano(), 10)))
	return fmt.Sprintf("%x", hash.Sum(nil)[:8])
}

// CatalogFingerprint hashes the discovery inputs: the resolved executable. A
// cached catalog stays valid only while this is unchanged.
func CatalogFingerprint(ctx context.Context, agentID, binary, workingDir string, env map[string]string) string {
	// The signature keeps the shared port shape; pi's catalog depends on the
	// executable alone, so the working directory and environment are ignored.
	_, _ = workingDir, env
	_ = agentID
	return BinaryVersion(ctx, binary)
}

func parsePiModels(output []byte) ([]ports.AgentModelInfo, error) {
	output = []byte(ansiPattern.ReplaceAllString(string(output), ""))
	var models []ports.AgentModelInfo
	for _, line := range strings.Split(string(output), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 || strings.EqualFold(fields[0], "provider") {
			continue
		}
		provider := strings.TrimSpace(fields[0])
		modelID := strings.TrimSpace(fields[1])
		if !looksLikeModelID(provider) || !looksLikeModelID(modelID) {
			continue
		}
		id := provider + "/" + modelID
		models = append(models, ports.AgentModelInfo{ID: id, Label: modelID, Provider: provider})
	}
	return normalize(models), nil
}

func looksLikeModelID(value string) bool {
	value = strings.Trim(value, "`\"'[](),:")
	if value == "" {
		return false
	}
	for _, r := range value {
		switch {
		case r >= 'a' && r <= 'z':
		case r >= 'A' && r <= 'Z':
		case r >= '0' && r <= '9':
		case strings.ContainsRune("./:_-@+", r):
		default:
			return false
		}
	}
	switch strings.ToLower(value) {
	case "model", "models", "provider":
		return false
	default:
		return true
	}
}

func normalize(models []ports.AgentModelInfo) []ports.AgentModelInfo {
	byID := make(map[string]ports.AgentModelInfo, len(models))
	for _, item := range models {
		item.ID = strings.TrimSpace(item.ID)
		if item.ID == "" {
			continue
		}
		if strings.TrimSpace(item.Label) == "" {
			item.Label = item.ID
		}
		if previous, ok := byID[item.ID]; ok {
			if previous.Label == previous.ID && item.Label != item.ID {
				previous.Label = item.Label
			}
			if previous.Provider == "" {
				previous.Provider = item.Provider
			}
			previous.IsDefault = previous.IsDefault || item.IsDefault
			byID[previous.ID] = previous
			continue
		}
		byID[item.ID] = item
	}
	out := make([]ports.AgentModelInfo, 0, len(byID))
	for _, item := range byID {
		out = append(out, item)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].IsDefault != out[j].IsDefault {
			return out[i].IsDefault
		}
		return strings.ToLower(out[i].Label) < strings.ToLower(out[j].Label)
	})
	return out
}
