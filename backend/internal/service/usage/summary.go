package usage

import (
	"context"
	"fmt"
	"strings"

	"github.com/aoagents/agent-orchestrator/backend/internal/domain"
	"github.com/aoagents/agent-orchestrator/backend/internal/httpd/apierr"
)

type usageSummaryStore interface {
	GetSession(context.Context, domain.SessionID) (domain.SessionRecord, bool, error)
	ListCompactSessionUsageAggregates(context.Context, domain.ProjectID) ([]domain.CompactSessionUsageAggregate, error)
	ListUsageModelAggregates(context.Context, domain.SessionID) ([]domain.UsageModelAggregate, error)
	GetUsageSessionIncomplete(context.Context, domain.SessionID) (bool, error)
}

// SummaryReader derives token summaries from normalized usage events.
type SummaryReader struct{ store usageSummaryStore }

// NewSummaryReader constructs a usage summary reader.
func NewSummaryReader(store usageSummaryStore) *SummaryReader { return &SummaryReader{store: store} }

// ListCompact returns one batch suitable for dashboard cards.
func (r *SummaryReader) ListCompact(ctx context.Context, projectID domain.ProjectID) ([]domain.CompactSessionUsage, error) {
	if r == nil || r.store == nil {
		return nil, fmt.Errorf("usage summary store is unavailable")
	}
	rows, err := r.store.ListCompactSessionUsageAggregates(ctx, projectID)
	if err != nil {
		return nil, err
	}
	out := make([]domain.CompactSessionUsage, 0, len(rows))
	for _, row := range rows {
		out = append(out, domain.CompactSessionUsage(row))
	}
	return out, nil
}

// Get returns detailed token telemetry for one session.
func (r *SummaryReader) Get(ctx context.Context, sessionID domain.SessionID) (domain.SessionUsageSummary, error) {
	if r == nil || r.store == nil {
		return domain.SessionUsageSummary{}, fmt.Errorf("usage summary store is unavailable")
	}
	if _, ok, err := r.store.GetSession(ctx, sessionID); err != nil {
		return domain.SessionUsageSummary{}, err
	} else if !ok {
		return domain.SessionUsageSummary{}, apierr.NotFound("SESSION_NOT_FOUND", "Unknown session")
	}

	models, err := r.store.ListUsageModelAggregates(ctx, sessionID)
	if err != nil {
		return domain.SessionUsageSummary{}, err
	}
	visibleModels := make([]domain.UsageModelAggregate, 0, len(models))
	for _, model := range models {
		if strings.EqualFold(strings.TrimSpace(model.ModelID), "<synthetic>") {
			continue
		}
		visibleModels = append(visibleModels, model)
	}
	models = visibleModels
	incomplete, err := r.store.GetUsageSessionIncomplete(ctx, sessionID)
	if err != nil {
		return domain.SessionUsageSummary{}, err
	}
	totals := usageTotals(models)
	harnesses := harnessUsageSummaries(models)
	return domain.SessionUsageSummary{
		SessionID: sessionID, Incomplete: incomplete, Totals: totals, Harnesses: harnesses,
	}, nil
}

func usageTotals(models []domain.UsageModelAggregate) domain.UsageMetricTotals {
	if len(models) == 0 {
		return domain.UsageMetricTotals{}
	}
	input := aggregateMetric(models, func(model domain.UsageModelAggregate) *int64 { return model.Tokens.InputTokens })
	output := aggregateMetric(models, func(model domain.UsageModelAggregate) *int64 { return model.Tokens.OutputTokens })
	totals := domain.UsageMetricTotals{
		InputTokens:       input,
		CachedInputTokens: aggregateMetric(models, func(model domain.UsageModelAggregate) *int64 { return model.Tokens.CachedInputTokens }),
		UncachedInputTokens: aggregateMetric(models, func(model domain.UsageModelAggregate) *int64 {
			return model.Tokens.UncachedInputTokens
		}),
		OutputTokens: output,
	}
	if input != nil && output != nil {
		processed := *input + *output
		totals.ProcessedTokens = &processed
	}
	return totals
}

// aggregateMetric sums one metric across models. One uncollected counter makes
// the whole sum unknown rather than silently under-reporting it.
func aggregateMetric(models []domain.UsageModelAggregate, selectMetric func(domain.UsageModelAggregate) *int64) *int64 {
	var total int64
	for _, model := range models {
		value := selectMetric(model)
		if value == nil {
			return nil
		}
		total += *value
	}
	return &total
}

func harnessUsageSummaries(models []domain.UsageModelAggregate) []domain.HarnessUsageSummary {
	order := make([]domain.AgentHarness, 0)
	grouped := make(map[domain.AgentHarness][]domain.UsageModelAggregate)
	for _, model := range models {
		if _, ok := grouped[model.Harness]; !ok {
			order = append(order, model.Harness)
		}
		grouped[model.Harness] = append(grouped[model.Harness], model)
	}
	out := make([]domain.HarnessUsageSummary, 0, len(order))
	for _, harness := range order {
		rows := grouped[harness]
		summary := domain.HarnessUsageSummary{Harness: harness, Totals: usageTotals(rows)}
		for _, row := range rows {
			summary.Models = append(summary.Models, domain.ModelUsageSummary{
				ModelID: row.ModelID, Totals: usageTotals([]domain.UsageModelAggregate{row}),
			})
		}
		out = append(out, summary)
	}
	return out
}
