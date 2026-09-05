package provision

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const (
	testVersionA = "0.90.0"
	testVersionB = "0.91.0"
	testPayload  = "#!/bin/sh\necho fake-pi\n"
)

// fakeRelease serves pi's release layout: per-platform artifacts plus a
// SHA256SUMS file. Tests call setArtifact to install the artifact bytes; the
// checksum file is derived from them so success cases verify cleanly.
// bodyOverride/truncateAt simulate corrupt and truncated downloads.
type fakeRelease struct {
	t            *testing.T
	artifact     string
	artifactData []byte
	checksums    string
	fetches      []string
	// artifactStatus overrides the artifact response status when non-zero.
	artifactStatus int
	// truncateAt, when > 0, serves only that many artifact bytes.
	truncateAt int
	// bodyOverride replaces the artifact body while SHA256SUMS stays honest.
	bodyOverride []byte
}

func newFakeRelease(t *testing.T, goos, version string) *fakeRelease {
	t.Helper()
	name, ok := ArtifactName(goos, "amd64")
	if !ok {
		t.Fatalf("ArtifactName(%s) not supported", goos)
	}
	payload := []byte(testPayload)
	sum := sha256.Sum256(payload)
	f := &fakeRelease{
		t:            t,
		artifact:     name,
		artifactData: payload,
	}
	f.checksums = fmt.Sprintf("%s  %s\n%s  pi-other.tar.gz\n", hex.EncodeToString(sum[:]), name, strings.Repeat("a", 64))
	return f
}

// setArtifact installs the artifact bytes and derives a matching SHA256SUMS.
func (f *fakeRelease) setArtifact(data []byte) {
	f.artifactData = data
	sum := sha256.Sum256(data)
	f.checksums = fmt.Sprintf("%s  %s\n", hex.EncodeToString(sum[:]), f.artifact)
}

func (f *fakeRelease) handler(w http.ResponseWriter, r *http.Request) {
	f.fetches = append(f.fetches, r.URL.Path)
	switch {
	case strings.HasSuffix(r.URL.Path, checksumsFileName):
		fmt.Fprint(w, f.checksums)
	case strings.HasSuffix(r.URL.Path, f.artifact):
		if f.artifactStatus != 0 {
			w.WriteHeader(f.artifactStatus)
			return
		}
		body := f.artifactData
		if f.bodyOverride != nil {
			body = f.bodyOverride
		}
		if f.truncateAt > 0 && f.truncateAt < len(body) {
			w.Write(body[:f.truncateAt]) //nolint:errcheck // test server
			return
		}
		w.Write(body) //nolint:errcheck // test server
	default:
		http.NotFound(w, r)
	}
}

func (f *fakeRelease) start() *httptest.Server {
	f.t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(f.handler))
	f.t.Cleanup(srv.Close)
	return srv
}

// tarArtifact builds a pi release-style tar.gz: one top-level pi/ directory
// containing the binary.
func tarArtifact(t *testing.T, binaryName, content string) []byte {
	t.Helper()
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	if err := tw.WriteHeader(&tar.Header{Name: "pi/", Typeflag: tar.TypeDir, Mode: 0o755}); err != nil {
		t.Fatal(err)
	}
	if err := tw.WriteHeader(&tar.Header{Name: "pi/" + binaryName, Mode: 0o755, Size: int64(len(content))}); err != nil {
		t.Fatal(err)
	}
	if _, err := tw.Write([]byte(content)); err != nil {
		t.Fatal(err)
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// zipArtifact builds a pi release-style zip with pi/<binaryName>.
func zipArtifact(t *testing.T, binaryName, content string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	w, err := zw.Create("pi/" + binaryName)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.Write([]byte(content)); err != nil {
		t.Fatal(err)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func optsFor(srv *httptest.Server, root, version, goos, goarch string) Options {
	return Options{StoreRoot: root, BaseURL: srv.URL, Version: version, GOOS: goos, GOARCH: goarch}
}

func TestEnsureSuccessUnix(t *testing.T) {
	release := newFakeRelease(t, "linux", testVersionA)
	release.setArtifact(tarArtifact(t, "pi", testPayload))
	srv := release.start()
	root := t.TempDir()

	path, err := Ensure(context.Background(), optsFor(srv, root, testVersionA, "linux", "amd64"))
	if err != nil {
		t.Fatalf("Ensure: %v", err)
	}
	if want := filepath.Join(root, testVersionA, "pi"); path != want {
		t.Fatalf("Ensure path = %q, want %q", path, want)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != testPayload {
		t.Fatalf("installed binary content = %q, want original payload", got)
	}
	if info, err := os.Stat(path); err != nil || info.Mode().Perm()&0o111 == 0 {
		t.Fatalf("installed binary not executable: %v", err)
	}
	st := CurrentStatus()
	if st.State != StateReady || st.Path != path || st.Version != testVersionA {
		t.Fatalf("status = %+v, want ready at %q", st, path)
	}
}

func TestEnsureSuccessWindowsZip(t *testing.T) {
	release := newFakeRelease(t, "windows", testVersionA)
	release.setArtifact(zipArtifact(t, "pi.exe", testPayload))
	srv := release.start()
	root := t.TempDir()

	path, err := Ensure(context.Background(), optsFor(srv, root, testVersionA, "windows", "amd64"))
	if err != nil {
		t.Fatalf("Ensure: %v", err)
	}
	if want := filepath.Join(root, testVersionA, "pi.exe"); path != want {
		t.Fatalf("Ensure path = %q, want %q", path, want)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != testPayload {
		t.Fatalf("installed binary content = %q, want original payload", got)
	}
}

func TestEnsureIdempotentNoRefetch(t *testing.T) {
	release := newFakeRelease(t, "linux", testVersionA)
	release.setArtifact(tarArtifact(t, "pi", testPayload))
	srv := release.start()
	root := t.TempDir()

	if _, err := Ensure(context.Background(), optsFor(srv, root, testVersionA, "linux", "amd64")); err != nil {
		t.Fatalf("first Ensure: %v", err)
	}
	first := len(release.fetches)
	if _, err := Ensure(context.Background(), optsFor(srv, root, testVersionA, "linux", "amd64")); err != nil {
		t.Fatalf("second Ensure: %v", err)
	}
	if len(release.fetches) != first {
		t.Fatalf("second Ensure re-fetched artifacts: %v", release.fetches)
	}
}

func TestEnsureChecksumMismatch(t *testing.T) {
	release := newFakeRelease(t, "linux", testVersionA)
	release.setArtifact(tarArtifact(t, "pi", testPayload))
	release.bodyOverride = []byte("totally not the real binary")
	srv := release.start()
	root := t.TempDir()

	_, err := Ensure(context.Background(), optsFor(srv, root, testVersionA, "linux", "amd64"))
	if err == nil {
		t.Fatal("Ensure succeeded with corrupt artifact, want checksum mismatch error")
	}
	if !strings.Contains(err.Error(), "checksum mismatch") {
		t.Fatalf("error = %v, want checksum mismatch detail", err)
	}
	// Nothing may be installed into the version directory.
	if _, statErr := os.Stat(filepath.Join(root, testVersionA, "pi")); !os.IsNotExist(statErr) {
		t.Fatalf("version dir exists after failed install: %v", statErr)
	}
	if st := CurrentStatus(); st.State != StateFailed || st.Error == "" {
		t.Fatalf("status = %+v, want failed with error detail", st)
	}
}

func TestEnsurePartialDownloadFails(t *testing.T) {
	release := newFakeRelease(t, "linux", testVersionA)
	release.setArtifact(tarArtifact(t, "pi", testPayload))
	release.truncateAt = 8
	srv := release.start()
	root := t.TempDir()

	_, err := Ensure(context.Background(), optsFor(srv, root, testVersionA, "linux", "amd64"))
	if err == nil {
		t.Fatal("Ensure succeeded with truncated artifact, want checksum mismatch error")
	}
	if !strings.Contains(err.Error(), "checksum mismatch") {
		t.Fatalf("error = %v, want checksum mismatch detail", err)
	}
	if _, statErr := os.Stat(filepath.Join(root, testVersionA, "pi")); !os.IsNotExist(statErr) {
		t.Fatalf("version dir exists after failed install: %v", statErr)
	}
}

func TestEnsureMissingChecksumEntry(t *testing.T) {
	release := newFakeRelease(t, "linux", testVersionA)
	release.setArtifact(tarArtifact(t, "pi", testPayload))
	release.checksums = fmt.Sprintf("%s  pi-someother.tar.gz\n", strings.Repeat("b", 64))
	srv := release.start()
	root := t.TempDir()

	_, err := Ensure(context.Background(), optsFor(srv, root, testVersionA, "linux", "amd64"))
	if err == nil || !strings.Contains(err.Error(), "no entry for") {
		t.Fatalf("error = %v, want missing SHA256SUMS entry", err)
	}
}

func TestEnsureHTTPFailure(t *testing.T) {
	release := newFakeRelease(t, "linux", testVersionA)
	release.artifactStatus = http.StatusInternalServerError
	srv := release.start()
	root := t.TempDir()

	_, err := Ensure(context.Background(), optsFor(srv, root, testVersionA, "linux", "amd64"))
	if err == nil || !strings.Contains(err.Error(), "unexpected status") {
		t.Fatalf("error = %v, want HTTP failure", err)
	}
	if st := CurrentStatus(); st.State != StateFailed {
		t.Fatalf("status = %+v, want failed", st)
	}
}

func TestEnsurePinChangeReDownloadsAndCleansOld(t *testing.T) {
	release := newFakeRelease(t, "linux", testVersionA)
	release.setArtifact(tarArtifact(t, "pi", testPayload))
	srv := release.start()
	root := t.TempDir()

	if _, err := Ensure(context.Background(), optsFor(srv, root, testVersionA, "linux", "amd64")); err != nil {
		t.Fatalf("Ensure v%s: %v", testVersionA, err)
	}

	releaseB := newFakeRelease(t, "linux", testVersionB)
	releaseB.setArtifact(tarArtifact(t, "pi", testPayload))
	srvB := releaseB.start()
	path, err := Ensure(context.Background(), optsFor(srvB, root, testVersionB, "linux", "amd64"))
	if err != nil {
		t.Fatalf("Ensure v%s: %v", testVersionB, err)
	}
	if want := filepath.Join(root, testVersionB, "pi"); path != want {
		t.Fatalf("Ensure path = %q, want %q", path, want)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("new pin binary missing: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, testVersionA)); !os.IsNotExist(err) {
		t.Fatalf("old version dir survived cleanup: %v", err)
	}
	if st := CurrentStatus(); st.State != StateReady || st.Version != testVersionB {
		t.Fatalf("status = %+v, want ready for %s", st, testVersionB)
	}
}

func TestEnsureCleansDownloadLeftovers(t *testing.T) {
	release := newFakeRelease(t, "linux", testVersionA)
	release.setArtifact(tarArtifact(t, "pi", testPayload))
	srv := release.start()
	root := t.TempDir()

	if err := os.MkdirAll(filepath.Join(root, downloadTempPrefix+"junk"), 0o750); err != nil {
		t.Fatal(err)
	}
	if _, err := Ensure(context.Background(), optsFor(srv, root, testVersionA, "linux", "amd64")); err != nil {
		t.Fatalf("Ensure: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, downloadTempPrefix+"junk")); !os.IsNotExist(err) {
		t.Fatalf("download leftover survived cleanup: %v", err)
	}
}

func TestEnsureUnsupportedPlatform(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatalf("unexpected fetch for %s", r.URL.Path)
	}))
	t.Cleanup(srv.Close)
	root := t.TempDir()

	_, err := Ensure(context.Background(), optsFor(srv, root, testVersionA, "linux", "arm64"))
	if err == nil || !strings.Contains(err.Error(), "does not support linux/arm64") {
		t.Fatalf("error = %v, want unsupported platform", err)
	}
	if st := CurrentStatus(); st.State != StateFailed {
		t.Fatalf("status = %+v, want failed", st)
	}
}

func TestEnsureRespectsAODataDirViaDefaultStoreRoot(t *testing.T) {
	t.Setenv("AO_DATA_DIR", t.TempDir())
	if want := filepath.Join(os.Getenv("AO_DATA_DIR"), "bin", "pi"); DefaultStoreRoot() != want {
		t.Fatalf("DefaultStoreRoot() = %q, want %q", DefaultStoreRoot(), want)
	}
}

func TestEnsureContextCanceled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := Ensure(ctx, Options{StoreRoot: t.TempDir()})
	if err == nil {
		t.Fatal("Ensure succeeded with canceled context, want error")
	}
}

func TestArtifactNameCoversSupportedPlatforms(t *testing.T) {
	cases := map[string]string{
		"linux/amd64":   "pi-linux-x64.tar.gz",
		"darwin/arm64":  "pi-darwin-arm64.tar.gz",
		"darwin/amd64":  "pi-darwin-x64.tar.gz",
		"windows/amd64": "pi-windows-x64.zip",
	}
	for platform, want := range cases {
		goos, goarch, _ := strings.Cut(platform, "/")
		got, ok := ArtifactName(goos, goarch)
		if !ok || got != want {
			t.Fatalf("ArtifactName(%s) = %q,%v, want %q", platform, got, ok, want)
		}
	}
	for _, platform := range []string{"linux/arm64", "windows/arm64", "freebsd/amd64"} {
		goos, goarch, _ := strings.Cut(platform, "/")
		if _, ok := ArtifactName(goos, goarch); ok {
			t.Fatalf("ArtifactName(%s) supported, want unsupported", platform)
		}
	}
}

func TestBinaryPathFollowsGOOS(t *testing.T) {
	if got := BinaryPath("/store", testVersionA); got == "" {
		t.Fatal("BinaryPath returned empty")
	}
}
