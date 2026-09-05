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
