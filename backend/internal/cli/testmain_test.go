//go:build !e2e

package cli

import (
	"os"
	"testing"

	"github.com/ercs-second-brain/agent-orchestrator/backend/internal/testenv"
)

// TestMain scrubs ambient AO_* environment so the package is hermetic: when
// the suite runs inside an AO worker session, the daemon exports variables
// like AO_SESSION_ID, AO_PROJECT_ID, AO_RUNTIME_LAUNCH_ID, and
// AO_BROWSER_CAPABILITY, and CLI tests asserting unset-default behavior
// (hook launch-id payload fallback, project resolution order, browser
// capability gating) fail spuriously — pass on CI, fail on AO dev boxes.
// Individual tests re-set whatever they need via t.Setenv.
//
// The e2e-tagged build (cli_test package) has its own TestMain, and a test
// binary allows only one — hence this file is excluded from that build; the
// e2e TestMain performs the same scrub.
func TestMain(m *testing.M) {
	testenv.ScrubAmbientDaemonEnv()
	os.Exit(m.Run())
}
