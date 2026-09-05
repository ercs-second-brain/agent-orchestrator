package domain

import (
	"errors"
	"time"
)

// UsageSourceKind identifies the native artifact shape that produced usage
// facts. It is deliberately narrower than AgentHarness: only certified usage
// sources get persisted in the V1 usage pipeline.
type UsageSourceKind string

// UsageSourceKind values identify certified native usage artifact shapes.
const (
	UsageSourceClaudeMain     UsageSourceKind = "claude_main"
	UsageSourceClaudeSubagent UsageSourceKind = "claude_subagent"
	UsageSourceCodexRollout   UsageSourceKind = "codex_rollout"
	UsageSourceKimiWire       UsageSourceKind = "kimi_wire"
)

// UsageBindingState tracks the root native-session binding lifecycle.
type UsageBindingState string

// UsageBindingState values describe root native-session binding lifecycle.
const (
	UsageBindingDiscovering UsageBindingState = "discovering"
	UsageBindingActive      UsageBindingState = "active"
	UsageBindingFinalizing  UsageBindingState = "finalizing"
	UsageBindingComplete    UsageBindingState = "complete"
	UsageBindingPartial     UsageBindingState = "partial"
)

// UsageSourceState tracks one physical JSONL artifact generation.
type UsageSourceState string

// UsageSourceState values describe one physical source artifact lifecycle.
const (
	UsageSourcePending  UsageSourceState = "pending"
	UsageSourceActive   UsageSourceState = "active"
	UsageSourceComplete UsageSourceState = "complete"
	UsageSourceError    UsageSourceState = "error"
)

// Usage error code constants are safe storage/display identifiers for
// transcript discovery and ingestion failures.
const (
	UsageErrorSourceDiscoveryPending      = "source_discovery_pending"
	UsageErrorArtifactPathRejected        = "artifact_path_rejected"
	UsageErrorArtifactMissing             = "artifact_missing"
	UsageErrorArtifactReplaced            = "artifact_replaced"
	UsageErrorSourceReadFailed            = "source_read_failed"
	UsageErrorRecordTooLarge              = "record_too_large"
	UsageErrorMalformedJSONL              = "malformed_jsonl"
	UsageErrorUnsupportedSourceFormat     = "unsupported_source_format"
	UsageErrorSourceEventConflict         = "source_event_conflict"
	UsageErrorNonMonotonicCumulativeUsage = "non_monotonic_cumulative_usage"
	UsageErrorInvalidParserState          = "invalid_parser_state"
	UsageErrorUnresolvedSpawnCall         = "unresolved_spawn_call"
	UsageErrorCodexSourceBudgetExceeded   = "codex_source_budget_exceeded"
)

// Usage ingestion sentinel errors report replay and cursor conflicts.
var (
	ErrUsageSourceOffsetConflict   = errors.New("usage source cursor offset conflict")
	ErrUsageSourceRevisionConflict = errors.New("usage source revision conflict")
	ErrUsageSourceEventConflict    = errors.New("usage source event conflict")
)

// UsageBindingRecord binds one AO session to one native root session/thread.
type UsageBindingRecord struct {
	ID             int64
	SessionID      SessionID
	Harness        AgentHarness
	NativeRootID   string
	InitialModelID string
	ProviderHint   string
	State          UsageBindingState
	LastErrorCode  string
	UpdatedAt      time.Time
}

// UsageSourceRecord tracks one physical JSONL artifact generation and its
// durable read cursor.
type UsageSourceRecord struct {
	ID              int64
	BindingID       int64
	Kind            UsageSourceKind
	NativeSessionID string
	SubagentID      string
	ArtifactPath    string
	FileIdentity    string
	Generation      int64
	ByteOffset      int64
	ParserStateJSON string
	State           UsageSourceState
	FailureCount    int64
	AnomalyCount    int64
	NextRetryAt     *time.Time
	LastErrorCode   string
	UpdatedAt       time.Time
}

// UsageSourceContext is the source row plus immutable binding/session facts the
// ingestor needs while normalizing parser output.
type UsageSourceContext struct {
	Source         UsageSourceRecord
	SessionID      SessionID
	NativeRootID   string
	InitialModelID string
	ProviderHint   string
	BindingState   UsageBindingState
}

// UsageProviderID identifies the provider vocabulary normalized into a usage
// event. Provider-specific counters remain separate from the canonical totals.
type UsageProviderID string

// Usage provider identifiers.
const (
	UsageProviderOpenAI    UsageProviderID = "openai"
	UsageProviderAnthropic UsageProviderID = "anthropic"
)

// UsageMeasurementKind describes the trust source for a complete usage event.
// It replaces per-metric provenance: the nullable counters already say which
// metrics are known, so the only remaining question is where they came from.
type UsageMeasurementKind string

// Usage measurement kinds.
const (
	// UsageMeasurementNativeReported means the counters came from a native
	// provider or CLI usage record. Exact arithmetic over native counters —
	// subtracting Codex cumulative totals, summing Claude cache buckets — does
	// not make an event estimated.
	UsageMeasurementNativeReported UsageMeasurementKind = "native_reported"
	// UsageMeasurementAOEstimated means AO approximated counters without native ones.
	UsageMeasurementAOEstimated UsageMeasurementKind = "ao_estimated"
	// UsageMeasurementMixed means native counters and AO estimates were combined.
	UsageMeasurementMixed UsageMeasurementKind = "mixed"
	// UsageMeasurementUnknown means the origin cannot be established.
	UsageMeasurementUnknown UsageMeasurementKind = "unknown"
)

// UsageTokenMetrics is the provider-neutral token vector stored on every usage
// event. Nil means unknown; a non-nil zero is a known zero. Cache writes are
// part of uncached input here; their provider-specific split stays in the
// bounded provider usage object.
type UsageTokenMetrics struct {
	InputTokens         *int64
	CachedInputTokens   *int64
	UncachedInputTokens *int64
	OutputTokens        *int64
}

// ModelUsageEvent is one append-only normalized usage fact.
//
// ProviderID identifies the provider vocabulary into which token counters were
// normalized.
//
// ProviderUsageJSON is the bounded usage object the CLI emitted, stored
// verbatim so optional and future provider fields survive. It is empty when the
// event predates the capture or the object exceeded its size bound.
type ModelUsageEvent struct {
	ProviderID        UsageProviderID
	ModelID           string
	MeasurementKind   UsageMeasurementKind
	Tokens            UsageTokenMetrics
	ProviderUsageJSON string
	CreatedAt         time.Time
	SourceEventKey    string
}

// UsageModelAggregate is the raw model-level aggregate read from storage.
type UsageModelAggregate struct {
	Harness AgentHarness
	ModelID string
	Tokens  UsageTokenMetrics
}

// CompactSessionUsageAggregate is one batched storage row before checked token
// derivation.
type CompactSessionUsageAggregate struct {
	SessionID       SessionID
	ProcessedTokens *int64
	Incomplete      bool
}

// CompactSessionUsage is the dashboard usage read model.
type CompactSessionUsage struct {
	SessionID       SessionID
	ProcessedTokens *int64
	Incomplete      bool
}

// UsageMetricTotals is the aggregate metric block used by session, harness,
// and model summaries.
type UsageMetricTotals struct {
	InputTokens         *int64
	CachedInputTokens   *int64
	UncachedInputTokens *int64
	OutputTokens        *int64
	ProcessedTokens     *int64
}

// ModelUsageSummary is a per-model aggregate.
type ModelUsageSummary struct {
	ModelID string
	Totals  UsageMetricTotals
}

// HarnessUsageSummary groups model summaries by AO harness.
type HarnessUsageSummary struct {
	Harness AgentHarness
	Totals  UsageMetricTotals
	Models  []ModelUsageSummary
}

// SessionUsageSummary is the read model returned by the session usage service.
type SessionUsageSummary struct {
	SessionID  SessionID
	Incomplete bool
	Totals     UsageMetricTotals
	Harnesses  []HarnessUsageSummary
}

// SourceCursorState is the durable source state to commit after parsing a
// chunk. ApplyUsageChunk writes it atomically with the emitted events.
type SourceCursorState struct {
	ByteOffset      int64
	State           UsageSourceState
	ParserStateJSON string
	FailureCount    int64
	AnomalyCount    int64
	NextRetryAt     *time.Time
	LastErrorCode   string
	UpdatedAt       time.Time
}
