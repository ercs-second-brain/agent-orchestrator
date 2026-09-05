package sessionmanager

import (
	"context"
	"time"

	"github.com/ercs-second-brain/agent-orchestrator/backend/internal/ports"
)

const idleTerminalOutput = "idle"

type untouchedEmptyTransitionAgent struct {
	fakeAgent
}

func (untouchedEmptyTransitionAgent) NativeConversationExists(context.Context, ports.SessionRef, string, map[string]string) (bool, error) {
	return false, nil
}

func (untouchedEmptyTransitionAgent) InspectTerminalSurface(string) ports.TerminalSurfaceObservation {
	return ports.TerminalSurfaceObservation{
		Work: ports.TerminalSurfaceWorkIdle, Composer: ports.TerminalComposerEmpty,
		NativeConversationNotStarted: true,
	}
}

type transitionRuntime struct {
	*fakeRuntime
	log               *[]string
	outputForCall     func(int) string
	outputCallTimes   []time.Time
	styledOutputCalls int
	styledOutputErr   error
}

func (r *transitionRuntime) GetStyledOutput(ctx context.Context, handle ports.RuntimeHandle, lines int) (string, error) {
	r.outputCallTimes = append(r.outputCallTimes, time.Now())
	r.styledOutputCalls++
	if r.styledOutputErr != nil {
		return "", r.styledOutputErr
	}
	if r.outputForCall == nil {
		return r.fakeRuntime.GetOutput(ctx, handle, lines)
	}
	r.outputCalls++
	return r.outputForCall(r.outputCalls), nil
}

type transitionInputGate struct {
	acquired    chan string
	released    chan string
	lastInputAt time.Time
}

func (g *transitionInputGate) BeginInputDrain(terminalID string) (time.Time, func()) {
	g.acquired <- terminalID
	return g.lastInputAt, func() { g.released <- terminalID }
}
