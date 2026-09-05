package controllers

import (
	"context"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/ercs-second-brain/agent-orchestrator/backend/internal/domain"
	"github.com/ercs-second-brain/agent-orchestrator/backend/internal/httpd/apispec"
	"github.com/ercs-second-brain/agent-orchestrator/backend/internal/httpd/envelope"
	"github.com/ercs-second-brain/agent-orchestrator/backend/internal/ports"
	agentsvc "github.com/ercs-second-brain/agent-orchestrator/backend/internal/service/agent"
)

// AgentCatalog is the controller-facing contract for local agent inventory.
type AgentCatalog interface {
	CachedReadiness(ctx context.Context) (agentsvc.Readiness, error)
	EnsureReadiness(ctx context.Context, agentIDs []string, purpose domain.AgentReadinessPurpose) (agentsvc.Readiness, error)
	List(ctx context.Context) (agentsvc.Inventory, error)
	Refresh(ctx context.Context) (agentsvc.Inventory, error)
	Probe(ctx context.Context, agentID string) (agentsvc.ProbeResult, error)
	Models(ctx context.Context, agentID, projectID string, refresh bool) (ports.AgentModelCatalog, error)
	RevalidateModels(ctx context.Context, agentID, projectID string) (ports.AgentModelCatalog, error)
}

// AgentsController owns the /agents routes.
type AgentsController struct {
	Catalog AgentCatalog
}

// Register mounts the agent inventory routes on the supplied router.
func (c *AgentsController) Register(r chi.Router) {
	r.Post("/agents/readiness/ensure", c.ensureReadiness)
	r.Get("/agents/{agent}/models", c.models)
	r.Post("/agents/{agent}/models/refresh", c.refreshModels)
}

func (c *AgentsController) ensureReadiness(w http.ResponseWriter, r *http.Request) {
	if c.Catalog == nil {
		apispec.NotImplemented(w, r, "POST", "/api/v1/agents/readiness/ensure")
		return
	}
	var request EnsureAgentReadinessRequest
	if err := decodeJSONStrict(r, &request); err != nil {
		envelope.WriteAPIError(w, r, http.StatusBadRequest, "bad_request", "INVALID_JSON", "Invalid JSON body", nil)
		return
	}
	result, err := c.Catalog.EnsureReadiness(r.Context(), request.AgentIDs, request.Purpose)
	if err != nil {
		envelope.WriteError(w, r, err)
		return
	}
	envelope.WriteJSON(w, http.StatusOK, result)
}

func (c *AgentsController) models(w http.ResponseWriter, r *http.Request) {
	c.writeModels(w, r, false, false)
}

func (c *AgentsController) refreshModels(w http.ResponseWriter, r *http.Request) {
	c.writeModels(w, r, true, r.URL.Query().Get("revalidate") == "true")
}

func (c *AgentsController) writeModels(w http.ResponseWriter, r *http.Request, refresh, revalidate bool) {
	if c.Catalog == nil {
		route := "/api/v1/agents/{agent}/models"
		if refresh {
			route += "/refresh"
		}
		apispec.NotImplemented(w, r, r.Method, route)
		return
	}
	agentID := strings.TrimSpace(chi.URLParam(r, "agent"))
	if agentID == "" {
		envelope.WriteAPIError(w, r, http.StatusBadRequest, "bad_request", "AGENT_REQUIRED", "agent is required", nil)
		return
	}
	projectID := strings.TrimSpace(r.URL.Query().Get("projectId"))
	var catalog ports.AgentModelCatalog
	var err error
	if revalidate {
		catalog, err = c.Catalog.RevalidateModels(r.Context(), agentID, projectID)
	} else {
		catalog, err = c.Catalog.Models(r.Context(), agentID, projectID, refresh)
	}
	if err != nil {
		envelope.WriteError(w, r, err)
		return
	}
	envelope.WriteJSON(w, http.StatusOK, catalog)
}
