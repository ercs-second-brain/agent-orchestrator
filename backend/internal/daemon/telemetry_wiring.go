package daemon

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	telemetryadapter "github.com/ercs-second-brain/agent-orchestrator/backend/internal/adapters/telemetry"
	"github.com/ercs-second-brain/agent-orchestrator/backend/internal/config"
	agentswitchobs "github.com/ercs-second-brain/agent-orchestrator/backend/internal/observe/agentswitch"
	"github.com/ercs-second-brain/agent-orchestrator/backend/internal/ports"
	"github.com/ercs-second-brain/agent-orchestrator/backend/internal/storage/sqlite"
)

func newAgentSwitchFailureDispatcher(
	store ports.AgentSwitchFailureOutboxStore,
	policy agentswitchobs.PolicyCoordinator,
	observer ports.AgentSwitchFailureObserver,
	log *slog.Logger,
) (*agentswitchobs.Dispatcher, error) {
	if observer == nil {
		backlog, err := store.AgentSwitchFailureBacklog(context.Background(), time.Now().UTC())
		if err != nil {
			return nil, fmt.Errorf("inspect agent switch failure backlog: %w", err)
		}
		if policy.Authorization().Enabled || backlog.Pending != 0 || backlog.Leased != 0 {
			return nil, errors.New("agent switch failure observer unavailable with enabled policy or pending payload")
		}
		return nil, nil
	}
	return agentswitchobs.NewDispatcher(agentswitchobs.DispatcherConfig{
		Store: store, Observer: observer, Policy: policy, Logger: log,
	})
}

func newTelemetrySink(cfg config.Config, store *sqlite.Store, log *slog.Logger) ports.EventSink {
	if !cfg.Telemetry.Events {
		return telemetryadapter.NoopSink{}
	}
	return telemetryadapter.NewLocalSQLiteSink(store, log)
}
