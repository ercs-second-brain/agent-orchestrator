package pi

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/ercs-second-brain/agent-orchestrator/backend/internal/adapters/agent/pi/provision"
)

// installFakeProvisionedBinary writes a fake pinned pi binary under a temp
// managed store and points the resolver at it, restoring the previous root on
// cleanup.
func installFakeProvisionedBinary(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	binaryName := provision.BinaryName(runtime.GOOS)
	path := filepath.Join(root, provision.PiPinnedVersion, binaryName)
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		t.Fatal(err)
	}
	mode := os.FileMode(0o755)
	if runtime.GOOS == "windows" {
		mode = 0o644
	}
	if err := os.WriteFile(path, []byte("#!/bin/sh\necho provisioned-pi\n"), mode); err != nil { //nolint:gosec // test helper
		t.Fatal(err)
	}
	previous := ProvisionStoreRoot()
	SetProvisionStoreRoot(root)
	t.Cleanup(func() { SetProvisionStoreRoot(previous) })
	return path
}

func TestResolvePiBinaryPrefersProvisionedOverPATH(t *testing.T) {
	t.Setenv("AO_PI_BINARY", "")
	provisioned := installFakeProvisionedBinary(t)

	got, err := ResolvePiBinary(context.Background())
	if err != nil {
		t.Fatalf("ResolvePiBinary: %v", err)
	}
	if got != provisioned {
		t.Fatalf("ResolvePiBinary = %q, want provisioned %q", got, provisioned)
	}
}

func TestResolvePiBinaryOverrideWins(t *testing.T) {
	override := filepath.Join(t.TempDir(), "my-pi")
	mode := os.FileMode(0o755)
	if runtime.GOOS == "windows" {
		mode = 0o644
	}
	if err := os.WriteFile(override, []byte("#!/bin/sh\n"), mode); err != nil { //nolint:gosec // test helper
		t.Fatal(err)
	}
	t.Setenv("AO_PI_BINARY", override)
	installFakeProvisionedBinary(t)

	got, err := ResolvePiBinary(context.Background())
	if err != nil {
		t.Fatalf("ResolvePiBinary: %v", err)
	}
	if got != override {
		t.Fatalf("ResolvePiBinary = %q, want override %q", got, override)
	}
}

func TestResolvePiBinaryInvalidOverrideFailsLoudly(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "nope")
	t.Setenv("AO_PI_BINARY", missing)
	installFakeProvisionedBinary(t)

	if _, err := ResolvePiBinary(context.Background()); err == nil {
		t.Fatal("ResolvePiBinary with missing AO_PI_BINARY override succeeded, want loud error")
	}
}

func TestResolvePiBinaryFallsBackToPATHWithoutProvisioned(t *testing.T) {
	t.Setenv("AO_PI_BINARY", "")
	SetProvisionStoreRoot(filepath.Join(t.TempDir(), "empty-store"))
	t.Cleanup(func() { SetProvisionStoreRoot("") })

	// No provisioned binary: resolution must fall through to the unchanged
	// PATH/npm lookup. pi is not installed in the test environment's PATH by
	// default, so an error (not a provisioned path) is the expected outcome;
	// if a developer has pi installed, accept the resolved path.
	got, err := ResolvePiBinary(context.Background())
	if err != nil {
		return
	}
	if filepath.Dir(got) == filepath.Join(ProvisionStoreRoot(), provision.PiPinnedVersion) {
		t.Fatalf("ResolvePiBinary returned provisioned path %q without a provisioned binary", got)
	}
}

func TestResolveProvisionedBinaryAbsentWhenStoreEmpty(t *testing.T) {
	t.Setenv("AO_PI_BINARY", "")
	SetProvisionStoreRoot(filepath.Join(t.TempDir(), "missing"))
	t.Cleanup(func() { SetProvisionStoreRoot("") })

	if got, ok := ResolveProvisionedBinary(); ok {
		t.Fatalf("ResolveProvisionedBinary = %q, want absent", got)
	}
}

func TestPinnedVersionSatisfiesSettledFloor(t *testing.T) {
	// ADR 0005: the pin makes the settled-version gate a compile-time fact.
	// Re-pinning below the floor must fail this test and force a gate rework.
	pinned, ok := parsePiVersion(provision.PiPinnedVersion)
	if !ok {
		t.Fatalf("PiPinnedVersion %q unparseable", provision.PiPinnedVersion)
	}
	minimum, _ := parsePiVersion(minPiSettledVersion)
	if pinned.less(minimum) {
		t.Fatalf("PiPinnedVersion %s is below the settled floor %s", provision.PiPinnedVersion, minPiSettledVersion)
	}
}
