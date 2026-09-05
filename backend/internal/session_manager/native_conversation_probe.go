package sessionmanager

import (
	"context"
	"strings"
	"time"

	"github.com/ercs-second-brain/agent-orchestrator/backend/internal/domain"
	"github.com/ercs-second-brain/agent-orchestrator/backend/internal/ports"
)

const (
	// interfaceInterruptSettle bounds the terminal-surface probe used to prove a
	// fresh Codex session has not started a native conversation yet.
	interfaceInterruptSettle = 2 * time.Second
	// interfaceProbeOutputLines bounds how much styled terminal output the probe
	// reads for native-conversation detection.
	interfaceProbeOutputLines = 40
)

func (m *Manager) nativeConversationNotStarted(
	ctx context.Context,
	rec domain.SessionRecord,
	agent ports.Agent,
) bool {
	if domain.NormalizeSessionMode(rec.Mode) != domain.SessionModeTUI ||
		rec.Metadata.LatestUserPrompt != "" ||
		rec.Metadata.LatestAssistantUpdate != "" ||
		rec.Metadata.NativeTranscriptPath != "" {
		return false
	}
	if _, ok := agent.(ports.AgentInterfaceHandoffHistoryProbe); !ok {
		return false
	}
	return m.terminalProvesNativeConversationNotStarted(ctx, rec, agent)
}

func (m *Manager) terminalProvesNativeConversationNotStarted(
	ctx context.Context,
	rec domain.SessionRecord,
	agent ports.Agent,
) bool {
	inspector, ok := agent.(ports.TerminalSurfaceInspector)
	if !ok {
		return false
	}
	styled, ok := m.runtime.(ports.StyledTerminalOutputReader)
	if !ok || strings.TrimSpace(rec.Metadata.RuntimeHandleID) == "" {
		return false
	}
	probeCtx, cancel := context.WithTimeout(ctx, interfaceInterruptSettle)
	defer cancel()
	output, err := styled.GetStyledOutput(
		probeCtx,
		ports.RuntimeHandle{ID: rec.Metadata.RuntimeHandleID},
		interfaceProbeOutputLines,
	)
	if err != nil {
		return false
	}
	return inspector.InspectTerminalSurface(output).NativeConversationNotStarted
}
