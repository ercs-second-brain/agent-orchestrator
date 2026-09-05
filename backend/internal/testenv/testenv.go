// Package testenv provides helpers that make Go tests hermetic against the
// ambient environment of the machine they run on — AO worker sessions, dev
// shells, and CI runners all differ in inherited environment variables, HOME
// contents, and filesystem umask, and tests that implicitly assume one shape
// become environment-dependent flakes. Import from _test.go files only.
package testenv

import (
	"os"
	"strings"
	"testing"
)

// ScrubAmbientDaemonEnv removes every AO_* variable inherited from the
// surrounding process environment. When the suite runs inside an AO worker
// session, the daemon exports AO_SESSION_ID, AO_PROJECT_ID,
// AO_RUNTIME_LAUNCH_ID, AO_BROWSER_CAPABILITY, AO_DATA_DIR, AO_RUN_FILE, and
// friends; CLI tests that assert unset-default behavior (hook payload
// fallbacks, project resolution order, browser capability gating) then fail
// spuriously even though the code under test is correct. Tests that need
// these variables set them explicitly via t.Setenv, which runs after this
// scrub and takes precedence.
func ScrubAmbientDaemonEnv() {
	for _, kv := range os.Environ() {
		if !strings.HasPrefix(kv, "AO_") {
			continue
		}
		if key, _, ok := strings.Cut(kv, "="); ok && key != "" {
			_ = os.Unsetenv(key)
		}
	}
}

// PrivateTempDir is t.TempDir() hardened to mode 0700. testing's TempDir
// creates the per-test directory with 0777&^umask, which is group-writable on
// machines whose shell umask is 002 (common on shared dev servers) but not on
// CI (umask 022). Tests whose fixtures are checked by the Codex credential
// vault's "no group/other-writable ancestor" security validation otherwise
// pass or fail depending solely on the invoking shell's umask. Use it
// wherever a test directory is validated by those security checks; plain
// t.TempDir() remains fine for fixtures with no such validation.
func PrivateTempDir(t testing.TB) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.Chmod(dir, 0o700); err != nil {
		t.Fatalf("harden temp dir %s: %v", dir, err)
	}
	return dir
}
