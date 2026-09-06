package domain

import "testing"

func TestPiHarnessIsKnown(t *testing.T) {
	if HarnessPi != AgentHarness("pi") {
		t.Fatalf("HarnessPi = %q, want pi", HarnessPi)
	}
	if !HarnessPi.IsKnown() {
		t.Fatal("HarnessPi.IsKnown() = false, want true")
	}
	found := false
	for _, harness := range AllHarnesses {
		if harness == HarnessPi {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("AllHarnesses does not contain HarnessPi")
	}
	if len(AllHarnesses) != 1 {
		t.Fatalf("AllHarnesses = %v, want exactly [pi]", AllHarnesses)
	}
	if HarnessFake.IsKnown() {
		t.Fatal("HarnessFake.IsKnown() = true, want false (fake is a test fixture, not selectable)")
	}
}

func TestHarnessNormalizeIsStoreAndIgnore(t *testing.T) {
	// ADR 0005: non-pi values resolve to pi; stored values stay unchanged.
	for _, legacy := range []AgentHarness{"claude-code", "codex", "kimi", "not-a-harness"} {
		if got := legacy.Normalize(); got != HarnessPi {
			t.Fatalf("%q.Normalize() = %q, want pi", legacy, got)
		}
	}
	if got := HarnessPi.Normalize(); got != HarnessPi {
		t.Fatalf("pi.Normalize() = %q, want pi", got)
	}
	if got := HarnessFake.Normalize(); got != HarnessFake {
		t.Fatalf("fake.Normalize() = %q, want fake (test fixture passthrough)", got)
	}
	if got := AgentHarness("").Normalize(); got != "" {
		t.Fatalf("empty.Normalize() = %q, want empty (no override)", got)
	}
}

func TestReviewerHarnessNormalizeIsPi(t *testing.T) {
	for _, legacy := range []ReviewerHarness{"codex", "claude-code", "not-a-reviewer"} {
		if got := legacy.Normalize(); got != ReviewerPi {
			t.Fatalf("%q.Normalize() = %q, want pi", legacy, got)
		}
	}
	if got := ReviewerHarness("").Normalize(); got != "" {
		t.Fatalf("empty.Normalize() = %q, want empty (no override)", got)
	}
	if ReviewerPi.Normalize() != ReviewerPi {
		t.Fatal("pi.Normalize() changed value")
	}
}
