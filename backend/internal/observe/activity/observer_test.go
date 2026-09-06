package activity

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	agentfake "github.com/ercs-second-brain/agent-orchestrator/backend/internal/adapters/agent/fake"
	"github.com/ercs-second-brain/agent-orchestrator/backend/internal/domain"
	"github.com/ercs-second-brain/agent-orchestrator/backend/internal/ports"
)

type fakeSessions struct {
	rows []domain.SessionRecord
	err  error
}

func (f fakeSessions) ListAllSessions(context.Context) ([]domain.SessionRecord, error) {
	return f.rows, f.err
}

type fakeSink struct {
	id      domain.SessionID
	signals []ports.ActivitySignal
}

func (f *fakeSink) ApplyActivitySignal(_ context.Context, id domain.SessionID, signal ports.ActivitySignal) error {
	f.id = id
	f.signals = append(f.signals, signal)
	return nil
}

type fakeRuntime struct {
	calls  int
	output string
	err    error
}

func (f *fakeRuntime) GetOutput(context.Context, ports.RuntimeHandle, int) (string, error) {
	f.calls++
	return f.output, f.err
}

type fakeAgents map[domain.AgentHarness]ports.Agent

func (f fakeAgents) Agent(harness domain.AgentHarness) (ports.Agent, bool) {
	agent, ok := f[harness]
	return agent, ok
}

// markerDetectorAgent is the minimal adapter surface the reconciliation path
// consults: an authoritative idle marker over raw terminal output.
type markerDetectorAgent struct {
	agentfake.Plugin
	idle string
}

func (m markerDetectorAgent) DetectTerminalActivity(output string) (domain.ActivityState, bool) {
	if output == m.idle {
		return domain.ActivityIdle, true
	}
	return "", false
}

func activeSession(now time.Time, harness domain.AgentHarness) domain.SessionRecord {
	return domain.SessionRecord{
		ID:        "ao-1",
		Harness:   harness,
		Activity:  domain.Activity{State: domain.ActivityActive, LastActivityAt: now.Add(-3 * time.Minute)},
		UpdatedAt: now.Add(-3 * time.Minute),
		Metadata: domain.SessionMetadata{
			RuntimeHandleID: "ao-1",
			RuntimeLaunchID: "launch-1",
		},
	}
}

func testLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func TestPollReconcilesStaleActiveFromIdleMarker(t *testing.T) {
	now := time.Unix(500, 0).UTC()
	sink := &fakeSink{}
	idleScreen := "› prompt\nmodel · ~/project\n"
	runtime := &fakeRuntime{output: idleScreen}
	observer := New(
		fakeSessions{rows: []domain.SessionRecord{activeSession(now, domain.HarnessPi)}},
		sink,
		runtime,
		fakeAgents{domain.HarnessPi: &markerDetectorAgent{idle: idleScreen}},
		Config{Clock: func() time.Time { return now }, Logger: testLogger()},
	)

	if err := observer.Poll(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(sink.signals) != 1 || sink.signals[0].State != domain.ActivityIdle {
		t.Fatalf("signals = %+v, want a single idle reconciliation", sink.signals)
	}
}

func TestPollLeavesSessionsWithoutDetectorUntouched(t *testing.T) {
	now := time.Unix(500, 0).UTC()
	sink := &fakeSink{}
	runtime := &fakeRuntime{output: "› prompt\nmodel · ~/project\n"}
	observer := New(
		fakeSessions{rows: []domain.SessionRecord{activeSession(now, domain.HarnessFake)}},
		sink,
		runtime,
		fakeAgents{},
		Config{Clock: func() time.Time { return now }, Logger: testLogger()},
	)

	if err := observer.Poll(context.Background()); err != nil {
		t.Fatal(err)
	}
	if runtime.calls != 0 || len(sink.signals) != 0 {
		t.Fatalf("unaffected harness: output calls=%d signals=%+v", runtime.calls, sink.signals)
	}
}

func TestPollSkipsFreshActiveAndOutputFailures(t *testing.T) {
	now := time.Unix(500, 0).UTC()
	fresh := activeSession(now, domain.HarnessPi)
	fresh.Activity.LastActivityAt = now.Add(-time.Minute)
	runtime := &fakeRuntime{err: errors.New("capture failed")}
	observer := New(
		fakeSessions{rows: []domain.SessionRecord{fresh}},
		&fakeSink{},
		runtime,
		fakeAgents{domain.HarnessPi: &markerDetectorAgent{}},
		Config{Clock: func() time.Time { return now }, Logger: testLogger()},
	)
	if err := observer.Poll(context.Background()); err != nil {
		t.Fatal(err)
	}
	if runtime.calls != 0 {
		t.Fatalf("fresh session output calls = %d, want 0", runtime.calls)
	}

	stale := activeSession(now, domain.HarnessPi)
	observer.sessions = fakeSessions{rows: []domain.SessionRecord{stale}}
	if err := observer.Poll(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestPollReturnsSessionListFailure(t *testing.T) {
	want := errors.New("list failed")
	observer := New(fakeSessions{err: want}, &fakeSink{}, &fakeRuntime{}, nil, Config{Logger: testLogger()})
	if err := observer.Poll(context.Background()); !errors.Is(err, want) {
		t.Fatalf("error = %v, want %v", err, want)
	}
}
