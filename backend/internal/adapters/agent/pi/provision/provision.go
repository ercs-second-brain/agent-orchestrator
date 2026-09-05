// Package provision manages AO's pinned pi binary (ADR 0005, milestone N1).
//
// Each AO release pins an exact pi version (PiPinnedVersion). On daemon start
// AO ensures that binary exists under the AO data dir
// (`<stateDir>/bin/pi/<version>/pi`), downloading the matching release
// artifact from pi's GitHub releases and verifying it against the release's
// published SHA256SUMS file before installing it. Provisioning is idempotent:
// a present, executable pinned binary short-circuits the download, and old
// version directories are cleaned up after a successful install.
//
// Provisioning is strictly best-effort: the daemon runs it in the background
// and never fails startup or session spawn because of it. The pi binary
// resolver prefers the provisioned binary but falls back to the user's own
// PATH/npm install (see the pi adapter), so a failed or in-flight download
// only means AO keeps using whatever pi it would have used before this
// package existed. Current state is surfaced through the system requirements
// report (requirement id "pi-provisioning").
//
// Platform support mirrors pi's published release artifacts: linux-x64,
// darwin-arm64, darwin-x64, and win32-x64. Any other platform reports
// unsupported and relies on the PATH fallback. Windows/ConPTY verification of
// the downloaded artifact is tracked as a follow-up (ADR 0005 open question 3).
package provision

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
)

// PiPinnedVersion is the exact pi version this AO release pins and
// provisions. It is a compile-time fact per ADR 0005: capability gates keyed
// to pi behavior may assume it, and re-pinning is a deliberate change to this
// constant shipped in an AO release. Bumping it must also keep the binary
// version floor in the pi adapter satisfied (see the pi package tests).
const PiPinnedVersion = "0.85.1"

// DefaultReleaseBaseURL is the pi GitHub releases download root. Artifact and
// checksum URLs are <base>/v<version>/<name>.
const DefaultReleaseBaseURL = "https://github.com/earendil-works/pi/releases/download"

const (
	// maxArtifactBytes bounds the downloaded release artifact. The largest
	// observed artifact is well under 100MB; the cap only guards against a
	// runaway or hostile response, not real releases.
	maxArtifactBytes = 512 << 20
	// maxChecksumsBytes bounds the SHA256SUMS file (a few hundred bytes).
	maxChecksumsBytes = 1 << 20
	// downloadTempPrefix marks in-progress download directories so cleanup can
	// remove leftovers from crashed runs.
	downloadTempPrefix = "download-"
	checksumsFileName  = "SHA256SUMS"
)

// State is the coarse provisioning lifecycle used by the status surface.
type State string

const (
	// StateReady means the pinned binary is installed and executable.
	StateReady State = "ready"
	// StatePending means a download/verify/install is in flight or has not
	// started yet this boot.
	StatePending State = "pending"
	// StateFailed means provisioning did not succeed. Sessions keep working
	// via the PATH fallback.
	StateFailed State = "failed"
)

// Status is the current provisioning state for the pinned pi binary. It is
// process-local (provisioning runs at daemon start) and is surfaced through
// the system requirements report.
type Status struct {
	State   State  `json:"state" enum:"ready,pending,failed"`
	Version string `json:"version" description:"Pinned pi version this AO release provisions."`
	Path    string `json:"path,omitempty" description:"Installed binary path when State is ready."`
	Error   string `json:"error,omitempty" description:"Failure detail when State is failed."`
}

var (
	statusMu      sync.Mutex
	currentStatus = Status{State: StatePending, Version: PiPinnedVersion}
)

func recordStatus(s Status) {
	statusMu.Lock()
	defer statusMu.Unlock()
	currentStatus = s
}

// CurrentStatus reports the latest provisioning state. It never returns an
// empty State: before any Ensure call it reports pending.
func CurrentStatus() Status {
	statusMu.Lock()
	defer statusMu.Unlock()
	return currentStatus
}

// Options configures one Ensure run. Zero values select production defaults;
// the overridable fields exist for tests and for explicit daemon wiring.
type Options struct {
	// StoreRoot is the managed-pi directory, typically <stateDir>/bin/pi.
	// Required.
	StoreRoot string
	// BaseURL overrides the release download root (tests inject an
	// httptest server).
	BaseURL string
	// Client overrides the HTTP client (tests inject transport behavior).
	Client *http.Client
	// Version overrides PiPinnedVersion (tests exercise pin changes).
	Version string
	// GOOS/GOARCH override runtime.GOOS/runtime.GOARCH (tests exercise
	// artifact selection and the Windows zip path without cross-compiling).
	GOOS, GOARCH string
	// Logger receives progress and failure lines.
	Logger *slog.Logger
}

// BinaryName returns the pi executable file name for the given OS.
func BinaryName(goos string) string {
	if goos == "windows" {
		return "pi.exe"
	}
	return "pi"
}

// ArtifactName returns pi's GitHub release artifact for the given platform.
// It reports ok=false for platforms pi does not publish binaries for; those
// platforms rely on the PATH fallback.
func ArtifactName(goos, goarch string) (string, bool) {
	switch {
	case goos == "linux" && goarch == "amd64":
		return "pi-linux-x64.tar.gz", true
	case goos == "darwin" && goarch == "arm64":
		return "pi-darwin-arm64.tar.gz", true
	case goos == "darwin" && goarch == "amd64":
		return "pi-darwin-x64.tar.gz", true
	case goos == "windows" && goarch == "amd64":
		return "pi-windows-x64.zip", true
	default:
		return "", false
	}
}

// BinaryPath returns where the pinned binary is (or would be) installed for
// the given store root and version.
func BinaryPath(storeRoot, version string) string {
	return filepath.Join(storeRoot, version, BinaryName(runtime.GOOS))
}

// DefaultStoreRoot derives the managed-pi store root from the environment,
// mirroring the daemon's state-dir resolution: AO_DATA_DIR is the state root
// when set, otherwise ~/.ao. The daemon wires an explicit root from
// config.Config.StateDir; this fallback exists for callers that resolve the
// binary before (or without) that wiring.
func DefaultStoreRoot() string {
	if dir := strings.TrimSpace(os.Getenv("AO_DATA_DIR")); dir != "" {
		return filepath.Join(dir, "bin", "pi")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".ao", "bin", "pi")
}

// Ensure makes sure the pinned pi binary exists under StoreRoot, downloading
// and checksum-verifying it if missing. It returns the installed binary path.
// The returned error never needs to block a caller that can fall back to a
// PATH-resolved pi — Ensure exists so the resolver can prefer a binary whose
// provenance and version AO controls.
func Ensure(ctx context.Context, opts Options) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", fmt.Errorf("provision pi: %w", err)
	}
	storeRoot := strings.TrimSpace(opts.StoreRoot)
	if storeRoot == "" {
		return "", fmt.Errorf("provision pi: StoreRoot is required")
	}
	version := opts.Version
	if version == "" {
		version = PiPinnedVersion
	}
	goos, goarch := opts.GOOS, opts.GOARCH
	if goos == "" {
		goos = runtime.GOOS
	}
	if goarch == "" {
		goarch = runtime.GOARCH
	}
	baseURL := opts.BaseURL
	if baseURL == "" {
		baseURL = DefaultReleaseBaseURL
	}
	client := opts.Client
	if client == nil {
		client = http.DefaultClient
	}
	logger := opts.Logger
	if logger == nil {
		logger = slog.Default()
	}

	finalPath := filepath.Join(storeRoot, version, BinaryName(goos))
	if IsExecutableFile(finalPath) {
		recordStatus(Status{State: StateReady, Version: version, Path: finalPath})
		return finalPath, nil
	}

	artifact, ok := ArtifactName(goos, goarch)
	if !ok {
		err := fmt.Errorf("provision pi: managed provisioning does not support %s/%s; install pi on PATH instead", goos, goarch)
		recordStatus(Status{State: StateFailed, Version: version, Error: err.Error()})
		return "", err
	}

	recordStatus(Status{State: StatePending, Version: version})

	if err := os.MkdirAll(storeRoot, 0o750); err != nil {
		err = fmt.Errorf("provision pi: create store root: %w", err)
		recordStatus(Status{State: StateFailed, Version: version, Error: err.Error()})
		return "", err
	}

	// Download into a temp directory under the store root so the final rename
	// stays on one filesystem (atomic) and crashed runs leave deletable
	// leftovers instead of half-installed version directories.
	tmpDir, err := os.MkdirTemp(storeRoot, downloadTempPrefix)
	if err != nil {
		err = fmt.Errorf("provision pi: create download dir: %w", err)
		recordStatus(Status{State: StateFailed, Version: version, Error: err.Error()})
		return "", err
	}
	defer os.RemoveAll(tmpDir) //nolint:errcheck // best-effort cleanup of the staging dir

	sums, err := fetchBounded(ctx, client, baseURL+"/v"+version+"/"+checksumsFileName, maxChecksumsBytes)
	if err != nil {
		return fail(version, fmt.Errorf("provision pi: fetch checksums: %w", err))
	}
	wantSum, err := expectedChecksum(sums, artifact)
	if err != nil {
		return fail(version, err)
	}

	artifactData, err := fetchBounded(ctx, client, baseURL+"/v"+version+"/"+artifact, maxArtifactBytes)
	if err != nil {
		return fail(version, fmt.Errorf("provision pi: fetch %s: %w", artifact, err))
	}
	if got := sha256Hex(artifactData); got != wantSum {
		return fail(version, fmt.Errorf("provision pi: checksum mismatch for %s: got sha256 %s, want %s (delete %s and retry if a mirror is suspected)", artifact, got, wantSum, storeRoot))
	}

	binaryPath, err := extractBinary(artifactData, tmpDir, goos)
	if err != nil {
		return fail(version, err)
	}

	if err := installBinary(binaryPath, finalPath); err != nil {
		return fail(version, err)
	}
	cleanupOldVersions(storeRoot, version)

	logger.Info("provisioned pinned pi", "version", version, "path", finalPath)
	recordStatus(Status{State: StateReady, Version: version, Path: finalPath})
	return finalPath, nil
}

// fail records a failed status and returns the error unchanged.
func fail(version string, err error) (string, error) {
	recordStatus(Status{State: StateFailed, Version: version, Error: err.Error()})
	return "", err
}

// fetchBounded GETs url and reads at most maxBytes+1 bytes so an over-long
// response is detected as an error instead of silently truncating.
func fetchBounded(ctx context.Context, client *http.Client, url string, maxBytes int64) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, http.NoBody)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GET %s: unexpected status %s", url, resp.Status)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxBytes+1))
	if err != nil {
		return nil, fmt.Errorf("GET %s: %w", url, err)
	}
	if int64(len(data)) > maxBytes {
		return nil, fmt.Errorf("GET %s: response exceeds %d byte limit", url, maxBytes)
	}
	return data, nil
}

// expectedChecksum parses a SHA256SUMS file (<64 hex>  <name> per line) and
// returns the checksum for name.
func expectedChecksum(sums []byte, name string) (string, error) {
	for _, line := range strings.Split(string(sums), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) != 2 {
			continue
		}
		if fields[1] == name {
			if len(fields[0]) != sha256.Size*2 {
				return "", fmt.Errorf("provision pi: malformed checksum for %s in %s", name, checksumsFileName)
			}
			return strings.ToLower(fields[0]), nil
		}
	}
	return "", fmt.Errorf("provision pi: %s has no entry for %s", checksumsFileName, name)
}

func sha256Hex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

// extractBinary unpacks the release artifact and writes the pi binary into
// destDir with executable permissions. Only the archive entry pi/<binary> is
// accepted: pi ships one top-level directory, and an exact-name match keeps
// path traversal out of the extraction.
func extractBinary(artifactData []byte, destDir, goos string) (string, error) {
	binaryName := BinaryName(goos)
	member := "pi/" + binaryName
	switch {
	case strings.HasSuffix(binaryName, ".exe"):
		return extractZipMember(artifactData, destDir, member, binaryName)
	default:
		return extractTarMember(artifactData, destDir, member, binaryName)
	}
}

func extractTarMember(artifactData []byte, destDir, member, binaryName string) (string, error) {
	gz, err := gzip.NewReader(bytes.NewReader(artifactData))
	if err != nil {
		return "", fmt.Errorf("provision pi: open artifact: %w", err)
	}
	defer func() { _ = gz.Close() }()
	tr := tar.NewReader(gz)
	for {
		header, err := tr.Next()
		if errors.Is(err, io.EOF) {
			return "", fmt.Errorf("provision pi: artifact does not contain %s", member)
		}
		if err != nil {
			return "", fmt.Errorf("provision pi: read artifact: %w", err)
		}
		if header.Typeflag != tar.TypeReg || filepath.Clean(header.Name) != member {
			continue
		}
		return writeFileExecutable(destDir, binaryName, tr)
	}
}

func extractZipMember(artifactData []byte, destDir, member, binaryName string) (string, error) {
	zr, err := zip.NewReader(bytes.NewReader(artifactData), int64(len(artifactData)))
	if err != nil {
		return "", fmt.Errorf("provision pi: open artifact: %w", err)
	}
	var match *zip.File
	for _, f := range zr.File {
		if !f.FileInfo().IsDir() && filepath.Clean(f.Name) == member {
			match = f
			break
		}
	}
	if match == nil {
		return "", fmt.Errorf("provision pi: artifact does not contain %s", member)
	}
	rc, err := match.Open()
	if err != nil {
		return "", fmt.Errorf("provision pi: read %s: %w", member, err)
	}
	defer func() { _ = rc.Close() }()
	return writeFileExecutable(destDir, binaryName, rc)
}

func writeFileExecutable(destDir, binaryName string, r io.Reader) (string, error) {
	out := filepath.Join(destDir, binaryName)
	f, err := os.OpenFile(out, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o755) //nolint:gosec // destDir is an AO-owned temp dir
	if err != nil {
		return "", fmt.Errorf("provision pi: write binary: %w", err)
	}
	if _, err := io.Copy(f, r); err != nil {
		_ = f.Close()
		return "", fmt.Errorf("provision pi: write binary: %w", err)
	}
	if err := f.Sync(); err != nil {
		_ = f.Close()
		return "", fmt.Errorf("provision pi: sync binary: %w", err)
	}
	// A failed close can mean truncated bytes on disk, so it is part of the
	// write contract, not best-effort cleanup.
	if err := f.Close(); err != nil {
		return "", fmt.Errorf("provision pi: close binary: %w", err)
	}
	return out, nil
}

// installBinary atomically moves the extracted binary to finalPath. The
// version-scoped destination means a normal pin change never overwrites a
// live file; re-installing the same version (corrupt download recovery)
// removes the stale file first, which only Windows requires explicitly.
func installBinary(extracted, finalPath string) error {
	if err := os.MkdirAll(filepath.Dir(finalPath), 0o750); err != nil {
		return fmt.Errorf("provision pi: create version dir: %w", err)
	}
	if _, err := os.Stat(finalPath); err == nil {
		if err := os.Remove(finalPath); err != nil {
			return fmt.Errorf("provision pi: replace existing binary: %w", err)
		}
	}
	if err := os.Rename(extracted, finalPath); err != nil {
		return fmt.Errorf("provision pi: install binary: %w", err)
	}
	return nil
}

// cleanupOldVersions removes every sibling of the installed version directory
// — superseded pins and download-* leftovers from crashed runs — so a
// re-pin does not accumulate stale multi-MB binaries.
func cleanupOldVersions(storeRoot, keepVersion string) {
	entries, err := os.ReadDir(storeRoot)
	if err != nil {
		return
	}
	for _, entry := range entries {
		if entry.Name() == keepVersion {
			continue
		}
		_ = os.RemoveAll(filepath.Join(storeRoot, entry.Name()))
	}
}

// IsExecutableFile reports whether path is a regular file usable as an
// executable (executable bit set on unix; regular file on Windows, where the
// bit is not meaningful).
func IsExecutableFile(path string) bool {
	info, err := os.Stat(path)
	if err != nil || !info.Mode().IsRegular() {
		return false
	}
	if runtime.GOOS == "windows" {
		return true
	}
	return info.Mode().Perm()&0o111 != 0
}
