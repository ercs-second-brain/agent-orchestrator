package daemon

import (
	"log/slog"

	telemetryadapter "github.com/ercs-second-brain/agent-orchestrator/backend/internal/adapters/telemetry"
	"github.com/ercs-second-brain/agent-orchestrator/backend/internal/config"
	"github.com/ercs-second-brain/agent-orchestrator/backend/internal/ports"
	"github.com/ercs-second-brain/agent-orchestrator/backend/internal/storage/sqlite"
)

func newTelemetrySink(cfg config.Config, store *sqlite.Store, log *slog.Logger) ports.EventSink {
	if !cfg.Telemetry.Events {
		return telemetryadapter.NoopSink{}
	}
	return telemetryadapter.NewLocalSQLiteSink(store, log)
}
