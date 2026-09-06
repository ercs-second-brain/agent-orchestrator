package domain

// ReviewerHarness identifies a code-review agent. It is a separate vocabulary
// from AgentHarness on purpose: a reviewer is still a distinct role from a
// worker. Since ADR 0005 pi is the single supported harness.
type ReviewerHarness string

// Supported reviewer harnesses.
const (
	ReviewerPi ReviewerHarness = "pi"
)

// AllReviewerHarnesses is the canonical set used to validate a configured
// reviewer harness.
var AllReviewerHarnesses = []ReviewerHarness{
	ReviewerPi,
}

// IsKnown reports whether h is one of the supported reviewer harnesses.
func (h ReviewerHarness) IsKnown() bool {
	for _, k := range AllReviewerHarnesses {
		if h == k {
			return true
		}
	}
	return false
}

// Normalize resolves a stored reviewer harness value under the ADR 0005
// store-and-ignore rule: pi is the only supported reviewer, so any other
// stored value resolves to pi.
func (h ReviewerHarness) Normalize() ReviewerHarness {
	if h == "" {
		return h
	}
	return ReviewerPi
}
