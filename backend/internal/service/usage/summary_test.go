package usage

import (
	"context"
	"testing"

	"github.com/aoagents/agent-orchestrator/backend/internal/domain"
)

type usageSummaryStoreStub struct {
	projectID  domain.ProjectID
	rows       []domain.CompactSessionUsageAggregate
	session    domain.SessionRecord
	found      bool
	incomplete bool
	models     []domain.UsageModelAggregate
	calls      [4]int
}

func (s *usageSummaryStoreStub) ListCompactSessionUsageAggregates(_ context.Context, id domain.ProjectID) ([]domain.CompactSessionUsageAggregate, error) {
	s.projectID, s.calls[0] = id, s.calls[0]+1
	return s.rows, nil
}
func (s *usageSummaryStoreStub) GetSession(context.Context, domain.SessionID) (domain.SessionRecord, bool, error) {
	s.calls[1]++
	return s.session, s.found, nil
}
func (s *usageSummaryStoreStub) ListUsageModelAggregates(context.Context, domain.SessionID) ([]domain.UsageModelAggregate, error) {
	s.calls[2]++
	return s.models, nil
}
func (s *usageSummaryStoreStub) GetUsageSessionIncomplete(context.Context, domain.SessionID) (bool, error) {
	s.calls[3]++
	return s.incomplete, nil
}

func TestSummaryReaderListCompactUsesOneBatchRead(t *testing.T) {
	zeroProcessed, partialProcessed := int64(0), int64(120)
	store := &usageSummaryStoreStub{rows: []domain.CompactSessionUsageAggregate{
		{SessionID: "zero", ProcessedTokens: &zeroProcessed},
		{SessionID: "partial", ProcessedTokens: &partialProcessed, Incomplete: true},
	}}

	got, err := NewSummaryReader(store).ListCompact(context.Background(), "reverb")
	mustNoError(t, err)
	if store.calls[0] != 1 || store.projectID != "reverb" || len(got) != 2 {
		t.Fatalf("read=%d project=%q items=%+v", store.calls[0], store.projectID, got)
	}
	if got[0].ProcessedTokens == nil || *got[0].ProcessedTokens != 0 {
		t.Fatalf("zero compact summary = %+v", got[0])
	}
	if got[1].ProcessedTokens == nil || *got[1].ProcessedTokens != 120 || !got[1].Incomplete {
		t.Fatalf("partial compact summary = %+v", got[1])
	}
}

func TestSummaryReaderGetPreservesStrongestPartialLowerBoundWithoutDoubleCounting(t *testing.T) {
	store := &usageSummaryStoreStub{
		found:      true,
		incomplete: true,
		session:    domain.SessionRecord{ID: "reverb-12", Harness: domain.HarnessCodex},
		models: []domain.UsageModelAggregate{
			{
				Harness: domain.HarnessClaudeCode, ModelID: "<synthetic>",
				Tokens: testUsageMetrics(0, 0, 0, 0),
			},
			{
				Harness: domain.HarnessCodex, ModelID: "gpt-5.6",
				Tokens: testUsageMetrics(1000, 400, 600, 200),
			},
			{
				Harness: domain.HarnessClaudeCode, ModelID: "claude-sonnet",
				Tokens: testUsageMetrics(100, 20, 80, 25),
			},
		},
	}

	got, err := NewSummaryReader(store).Get(context.Background(), "reverb-12")
	mustNoError(t, err)
	if !got.Incomplete {
		t.Fatal("token integrity failure was not preserved")
	}
	if got.Totals.InputTokens == nil || *got.Totals.InputTokens != 1100 ||
		got.Totals.OutputTokens == nil || *got.Totals.OutputTokens != 225 ||
		got.Totals.ProcessedTokens == nil || *got.Totals.ProcessedTokens != 1325 {
		t.Fatalf("totals = %+v", got.Totals)
	}
	if len(got.Harnesses) != 2 || len(got.Harnesses[0].Models) != 1 || len(got.Harnesses[1].Models) != 1 ||
		got.Harnesses[0].Models[0].ModelID != "gpt-5.6" ||
		got.Harnesses[1].Models[0].ModelID != "claude-sonnet" {
		t.Fatalf("model grouping = %+v", got.Harnesses)
	}
	for _, harness := range got.Harnesses {
		for _, model := range harness.Models {
			if model.ModelID == "<synthetic>" {
				t.Fatalf("synthetic model leaked into summary: %+v", got.Harnesses)
			}
		}
	}
	if got.Harnesses[0].Totals.ProcessedTokens == nil || *got.Harnesses[0].Totals.ProcessedTokens != 1200 ||
		got.Harnesses[0].Models[0].Totals.ProcessedTokens == nil || *got.Harnesses[0].Models[0].Totals.ProcessedTokens != 1200 ||
		got.Harnesses[1].Totals.ProcessedTokens == nil || *got.Harnesses[1].Totals.ProcessedTokens != 125 {
		t.Fatalf("processed totals by scope = %+v", got.Harnesses)
	}
	if store.calls != [4]int{0, 1, 1, 1} {
		t.Fatalf("store calls = %v", store.calls)
	}
}

// Break caught: inferred prices were aggregated into the same dollar value as
// observed prices without preserving the distinction the UI needs to explain
// that the billing provider has not been confirmed.

func testUsageMetrics(input, cachedInput, uncachedInput, output int64) domain.UsageTokenMetrics {
	return domain.UsageTokenMetrics{
		InputTokens: &input, CachedInputTokens: &cachedInput, UncachedInputTokens: &uncachedInput,
		OutputTokens: &output,
	}
}

func TestSummaryReaderGetReturnsUnavailableMetricsWithoutEvents(t *testing.T) {
	store := &usageSummaryStoreStub{found: true, session: domain.SessionRecord{ID: "empty"}}
	got, err := NewSummaryReader(store).Get(context.Background(), "empty")
	mustNoError(t, err)
	if got.Totals.InputTokens != nil || got.Totals.OutputTokens != nil ||
		got.Totals.ProcessedTokens != nil || len(got.Harnesses) != 0 {
		t.Fatalf("empty usage = %+v", got)
	}
}
