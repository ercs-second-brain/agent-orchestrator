package domain

// AgentHarness identifies which agent CLI/runtime a session drives. Since
// ADR 0005 pi is the single supported harness.
type AgentHarness string

// Supported agent harnesses.
const (
	HarnessPi AgentHarness = "pi"
	// HarnessFake is retained for existing test fixtures and historical session
	// rows, but is not user-selectable.
	HarnessFake AgentHarness = "fake"
)

// AllHarnesses lists every supported harness. It is the canonical set used to
// validate user-supplied harness names (e.g. per-project role overrides).
var AllHarnesses = []AgentHarness{
	HarnessPi,
}

// IsKnown reports whether h is one of the supported harnesses.
func (h AgentHarness) IsKnown() bool {
	for _, k := range AllHarnesses {
		if h == k {
			return true
		}
	}
	return false
}

// Normalize resolves a stored harness value under the ADR 0005
// store-and-ignore rule: pi is the only harness that can launch, so any other
// non-empty value (e.g. a legacy "claude-code" in project config or a spawn
// request) resolves to pi while the stored value is preserved unchanged.
// HarnessFake passes through for test wiring.
func (h AgentHarness) Normalize() AgentHarness {
	if h == HarnessPi || h == HarnessFake || h == "" {
		// Empty stays empty: it means "no override; resolve from config".
		return h
	}
	return HarnessPi
}
