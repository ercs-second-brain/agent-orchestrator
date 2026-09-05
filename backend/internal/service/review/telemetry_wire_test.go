package review

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ercs-second-brain/agent-orchestrator/backend/internal/domain"
	"github.com/ercs-second-brain/agent-orchestrator/backend/internal/ports"
	reviewcore "github.com/ercs-second-brain/agent-orchestrator/backend/internal/review"
)

// captured is one telemetry event as the review service emitted it.
type captured struct {
	event string
	props map[string]any
}

type wireRecorder struct {
	mu     sync.Mutex
	events []captured
}

func (r *wireRecorder) Emit(_ context.Context, ev ports.TelemetryEvent) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.events = append(r.events, captured{event: ev.Name, props: ev.Payload})
}

func (r *wireRecorder) Close(context.Context) error { return nil }

func (r *wireRecorder) find(name string) (captured, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, ev := range r.events {
		if ev.event == name {
			return ev, true
		}
	}
	return captured{}, false
}

func (r *wireRecorder) names() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]string, 0, len(r.events))
	for _, ev := range r.events {
		out = append(out, ev.event)
	}
	return out
}

// newWireSink hands the review service a recording sink so a test can assert
// exactly what an emit site handed to telemetry rather than trusting the
// emit-site call alone.
func newWireSink(t *testing.T) (ports.EventSink, *wireRecorder, func()) {
	t.Helper()
	rec := &wireRecorder{}
	return rec, rec, func() {}
}

// End to end: the review service's real emit sites into a recording sink.
// Every assertion here is one a call-site review cannot make on its own,
// because nothing ties an emit site's payload keys to what the test expects.
func TestReviewFunnelReachesTheWireWithItsProperties(t *testing.T) {
	sink, rec, closeSink := newWireSink(t)

	created := time.Date(2026, 8, 4, 10, 0, 0, 0, time.UTC)
	store := &fakeStore{
		ok: true,
		run: domain.ReviewRun{
			ID: "run-1", SessionID: "worker-1", Status: domain.ReviewRunRunning,
			Harness: "claude-code", TriggerSource: domain.ReviewTriggerAuto, CreatedAt: created,
			PRURL: "https://github.com/acme/secret-repo/pull/7", TargetSHA: "deadbeefcafe",
		},
	}
	svc := New(nil, store,
		WithTelemetry(sink),
		WithClock(func() time.Time { return created.Add(90 * time.Second) }),
	)
	svc.engineTrigger = func(
		_ context.Context, _ domain.SessionID, _ domain.ReviewerHarness, _ domain.AgentConfig, _ domain.ReviewTriggerSource,
	) (reviewcore.TriggerResult, error) {
		return reviewcore.TriggerResult{
			Run:         domain.ReviewRun{Harness: "claude-code"},
			CreatedRuns: []domain.ReviewRun{{ID: "run-1"}},
		}, nil
	}

	if _, err := svc.TriggerAuto(context.Background(), "worker-1", "claude-code"); err != nil {
		t.Fatalf("TriggerAuto: %v", err)
	}
	reviewBody := "rename the credential loader in src/config/prod.ts"
	if _, err := svc.Submit(context.Background(), "worker-1", "run-1",
		domain.VerdictChangesRequested, reviewBody, "gh-review-42"); err != nil {
		t.Fatalf("Submit: %v", err)
	}
	closeSink()

	triggered, ok := rec.find("ao.review.triggered")
	if !ok {
		t.Fatalf("ao.review.triggered never reached the wire; got %v", rec.names())
	}
	if triggered.props["trigger"] != "auto" {
		t.Fatalf("triggered.trigger = %#v, want auto (missing allowlist entry strips it silently)", triggered.props["trigger"])
	}
	if triggered.props["harness"] != "claude-code" {
		t.Fatalf("triggered.harness = %#v, want claude-code", triggered.props["harness"])
	}

	submitted, ok := rec.find("ao.review.submitted")
	if !ok {
		t.Fatalf("ao.review.submitted never reached the wire; got %v", rec.names())
	}
	for key, want := range map[string]any{
		"verdict":            "changes_requested",
		"harness":            "claude-code",
		"trigger":            "auto",
		"posted_to_provider": true,
		// Values arrive as the emit site handed them over (no JSON round trip):
		// duration_ms is an int64 millisecond count, body_bytes an int len.
		"duration_ms": int64(90_000),
		"body_bytes":  len(reviewBody),
	} {
		if got := submitted.props[key]; got != want {
			t.Errorf("submitted.%s = %#v, want %#v", key, got, want)
		}
	}

	// The review prose, the repository, and the commit must not appear anywhere
	// in what telemetry received, in any event, under any key or value.
	for _, ev := range rec.events {
		for _, value := range ev.props {
			for _, forbidden := range []string{
				reviewBody, "secret-repo", "deadbeefcafe", "prod.ts", "github.com", "gh-review-42",
			} {
				if s, ok := value.(string); ok && strings.Contains(s, forbidden) {
					t.Errorf("%s carried forbidden value %q under a payload key", ev.event, forbidden)
				}
			}
		}
	}
}
