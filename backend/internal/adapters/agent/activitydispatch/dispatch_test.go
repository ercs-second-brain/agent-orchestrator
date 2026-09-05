package activitydispatch

import (
	"testing"

	"github.com/ercs-second-brain/agent-orchestrator/backend/internal/domain"
)

func TestDeriverTokensAreKnownHarnesses(t *testing.T) {
	for token := range Derivers {
		if token == string(domain.HarnessFake) {
			continue
		}
		if !domain.AgentHarness(token).IsKnown() {
			t.Errorf("deriver token %q is not a known AgentHarness", token)
		}
	}
}

func TestSupportsHarness(t *testing.T) {
	if !SupportsHarness(domain.HarnessPi) {
		t.Errorf("SupportsHarness(pi) = false, want true")
	}
	// Harnesses with no callback pipeline must read as unsupported.
	for _, h := range []domain.AgentHarness{domain.AgentHarness("")} {
		if SupportsHarness(h) {
			t.Errorf("SupportsHarness(%q) = true, want false", h)
		}
	}
}

func TestDeriveUnknownAgentIsNoSignal(t *testing.T) {
	if _, ok := Derive("no-such-agent", "stop", nil); ok {
		t.Fatal("Derive returned a signal for an unregistered agent token")
	}
}

func TestFakeDispatchesStandardActivity(t *testing.T) {
	got, ok := Derive("fake", "user-prompt-submit", []byte(`{}`))
	if !ok || got != domain.ActivityActive {
		t.Fatalf("Derive(fake, user-prompt-submit) = (%q, %v), want (%q, true)", got, ok, domain.ActivityActive)
	}
}

func TestPiDispatchesActivity(t *testing.T) {
	got, ok := Derive("pi", "user-prompt-submit", []byte(`{}`))
	if !ok || got != domain.ActivityActive {
		t.Fatalf("Derive(pi, user-prompt-submit) = (%q, %v), want (%q, true)", got, ok, domain.ActivityActive)
	}
}

func TestCoverageForHarness(t *testing.T) {
	if got := CoverageForHarness(domain.HarnessPi); got != SignalCoverageComplete {
		t.Fatalf("CoverageForHarness(pi) = %v, want complete", got)
	}
	if got := CoverageForHarness(domain.AgentHarness("")); got != SignalCoverageNone {
		t.Fatalf("CoverageForHarness(empty) = %v, want none", got)
	}
	if !FullySupportsHarness(domain.HarnessPi) {
		t.Fatal("FullySupportsHarness(pi) = false, want true")
	}
}
