package modelcatalog

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ercs-second-brain/agent-orchestrator/backend/internal/ports"
)

func TestModelCommandUsesProjectWorkingDirectory(t *testing.T) {
	cmd := modelCommand(context.Background(), "pi", []string{"--list-models"}, "/work/project", map[string]string{"PI_CONFIG": "/project/pi.json"})
	if cmd.Dir != "/work/project" {
		t.Fatalf("Dir = %q, want /work/project", cmd.Dir)
	}
	if cmd.WaitDelay != commandTerminationWait {
		t.Fatalf("WaitDelay = %s, want %s", cmd.WaitDelay, commandTerminationWait)
	}
	if !environmentContains(cmd.Env, "PI_CONFIG=/project/pi.json") {
		t.Fatalf("Env does not contain project override: %#v", cmd.Env)
	}
}

func environmentContains(env []string, wanted string) bool {
	for _, item := range env {
		if item == wanted {
			return true
		}
	}
	return false
}

func TestModelCommandOverridesProjectEnvironment(t *testing.T) {
	cmd := modelCommand(context.Background(), "pi", []string{"--list-models"}, "", map[string]string{"PI_CONFIG": "/project/pi.json"})
	if !environmentContains(cmd.Env, "PI_CONFIG=/project/pi.json") {
		t.Fatalf("Env does not contain project override: %#v", cmd.Env)
	}
}

func TestCommandDiscoveryTimeoutAllowsSlowModelRegistries(t *testing.T) {
	if commandTimeout < 20*time.Second {
		t.Fatalf("commandTimeout = %s, want at least 20s", commandTimeout)
	}
}

func TestModelDiscoveryErrorExplainsTimeout(t *testing.T) {
	deadlineCtx, deadlineCancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer deadlineCancel()
	err := modelDiscoveryError(deadlineCtx, "pi", errors.New("signal: killed"))
	if !strings.Contains(err.Error(), "pi model discovery timed out after 20s") {
		t.Fatalf("error = %q, want clear timeout", err)
	}
}

func TestPiDiscoveryUsesListModelsFlag(t *testing.T) {
	spec := commandSpecs["pi"]
	if len(spec.args) != 1 || spec.args[0] != "--list-models" {
		t.Fatalf("pi discovery args = %q, want [--list-models]", spec.args)
	}
	if spec.parser == nil {
		t.Fatalf("pi parser is nil")
	}
}

func TestParsePiModelsBuildsProviderQualifiedIDs(t *testing.T) {
	got, err := parsePiModels([]byte(`provider   model                       context  max-out  thinking  images
anthropic  claude-sonnet-4-6           1M       64K      yes       yes
openai     gpt-5.5                     272K     128K     yes       yes
`))
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].ID != "anthropic/claude-sonnet-4-6" || got[1].ID != "openai/gpt-5.5" {
		t.Fatalf("models = %#v", got)
	}
}

func TestBasePiIsCatalogWithoutCustomEntry(t *testing.T) {
	got := Base("pi")
	if got.SelectionMode != ports.ModelSelectionCatalog || got.AllowCustom || got.Source != "cli" {
		t.Fatalf("Base(pi) = %#v", got)
	}
	if got.CustomModelEntry != ports.CustomModelEntryConfigured {
		t.Fatalf("CustomModelEntry = %v, want configured", got.CustomModelEntry)
	}
	if len(got.Models) != 0 {
		t.Fatalf("Base(pi) models = %#v, want no AO-owned model IDs", got.Models)
	}
}

func TestBaseUnknownAgentFallsBackToManual(t *testing.T) {
	got := Base("unknown-agent")
	if got.Source != "manual" {
		t.Fatalf("Source = %q, want manual", got.Source)
	}
}

func TestDiscoverRequiresBinary(t *testing.T) {
	if _, err := Discover(context.Background(), "pi", "", ".", nil); err == nil {
		t.Fatal("Discover with empty binary must fail")
	}
}

func TestCatalogFingerprintKeepsTheExecutableOnlyValue(t *testing.T) {
	// pi reads no configuration, so the fingerprint must stay byte-identical to
	// the executable fingerprint earlier daemons cached under.
	dir := t.TempDir()
	got := CatalogFingerprint(context.Background(), "pi", filepath.Join(dir, "missing"), dir, nil)
	if want := BinaryVersion(context.Background(), filepath.Join(dir, "missing")); got != want {
		t.Fatalf("fingerprint = %q, want the executable fingerprint %q", got, want)
	}
}
