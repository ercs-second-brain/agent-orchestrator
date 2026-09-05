package controllers_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ercs-second-brain/agent-orchestrator/backend/internal/config"
	"github.com/ercs-second-brain/agent-orchestrator/backend/internal/domain"
	"github.com/ercs-second-brain/agent-orchestrator/backend/internal/httpd"
	"github.com/ercs-second-brain/agent-orchestrator/backend/internal/httpd/apierr"
	"github.com/ercs-second-brain/agent-orchestrator/backend/internal/httpd/controllers"
	"github.com/ercs-second-brain/agent-orchestrator/backend/internal/ports"
	sessionsvc "github.com/ercs-second-brain/agent-orchestrator/backend/internal/service/session"
	"github.com/ercs-second-brain/agent-orchestrator/backend/pkg/contract"
)

type fakeSessionService struct {
	sessions             map[domain.SessionID]domain.Session
	sent                 string
	sentAttachment       *ports.SpawnAttachment
	delegationInput      sessionsvc.DelegateTaskInput
	delegationErr        error
	cleanupProjects      []domain.ProjectID
	cleanupResult        []domain.SessionID
	cleanupSkipped       []sessionsvc.CleanupSkipped
	workspaceFiles       sessionsvc.WorkspaceFiles
	workspaceFile        sessionsvc.WorkspaceFileDetail
	workspaceFileSection sessionsvc.WorkspaceFileSection
	workspaceBlob        sessionsvc.WorkspaceFileBlob
	workspaceTree        sessionsvc.WorkspaceTree
	workspaceTreePath    string
	workspacePaths       []string
	spawnErr             error
	lastSpawn            ports.SpawnConfig
	orchestratorMode     domain.SessionMode
	claimErr             error
	listPRErr            error
	workspaceErr         error
	staged               []ports.SpawnAttachment
	stagedPaths          []string
	stageErr             error
	agentSwitches        map[domain.AgentSwitchID]domain.AgentSwitch
	switchConfig         sessionsvc.SwitchAgentInput
	switchErr            error
	recoveredSwitch      domain.AgentSwitchID
	handoff              json.RawMessage
	handoffSource        domain.AgentGenerationID
	autoInjectCISession  domain.SessionID
	autoInjectCIEnabled  bool
}

func newFakeSessionService() *fakeSessionService {
	now := time.Now().UTC()
	s := domain.Session{SessionRecord: domain.SessionRecord{ID: "ao-1", ProjectID: "ao", Kind: domain.KindWorker, Activity: domain.Activity{State: domain.ActivityIdle, LastActivityAt: now}, AutoInjectReview: true, AutoInjectCI: true, CreatedAt: now, UpdatedAt: now}, Status: domain.StatusIdle, TerminalHandleID: "ao-1/terminal_0"}
	return &fakeSessionService{
		sessions:      map[domain.SessionID]domain.Session{s.ID: s},
		agentSwitches: map[domain.AgentSwitchID]domain.AgentSwitch{},
	}
}

func (f *fakeSessionService) List(_ context.Context, filter sessionsvc.ListFilter) ([]domain.Session, error) {
	var out []domain.Session
	for _, s := range f.sessions {
		if filter.ProjectID != "" && s.ProjectID != filter.ProjectID {
			continue
		}
		if filter.Active != nil && s.IsTerminated == *filter.Active {
			continue
		}
		if filter.OrchestratorOnly && s.Kind != domain.KindOrchestrator {
			continue
		}
		out = append(out, s)
	}
	return out, nil
}

func (f *fakeSessionService) Spawn(_ context.Context, cfg ports.SpawnConfig) (domain.Session, int, int, error) {
	f.lastSpawn = cfg
	if f.spawnErr != nil {
		return domain.Session{}, 0, 0, f.spawnErr
	}
	now := time.Now().UTC()
	s := domain.Session{SessionRecord: domain.SessionRecord{ID: domain.SessionID(string(cfg.ProjectID) + "-2"), ProjectID: cfg.ProjectID, IssueID: cfg.IssueID, Kind: cfg.Kind, Harness: cfg.Harness, DisplayName: cfg.DisplayName, Activity: domain.Activity{State: domain.ActivityIdle, LastActivityAt: now}, AutoInjectReview: true, AutoInjectCI: true, CreatedAt: now, UpdatedAt: now}, Status: domain.StatusIdle}
	f.sessions[s.ID] = s
	return s, len(cfg.Prompt), 0, nil
}

func (f *fakeSessionService) SpawnOrchestrator(ctx context.Context, projectID domain.ProjectID, clean bool, requestedMode domain.SessionMode) (domain.Session, error) {
	f.orchestratorMode = requestedMode
	if clean {
		active := true
		existing, err := f.List(ctx, sessionsvc.ListFilter{ProjectID: projectID, Active: &active, OrchestratorOnly: true})
		if err != nil {
			return domain.Session{}, err
		}
		for _, o := range existing {
			if _, err := f.Kill(ctx, o.ID); err != nil {
				return domain.Session{}, err
			}
		}
	}
	s, _, _, err := f.Spawn(ctx, ports.SpawnConfig{ProjectID: projectID, Kind: domain.KindOrchestrator, RequestedMode: requestedMode})
	return s, err
}

func (f *fakeSessionService) Get(_ context.Context, id domain.SessionID) (domain.Session, error) {
	s, ok := f.sessions[id]
	if !ok {
		return domain.Session{}, apierr.NotFound("SESSION_NOT_FOUND", "Unknown session")
	}
	return s, nil
}

func (f *fakeSessionService) SetTerminateOnPRMerge(_ context.Context, id domain.SessionID, terminate bool) (domain.Session, error) {
	s, ok := f.sessions[id]
	if !ok {
		return domain.Session{}, apierr.NotFound("SESSION_NOT_FOUND", "Unknown session")
	}
	s.TerminateOnPRMerge = terminate
	f.sessions[id] = s
	return s, nil
}

func (f *fakeSessionService) SetAutoInjectReview(_ context.Context, id domain.SessionID, autoInject bool) (domain.Session, error) {
	s, ok := f.sessions[id]
	if !ok {
		return domain.Session{}, apierr.NotFound("SESSION_NOT_FOUND", "Unknown session")
	}
	s.AutoInjectReview = autoInject
	f.sessions[id] = s
	return s, nil
}

func (f *fakeSessionService) SetAutoInjectCI(_ context.Context, id domain.SessionID, autoInject bool) (domain.Session, error) {
	s, ok := f.sessions[id]
	if !ok {
		return domain.Session{}, apierr.NotFound("SESSION_NOT_FOUND", "Unknown session")
	}
	f.autoInjectCISession = id
	f.autoInjectCIEnabled = autoInject
	s.AutoInjectCI = autoInject
	f.sessions[id] = s
	return s, nil
}

func (f *fakeSessionService) Pin(_ context.Context, id domain.SessionID) (domain.Session, error) {
	s, ok := f.sessions[id]
	if !ok {
		return domain.Session{}, apierr.NotFound("SESSION_NOT_FOUND", "Unknown session")
	}
	s.IsPinned = true
	now := time.Now().UTC()
	s.PinnedAt = &now
	f.sessions[id] = s
	return s, nil
}

func (f *fakeSessionService) Unpin(_ context.Context, id domain.SessionID) (domain.Session, error) {
	s, ok := f.sessions[id]
	if !ok {
		return domain.Session{}, apierr.NotFound("SESSION_NOT_FOUND", "Unknown session")
	}
	s.IsPinned = false
	s.PinnedAt = nil
	f.sessions[id] = s
	return s, nil
}

func (f *fakeSessionService) SetReviewerHarness(_ context.Context, id domain.SessionID, harness domain.ReviewerHarness, config domain.AgentConfig) (domain.Session, error) {
	s, ok := f.sessions[id]
	if !ok {
		return domain.Session{}, apierr.NotFound("SESSION_NOT_FOUND", "Unknown session")
	}
	s.ReviewerHarness = harness
	s.ReviewerConfig = config
	f.sessions[id] = s
	return s, nil
}

func (f *fakeSessionService) SetAutoReview(_ context.Context, id domain.SessionID, enabled bool) (domain.Session, error) {
	s, ok := f.sessions[id]
	if !ok {
		return domain.Session{}, apierr.NotFound("SESSION_NOT_FOUND", "Unknown session")
	}
	s.AutoReviewEnabled = enabled
	f.sessions[id] = s
	return s, nil
}

func (f *fakeSessionService) Restore(_ context.Context, id domain.SessionID) (sessionsvc.RestoreOutcome, error) {
	s := f.sessions[id]
	s.IsTerminated = false
	s.Status = domain.StatusIdle
	f.sessions[id] = s
	return sessionsvc.RestoreOutcome{Session: s, Mode: sessionsvc.RestoreModeView("native")}, nil
}

func (f *fakeSessionService) ExitAgent(_ context.Context, id domain.SessionID) (sessionsvc.ExitAgentOutcome, error) {
	s := f.sessions[id]
	s.Activity.State = domain.ActivityExited
	s.Status = domain.StatusExited
	f.sessions[id] = s
	return sessionsvc.ExitAgentOutcome{Session: s}, nil
}

func (f *fakeSessionService) ResumeAgent(_ context.Context, id domain.SessionID) (sessionsvc.ResumeAgentOutcome, error) {
	s := f.sessions[id]
	s.Activity.State = domain.ActivityIdle
	s.Status = domain.StatusIdle
	f.sessions[id] = s
	return sessionsvc.ResumeAgentOutcome{Session: s, Mode: sessionsvc.RestoreModeViewNative}, nil
}

func (f *fakeSessionService) SwitchAgent(_ context.Context, id domain.SessionID, cfg sessionsvc.SwitchAgentInput) (domain.AgentSwitch, error) {
	if f.switchErr != nil {
		return domain.AgentSwitch{}, f.switchErr
	}
	if _, ok := f.sessions[id]; !ok {
		return domain.AgentSwitch{}, apierr.NotFound("SESSION_NOT_FOUND", "Unknown session")
	}
	f.switchConfig = cfg
	now := time.Now().UTC()
	targetRef := domain.AgentNativeSessionID("native-target")
	record := domain.AgentSwitch{
		ID: "switch-1", SessionID: id, IdempotencyKey: "private-retry-key", RequestFingerprint: "v1:private-fingerprint",
		FromHarness: domain.HarnessClaudeCode, TargetHarness: cfg.TargetHarness,
		TargetNativeSessionRef: &targetRef,
		TargetStartMode:        domain.AgentSwitchTargetStartFresh, State: domain.AgentSwitchPreparingHandoff,
		AgentHandoffStatus:      domain.AgentHandoffReceived,
		SemanticHandoffIncluded: true,
		AgentHandoffPath:        "/private/ao/handoff.json", AgentHandoffHash: "private-hash",
		FinalHandoffPath: "/private/ao/handoff.json", FinalHandoffHash: "private-hash",
		SourceGenerationID: "private-source-generation", TargetGenerationID: "private-target-generation",
		TargetRuntimeHandleID:  "private-target-runtime-handle",
		TargetAcknowledgedAt:   &now,
		ErrorCode:              domain.AgentSwitchErrorTargetStartUnconfirmed,
		SourceTranscriptStatus: domain.AgentSwitchSourceTranscriptUnavailable,
		RequestedAt:            now, UpdatedAt: now,
	}
	f.agentSwitches[record.ID] = record
	return record, nil
}

func (f *fakeSessionService) ListAgentSwitches(_ context.Context, id domain.SessionID) ([]domain.AgentSwitch, error) {
	if _, ok := f.sessions[id]; !ok {
		return nil, apierr.NotFound("SESSION_NOT_FOUND", "Unknown session")
	}
	out := make([]domain.AgentSwitch, 0, len(f.agentSwitches))
	for _, record := range f.agentSwitches {
		if record.SessionID == id {
			out = append(out, record)
		}
	}
	return out, nil
}

func (f *fakeSessionService) RecoverAgentSwitch(_ context.Context, id domain.SessionID, switchID domain.AgentSwitchID) (domain.AgentSwitch, error) {
	record, ok := f.agentSwitches[switchID]
	if !ok || record.SessionID != id {
		return domain.AgentSwitch{}, apierr.NotFound("AGENT_SWITCH_NOT_FOUND", "Unknown agent switch")
	}
	f.recoveredSwitch = switchID
	return record, nil
}

func (f *fakeSessionService) SubmitAgentHandoff(
	_ context.Context,
	id domain.SessionID,
	switchID domain.AgentSwitchID,
	sourceGenerationID domain.AgentGenerationID,
	handoff json.RawMessage,
) (domain.AgentSwitch, error) {
	record, ok := f.agentSwitches[switchID]
	if !ok || record.SessionID != id {
		return domain.AgentSwitch{}, apierr.NotFound("AGENT_SWITCH_NOT_FOUND", "Unknown agent switch")
	}
	f.handoffSource = sourceGenerationID
	f.handoff = append(json.RawMessage(nil), handoff...)
	record.SourceGenerationID = sourceGenerationID
	record.AgentHandoffStatus = domain.AgentHandoffReceived
	record.AgentHandoffPath = "/private/ao/agent-handoff.json"
	record.AgentHandoffHash = "private-hash"
	f.agentSwitches[switchID] = record
	return record, nil
}

func (f *fakeSessionService) Kill(_ context.Context, id domain.SessionID) (bool, error) {
	s := f.sessions[id]
	s.IsTerminated = true
	s.Status = domain.StatusTerminated
	f.sessions[id] = s
	return true, nil
}

func (f *fakeSessionService) RollbackSpawn(_ context.Context, id domain.SessionID) (sessionsvc.RollbackOutcome, error) {
	if _, ok := f.sessions[id]; ok {
		delete(f.sessions, id)
		return sessionsvc.RollbackOutcome{Deleted: true}, nil
	}
	return sessionsvc.RollbackOutcome{}, nil
}

func (f *fakeSessionService) Cleanup(_ context.Context, project domain.ProjectID) (sessionsvc.CleanupOutcome, error) {
	f.cleanupProjects = append(f.cleanupProjects, project)
	cleaned := f.cleanupResult
	if cleaned == nil {
		cleaned = []domain.SessionID{"ao-1"}
	}
	return sessionsvc.CleanupOutcome{Cleaned: cleaned, Skipped: f.cleanupSkipped}, nil
}

func (f *fakeSessionService) Rename(_ context.Context, id domain.SessionID, displayName string) error {
	s, ok := f.sessions[id]
	if !ok {
		return apierr.NotFound("SESSION_NOT_FOUND", "Unknown session")
	}
	s.DisplayName = displayName
	f.sessions[id] = s
	return nil
}

func (f *fakeSessionService) Send(_ context.Context, _ domain.SessionID, message string, attachment *ports.SpawnAttachment) error {
	f.sent = message
	f.sentAttachment = attachment
	return nil
}

func (f *fakeSessionService) DelegateTask(_ context.Context, in sessionsvc.DelegateTaskInput) (sessionsvc.DelegateTaskOutcome, error) {
	f.delegationInput = in
	if f.delegationErr != nil {
		return sessionsvc.DelegateTaskOutcome{}, f.delegationErr
	}
	return sessionsvc.DelegateTaskOutcome{WorkerID: "ao-worker", OrchestratorID: "ao-orch"}, nil
}

func (f *fakeSessionService) ListPRs(_ context.Context, id domain.SessionID) ([]domain.PRFacts, error) {
	if f.listPRErr != nil {
		return nil, f.listPRErr
	}
	if _, ok := f.sessions[id]; !ok {
		return nil, apierr.NotFound("SESSION_NOT_FOUND", "Unknown session")
	}
	return []domain.PRFacts{{URL: "https://github.com/ercs-second-brain/agent-orchestrator/pull/142", Number: 142, CI: domain.CIPassing, Review: domain.ReviewRequired, Mergeability: domain.MergeMergeable, UpdatedAt: time.Date(2026, 6, 4, 12, 0, 0, 0, time.UTC)}}, nil
}

func (f *fakeSessionService) ListPRSummaries(_ context.Context, id domain.SessionID) ([]sessionsvc.PRSummary, error) {
	if f.listPRErr != nil {
		return nil, f.listPRErr
	}
	if _, ok := f.sessions[id]; !ok {
		return nil, apierr.NotFound("SESSION_NOT_FOUND", "Unknown session")
	}
	return []sessionsvc.PRSummary{{
		URL:          "https://github.com/ercs-second-brain/agent-orchestrator/pull/142",
		HTMLURL:      "https://github.com/ercs-second-brain/agent-orchestrator/pull/142",
		Number:       142,
		Title:        "Wire SCM summaries",
		State:        domain.PRStateOpen,
		Provider:     "github",
		Repo:         "ercs-second-brain/agent-orchestrator",
		Author:       "ada",
		SourceBranch: "codex/scm-observer-v1",
		TargetBranch: "main",
		HeadSHA:      "abc123",
		CI: sessionsvc.PRCISummary{State: domain.CIFailing, FailingChecks: []sessionsvc.PRFailingCheck{{
			Name:       "unit",
			Status:     domain.PRCheckFailed,
			Conclusion: "failure",
			URL:        "https://github.com/ercs-second-brain/agent-orchestrator/actions/runs/1",
		}}},
		Review: sessionsvc.PRReviewSummary{
			Decision:                   domain.ReviewChangesRequest,
			HasUnresolvedHumanComments: true,
			UnresolvedBy: []sessionsvc.PRUnresolvedReviewer{{
				ReviewerID: "reviewer-a",
				Count:      1,
				ReviewURL:  "https://github.com/ercs-second-brain/agent-orchestrator/pull/142#pullrequestreview-1",
				Links:      []sessionsvc.PRReviewCommentLink{{URL: "https://github.com/ercs-second-brain/agent-orchestrator/pull/142#discussion_r1", File: "main.go", Line: 12}},
			}},
		},
		Mergeability: sessionsvc.PRMergeabilitySummary{
			State:   domain.MergeConflicting,
			Reasons: []string{"conflicts"},
			PRURL:   "https://github.com/ercs-second-brain/agent-orchestrator/pull/142",
		},
		StateChangedAt: time.Date(2026, 6, 4, 11, 30, 0, 0, time.UTC),
		CreatedAt:      time.Date(2026, 6, 4, 9, 0, 0, 0, time.UTC),
		UpdatedAt:      time.Date(2026, 6, 4, 12, 0, 0, 0, time.UTC),
	}}, nil
}

func (f *fakeSessionService) ClaimPR(_ context.Context, id domain.SessionID, ref string, opts sessionsvc.ClaimPROptions) (sessionsvc.ClaimPRResult, error) {
	if f.claimErr != nil {
		return sessionsvc.ClaimPRResult{}, f.claimErr
	}
	if _, ok := f.sessions[id]; !ok {
		return sessionsvc.ClaimPRResult{}, apierr.NotFound("SESSION_NOT_FOUND", "Unknown session")
	}
	prs, _ := f.ListPRs(context.Background(), id)
	return sessionsvc.ClaimPRResult{PRs: prs, TakenOverFrom: []domain.SessionID{}, BranchChanged: true}, nil
}

func (f *fakeSessionService) StageAttachments(
	_ context.Context,
	id domain.SessionID,
	attachments []ports.SpawnAttachment,
) ([]string, error) {
	if f.stageErr != nil {
		return nil, f.stageErr
	}
	if _, ok := f.sessions[id]; !ok {
		return nil, apierr.NotFound("SESSION_NOT_FOUND", "Unknown session")
	}
	f.staged = attachments
	return f.stagedPaths, nil
}

func (f *fakeSessionService) ListWorkspaceFiles(_ context.Context, id domain.SessionID) (sessionsvc.WorkspaceFiles, error) {
	if f.workspaceErr != nil {
		return sessionsvc.WorkspaceFiles{}, f.workspaceErr
	}
	if _, ok := f.sessions[id]; !ok {
		return sessionsvc.WorkspaceFiles{}, apierr.NotFound("SESSION_NOT_FOUND", "Unknown session")
	}
	if f.workspaceFiles.SessionID != "" {
		return f.workspaceFiles, nil
	}
	return sessionsvc.WorkspaceFiles{SessionID: id}, nil
}

func (f *fakeSessionService) WorkspaceWatchPaths(_ context.Context, id domain.SessionID) ([]string, error) {
	if f.workspaceErr != nil {
		return nil, f.workspaceErr
	}
	session, ok := f.sessions[id]
	if !ok {
		return nil, apierr.NotFound("SESSION_NOT_FOUND", "Unknown session")
	}
	if len(f.workspacePaths) > 0 {
		return f.workspacePaths, nil
	}
	return []string{session.Metadata.WorkspacePath}, nil
}

func (f *fakeSessionService) GetWorkspaceFile(_ context.Context, id domain.SessionID, path string, section sessionsvc.WorkspaceFileSection) (sessionsvc.WorkspaceFileDetail, error) {
	f.workspaceFileSection = section
	if f.workspaceErr != nil {
		return sessionsvc.WorkspaceFileDetail{}, f.workspaceErr
	}
	if _, ok := f.sessions[id]; !ok {
		return sessionsvc.WorkspaceFileDetail{}, apierr.NotFound("SESSION_NOT_FOUND", "Unknown session")
	}
	if f.workspaceFile.SessionID != "" {
		return f.workspaceFile, nil
	}
	return sessionsvc.WorkspaceFileDetail{SessionID: id, Path: path}, nil
}

func (f *fakeSessionService) GetWorkspaceFileBlob(_ context.Context, id domain.SessionID, path string, side sessionsvc.WorkspaceFileBlobSide) (sessionsvc.WorkspaceFileBlob, error) {
	if f.workspaceErr != nil {
		return sessionsvc.WorkspaceFileBlob{}, f.workspaceErr
	}
	if _, ok := f.sessions[id]; !ok {
		return sessionsvc.WorkspaceFileBlob{}, apierr.NotFound("SESSION_NOT_FOUND", "Unknown session")
	}
	if f.workspaceBlob.MediaType != "" {
		blob := f.workspaceBlob
		blob.Side = side
		return blob, nil
	}
	return sessionsvc.WorkspaceFileBlob{Path: path, Side: side, MediaType: "image/png"}, nil
}

func (f *fakeSessionService) ListWorkspaceTree(_ context.Context, id domain.SessionID, path string) (sessionsvc.WorkspaceTree, error) {
	f.workspaceTreePath = path
	if f.workspaceErr != nil {
		return sessionsvc.WorkspaceTree{}, f.workspaceErr
	}
	if _, ok := f.sessions[id]; !ok {
		return sessionsvc.WorkspaceTree{}, apierr.NotFound("SESSION_NOT_FOUND", "Unknown session")
	}
	if f.workspaceTree.SessionID != "" {
		return f.workspaceTree, nil
	}
	return sessionsvc.WorkspaceTree{SessionID: id, Path: path}, nil
}

func newSessionTestServer(t *testing.T, svc *fakeSessionService) *httptest.Server {
	t.Helper()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	deps := httpd.APIDeps{Sessions: svc}
	srv := httptest.NewServer(httpd.NewRouterWithControl(config.Config{}, log, nil, deps, httpd.ControlDeps{}))
	t.Cleanup(srv.Close)
	return srv
}

func TestSessionsAPI_ListWorkspaceTree(t *testing.T) {
	t.Run("lists the requested directory", func(t *testing.T) {
		svc := newFakeSessionService()
		svc.workspaceTree = sessionsvc.WorkspaceTree{
			SessionID: "ao-1",
			Path:      "src",
			Entries: []sessionsvc.WorkspaceTreeEntry{{
				Name: "main.go", Path: "src/main.go", Type: sessionsvc.WorkspaceTreeFile,
			}},
		}
		srv := newSessionTestServer(t, svc)
		body, status, _ := doRequest(t, srv, http.MethodGet, "/api/v1/sessions/ao-1/workspace/tree?path=src", "")
		if status != http.StatusOK {
			t.Fatalf("status = %d, want 200; body=%s", status, body)
		}
		if svc.workspaceTreePath != "src" {
			t.Fatalf("service path = %q, want src", svc.workspaceTreePath)
		}
		var got controllers.ListWorkspaceTreeResponse
		mustJSON(t, body, &got)
		if got.Path != "src" || len(got.Entries) != 1 || got.Entries[0].Path != "src/main.go" {
			t.Fatalf("response = %+v", got)
		}
	})

	t.Run("returns not found for an unknown session", func(t *testing.T) {
		srv := newSessionTestServer(t, newFakeSessionService())
		body, status, _ := doRequest(t, srv, http.MethodGet, "/api/v1/sessions/missing/workspace/tree", "")
		if status != http.StatusNotFound {
			t.Fatalf("status = %d, want 404; body=%s", status, body)
		}
	})

	for _, tc := range []struct {
		name string
		err  error
		want int
	}{
		{name: "invalid path", err: apierr.Invalid("INVALID_WORKSPACE_PATH", "invalid workspace path", nil), want: http.StatusBadRequest},
		{name: "service failure", err: errors.New("tree unavailable"), want: http.StatusInternalServerError},
	} {
		t.Run(tc.name, func(t *testing.T) {
			svc := newFakeSessionService()
			svc.workspaceErr = tc.err
			srv := newSessionTestServer(t, svc)
			body, status, _ := doRequest(t, srv, http.MethodGet, "/api/v1/sessions/ao-1/workspace/tree?path=src", "")
			if status != tc.want {
				t.Fatalf("status = %d, want %d; body=%s", status, tc.want, body)
			}
		})
	}
}

func TestSessionsAPI_AgentSwitchLifecycle(t *testing.T) {
	svc := newFakeSessionService()
	srv := newSessionTestServer(t, svc)

	body, status, _ := doRequest(t, srv, http.MethodPost, "/api/v1/sessions/ao-1/switch-agent", `{
		"targetHarness":"codex",
		"model":" gpt-\u0000-5.4 ",
		"idempotencyKey":"retry-1"
	}`)
	if status != http.StatusAccepted {
		t.Fatalf("switch agent = %d, want 202; body=%s", status, body)
	}
	assertAgentSwitchResponseRedacted(t, body)
	var switched controllers.AgentSwitchResponse
	mustJSON(t, body, &switched)
	if switched.Switch.ID != "switch-1" || switched.Switch.TargetHarness != domain.HarnessCodex {
		t.Fatalf("switch response = %+v", switched.Switch)
	}
	if switched.Switch.ErrorCode != domain.AgentSwitchErrorTargetStartUnconfirmed {
		t.Fatalf("safe error code = %q", switched.Switch.ErrorCode)
	}
	if switched.Switch.SourceTranscriptStatus != domain.AgentSwitchSourceTranscriptUnavailable {
		t.Fatalf("source transcript status = %q", switched.Switch.SourceTranscriptStatus)
	}
	if !switched.Switch.SemanticHandoffIncluded {
		t.Fatal("semantic handoff inclusion fact was not projected")
	}
	if svc.switchConfig.Model != "gpt--5.4" || svc.switchConfig.IdempotencyKey != "retry-1" {
		t.Fatalf("switch config = %+v", svc.switchConfig)
	}

	body, status, _ = doRequest(t, srv, http.MethodGet, "/api/v1/sessions/ao-1/agent-switches", "")
	if status != http.StatusOK {
		t.Fatalf("list switches = %d, want 200; body=%s", status, body)
	}
	assertAgentSwitchResponseRedacted(t, body)
	var listed controllers.ListAgentSwitchesResponse
	mustJSON(t, body, &listed)
	if len(listed.Switches) != 1 || listed.Switches[0].ID != "switch-1" {
		t.Fatalf("listed switches = %+v", listed.Switches)
	}

	body, status, _ = doRequest(t, srv, http.MethodPost, "/api/v1/sessions/ao-1/agent-switches/switch-1/handoff", `{
		"sourceGenerationId":"generation-7",
		"handoff":{"summary":"tests pass","nextSteps":["review diff"]}
	}`)
	if status != http.StatusOK {
		t.Fatalf("submit handoff = %d, want 200; body=%s", status, body)
	}
	assertAgentSwitchResponseRedacted(t, body)
	if svc.handoffSource != "generation-7" {
		t.Fatalf("source generation = %q", svc.handoffSource)
	}
	var handoff map[string]any
	if err := json.Unmarshal(svc.handoff, &handoff); err != nil {
		t.Fatalf("decode recorded handoff: %v", err)
	}
	if handoff["summary"] != "tests pass" {
		t.Fatalf("recorded handoff = %#v", handoff)
	}
	recovery := svc.agentSwitches["switch-1"]
	recovery.State = domain.AgentSwitchSourceStopped
	recovery.ErrorCode = domain.AgentSwitchErrorSourceRestoreUnconfirmed
	svc.agentSwitches[recovery.ID] = recovery
	body, status, _ = doRequest(t, srv, http.MethodPost, "/api/v1/sessions/ao-1/agent-switches/switch-1/recover", "")
	if status != http.StatusAccepted {
		t.Fatalf("recover switch = %d, want 202; body=%s", status, body)
	}
	assertAgentSwitchResponseRedacted(t, body)
	if svc.recoveredSwitch != "switch-1" {
		t.Fatalf("recovered switch = %q, want switch-1", svc.recoveredSwitch)
	}

}

func TestSessionsAPIActiveSwitchProjectionRedactsPrivateFacts(t *testing.T) {
	svc := newFakeSessionService()
	now := time.Date(2026, 8, 9, 12, 0, 0, 0, time.UTC)
	targetRef := domain.AgentNativeSessionID("native-target")
	session := svc.sessions["ao-1"]
	session.ActiveAgentSwitch = &domain.AgentSwitch{
		ID: "switch-active", SessionID: "ao-1", IdempotencyKey: "private-key",
		RequestFingerprint: "v1:private-fingerprint", FromHarness: domain.HarnessClaudeCode,
		TargetHarness: domain.HarnessCodex, TargetNativeSessionRef: &targetRef,
		TargetStartMode: domain.AgentSwitchTargetStartFresh, State: domain.AgentSwitchStartingTarget,
		AgentHandoffStatus: domain.AgentHandoffReceived, SemanticHandoffIncluded: true,
		SourceTranscriptStatus: domain.AgentSwitchSourceTranscriptAvailable,
		AgentHandoffPath:       "/private/agent-handoff.json", AgentHandoffHash: "private-agent-hash",
		FinalHandoffPath: "/private/final-handoff.json", FinalHandoffHash: "private-final-hash",
		SourceGenerationID: "private-source-generation", TargetGenerationID: "private-target-generation",
		TargetRuntimeHandleID: "private-runtime-handle", TargetAcknowledgedAt: &now,
		RequestedAt: now, UpdatedAt: now,
	}
	svc.sessions["ao-1"] = session
	srv := newSessionTestServer(t, svc)

	body, status, _ := doRequest(t, srv, http.MethodGet, "/api/v1/sessions/ao-1", "")
	if status != http.StatusOK {
		t.Fatalf("get session = %d, want 200; body=%s", status, body)
	}
	assertAgentSwitchResponseRedacted(t, body)
	var response struct {
		Session struct {
			ActiveAgentSwitch *controllers.AgentSwitchView `json:"activeAgentSwitch"`
		} `json:"session"`
	}
	mustJSON(t, body, &response)
	if response.Session.ActiveAgentSwitch == nil || response.Session.ActiveAgentSwitch.ID != "switch-active" || response.Session.ActiveAgentSwitch.State != domain.AgentSwitchStartingTarget {
		t.Fatalf("active switch projection = %+v", response.Session.ActiveAgentSwitch)
	}
}

func assertAgentSwitchResponseRedacted(t *testing.T, body []byte) {
	t.Helper()
	privateFields := []string{
		"idempotencyKey",
		"requestFingerprint",
		"targetNativeSessionRef",
		"agentHandoffPath",
		"agentHandoffHash",
		"finalHandoffPath",
		"finalHandoffHash",
		"sourceGenerationId",
		"targetGenerationId",
		"targetRuntimeHandleId",
		"targetAcknowledgedAt",
	}
	for _, field := range privateFields {
		if strings.Contains(string(body), `"`+field+`"`) {
			t.Errorf("public agent-switch response leaked %s: %s", field, body)
		}
	}
}

func TestSessionsAPI_SubmitAgentHandoffPreservesRawObject(t *testing.T) {
	svc := newFakeSessionService()
	svc.agentSwitches["switch-1"] = domain.AgentSwitch{ID: "switch-1", SessionID: "ao-1"}
	srv := newSessionTestServer(t, svc)

	const handoff = `{"schemaVersion":1,"goal":"first","goal":"second","progressSummary":"ready"}`
	body, status, _ := doRequest(t, srv, http.MethodPost, "/api/v1/sessions/ao-1/agent-switches/switch-1/handoff", `{
		"sourceGenerationId":"generation-7",
		"handoff":`+handoff+`
	}`)
	if status != http.StatusOK {
		t.Fatalf("submit handoff = %d, want 200; body=%s", status, body)
	}
	if got := string(svc.handoff); got != handoff {
		t.Fatalf("handoff raw JSON = %s, want exact input %s", got, handoff)
	}
	assertAgentSwitchResponseRedacted(t, body)
}

func TestSessionsAPI_AgentSwitchValidationAndErrors(t *testing.T) {
	tests := []struct {
		name     string
		method   string
		path     string
		body     string
		wantCode string
	}{
		{name: "target required", method: http.MethodPost, path: "/api/v1/sessions/ao-1/switch-agent", body: `{}`, wantCode: "TARGET_HARNESS_REQUIRED"},
		{name: "retired note rejected", method: http.MethodPost, path: "/api/v1/sessions/ao-1/switch-agent", body: `{"targetHarness":"codex","note":"old context"}`, wantCode: "INVALID_JSON"},
		{name: "model bounded", method: http.MethodPost, path: "/api/v1/sessions/ao-1/switch-agent", body: `{"targetHarness":"codex","model":"` + strings.Repeat("x", 257) + `"}`, wantCode: "MODEL_TOO_LONG"},
		{name: "source generation required", method: http.MethodPost, path: "/api/v1/sessions/ao-1/agent-switches/switch-1/handoff", body: `{"handoff":{}}`, wantCode: "SOURCE_GENERATION_REQUIRED"},
		{name: "handoff required", method: http.MethodPost, path: "/api/v1/sessions/ao-1/agent-switches/switch-1/handoff", body: `{"sourceGenerationId":"generation-7"}`, wantCode: "HANDOFF_REQUIRED"},
		{name: "handoff bounded", method: http.MethodPost, path: "/api/v1/sessions/ao-1/agent-switches/switch-1/handoff", body: `{"sourceGenerationId":"generation-7","handoff":{"summary":"` + strings.Repeat("x", 65537) + `"}}`, wantCode: "HANDOFF_TOO_LARGE"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			svc := newFakeSessionService()
			svc.agentSwitches["switch-1"] = domain.AgentSwitch{ID: "switch-1", SessionID: "ao-1"}
			srv := newSessionTestServer(t, svc)
			body, status, _ := doRequest(t, srv, tc.method, tc.path, tc.body)
			if status != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400; body=%s", status, body)
			}
			var apiErr struct {
				Code string `json:"code"`
			}
			mustJSON(t, body, &apiErr)
			if apiErr.Code != tc.wantCode {
				t.Fatalf("code = %q, want %q; body=%s", apiErr.Code, tc.wantCode, body)
			}
		})
	}

	svc := newFakeSessionService()
	svc.switchErr = apierr.Conflict("AGENT_SWITCH_IN_PROGRESS", "switch in progress", nil)
	srv := newSessionTestServer(t, svc)
	body, status, _ := doRequest(t, srv, http.MethodPost, "/api/v1/sessions/ao-1/switch-agent", `{"targetHarness":"codex"}`)
	if status != http.StatusConflict || !strings.Contains(string(body), "AGENT_SWITCH_IN_PROGRESS") {
		t.Fatalf("typed conflict = %d body=%s", status, body)
	}
}

func (f *fakeSessionService) InvalidateWorkspaceCache(_ domain.SessionID) {}

func TestSessionsRoutes_DefaultToStubsWithoutService(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	srv := httptest.NewServer(httpd.NewRouterWithControl(config.Config{}, log, nil, httpd.APIDeps{}, httpd.ControlDeps{}))
	t.Cleanup(srv.Close)

	body, status, headers := doRequest(t, srv, "GET", "/api/v1/sessions", "")
	assertJSON(t, headers)
	assertErrorCode(t, body, status, http.StatusNotImplemented, "NOT_IMPLEMENTED")
}

func TestSessionsAPI_ListSpawnGetAndActions(t *testing.T) {
	svc := newFakeSessionService()
	s := svc.sessions["ao-1"]
	s.Metadata = domain.SessionMetadata{Branch: "qa/modal-worker", WorkspacePath: "/tmp/private-worktree", RuntimeHandleID: "runtime-1", Prompt: "private prompt"}
	s.SCMStatus = domain.StatusReviewPending
	s.KanbanColumn = domain.KanbanNeedsReview
	s.DisplayStatus = contract.DisplayNeedsHumanReview
	svc.sessions["ao-1"] = s
	srv := newSessionTestServer(t, svc)

	body, status, _ := doRequest(t, srv, "GET", "/api/v1/sessions?project=ao", "")
	if status != http.StatusOK {
		t.Fatalf("GET sessions = %d, want 200; body=%s", status, body)
	}
	var list struct {
		Sessions []sessionBody `json:"sessions"`
	}
	mustJSON(t, body, &list)
	if len(list.Sessions) != 1 || list.Sessions[0].ID != "ao-1" || list.Sessions[0].Status != string(domain.StatusIdle) || list.Sessions[0].SCMStatus != string(domain.StatusReviewPending) || list.Sessions[0].TerminalHandleID != "ao-1/terminal_0" {
		t.Fatalf("list = %#v", list)
	}
	if list.Sessions[0].KanbanColumn != string(domain.KanbanNeedsReview) {
		t.Fatalf("kanbanColumn = %q, want the derived column on the wire", list.Sessions[0].KanbanColumn)
	}
	if list.Sessions[0].DisplayStatus != string(contract.DisplayNeedsHumanReview) {
		t.Fatalf("displayStatus = %q, want the derived phrase on the wire", list.Sessions[0].DisplayStatus)
	}
	if list.Sessions[0].Branch != "qa/modal-worker" {
		t.Fatalf("branch = %q, want qa/modal-worker", list.Sessions[0].Branch)
	}
	var rawList struct {
		Sessions []map[string]any `json:"sessions"`
	}
	mustJSON(t, body, &rawList)
	if _, ok := rawList.Sessions[0]["metadata"]; ok {
		t.Fatalf("list leaked metadata: %s", body)
	}
	if _, ok := rawList.Sessions[0]["workspacePath"]; ok {
		t.Fatalf("list leaked workspacePath: %s", body)
	}
	if _, ok := rawList.Sessions[0]["prompt"]; ok {
		t.Fatalf("list leaked prompt: %s", body)
	}

	body, status, _ = doRequest(t, srv, "POST", "/api/v1/sessions", `{"projectId":"ao","issueId":"ISS-1","kind":"worker","harness":"codex","prompt":"fix","displayName":"my worker"}`)
	if status != http.StatusCreated {
		t.Fatalf("POST session = %d, want 201; body=%s", status, body)
	}
	var spawned struct {
		Session           sessionBody `json:"session"`
		PromptBytes       *int        `json:"promptBytes"`
		SystemPromptBytes *int        `json:"systemPromptBytes"`
	}
	mustJSON(t, body, &spawned)
	if spawned.Session.ID != "ao-2" || spawned.Session.IssueID != "ISS-1" || spawned.Session.Harness != "codex" {
		t.Fatalf("spawned = %#v", spawned)
	}
	if spawned.Session.DisplayName != "my worker" {
		t.Fatalf("spawned displayName = %q, want %q", spawned.Session.DisplayName, "my worker")
	}
	if spawned.PromptBytes == nil || *spawned.PromptBytes != len("fix") {
		t.Fatalf("spawned promptBytes = %v, want %d", spawned.PromptBytes, len("fix"))
	}
	if spawned.SystemPromptBytes == nil || *spawned.SystemPromptBytes != 0 {
		t.Fatalf("spawned systemPromptBytes = %v, want present zero", spawned.SystemPromptBytes)
	}

	body, status, _ = doRequest(t, srv, "GET", "/api/v1/sessions/ao-2", "")
	if status != http.StatusOK {
		t.Fatalf("GET session = %d, want 200; body=%s", status, body)
	}

	body, status, _ = doRequest(t, srv, "POST", "/api/v1/sessions/ao-2/send", "{\"message\":\"con\\u0000tinue\"}")
	if status != http.StatusOK || svc.sent != "continue" {
		t.Fatalf("send status=%d sent=%q body=%s", status, svc.sent, body)
	}

	body, status, _ = doRequest(t, srv, "POST", "/api/v1/sessions/ao-2/kill", "")
	if status != http.StatusOK {
		t.Fatalf("kill = %d, want 200; body=%s", status, body)
	}
	var killed struct {
		SessionID string `json:"sessionId"`
		Freed     bool   `json:"freed"`
	}
	mustJSON(t, body, &killed)
	if killed.SessionID != "ao-2" || !killed.Freed {
		t.Fatalf("kill response = %#v", killed)
	}

	body, status, _ = doRequest(t, srv, "POST", "/api/v1/sessions/ao-2/restore", "")
	if status != http.StatusOK {
		t.Fatalf("restore = %d, want 200; body=%s", status, body)
	}
	var restored struct {
		SessionID   string `json:"sessionId"`
		RestoreMode string `json:"restoreMode"`
	}
	mustJSON(t, body, &restored)
	if restored.SessionID != "ao-2" || restored.RestoreMode != "native" {
		t.Fatalf("restore response = %#v", restored)
	}

	body, status, _ = doRequest(t, srv, "POST", "/api/v1/sessions/ao-2/exit-agent", "")
	if status != http.StatusOK {
		t.Fatalf("exit agent = %d, want 200; body=%s", status, body)
	}
	var exited struct {
		SessionID string `json:"sessionId"`
		Session   struct {
			Activity domain.Activity `json:"activity"`
		} `json:"session"`
	}
	mustJSON(t, body, &exited)
	if exited.SessionID != "ao-2" || exited.Session.Activity.State != domain.ActivityExited {
		t.Fatalf("exit response = %#v", exited)
	}

	body, status, _ = doRequest(t, srv, "POST", "/api/v1/sessions/ao-2/resume-agent", "")
	if status != http.StatusOK {
		t.Fatalf("resume agent = %d, want 200; body=%s", status, body)
	}
	var resumed struct {
		SessionID  string `json:"sessionId"`
		ResumeMode string `json:"resumeMode"`
	}
	mustJSON(t, body, &resumed)
	if resumed.SessionID != "ao-2" || resumed.ResumeMode != "native" {
		t.Fatalf("resume response = %#v", resumed)
	}

	body, status, _ = doRequest(t, srv, "PATCH", "/api/v1/sessions/ao-2", `{"displayName":"Renamed"}`)
	if status != http.StatusOK {
		t.Fatalf("rename = %d, want 200; body=%s", status, body)
	}
	var renamed struct {
		OK          bool   `json:"ok"`
		SessionID   string `json:"sessionId"`
		DisplayName string `json:"displayName"`
	}
	mustJSON(t, body, &renamed)
	if !renamed.OK || renamed.SessionID != "ao-2" || renamed.DisplayName != "Renamed" {
		t.Fatalf("rename response = %#v", renamed)
	}
	if svc.sessions["ao-2"].DisplayName != "Renamed" {
		t.Fatalf("session displayName not updated: %+v", svc.sessions["ao-2"])
	}

	body, status, _ = doRequest(t, srv, "PATCH", "/api/v1/sessions/ao-2/merge-policy", `{"terminateOnPrMerge":true}`)
	if status != http.StatusOK {
		t.Fatalf("merge policy = %d, want 200; body=%s", status, body)
	}
	var policy struct {
		OK                 bool   `json:"ok"`
		SessionID          string `json:"sessionId"`
		TerminateOnPRMerge bool   `json:"terminateOnPrMerge"`
	}
	mustJSON(t, body, &policy)
	if !policy.OK || policy.SessionID != "ao-2" || !policy.TerminateOnPRMerge {
		t.Fatalf("merge policy response = %#v", policy)
	}
	if !svc.sessions["ao-2"].TerminateOnPRMerge {
		t.Fatalf("session merge policy not updated: %+v", svc.sessions["ao-2"])
	}

	body, status, _ = doRequest(t, srv, "PUT", "/api/v1/sessions/ao-2/auto-review", `{"enabled":true}`)
	if status != http.StatusOK {
		t.Fatalf("auto review = %d, want 200; body=%s", status, body)
	}
	var autoReview struct {
		Session domain.Session `json:"session"`
	}
	mustJSON(t, body, &autoReview)
	if !autoReview.Session.AutoReviewEnabled || !svc.sessions["ao-2"].AutoReviewEnabled {
		t.Fatalf("auto review response=%+v stored=%+v", autoReview, svc.sessions["ao-2"])
	}

	body, status, _ = doRequest(t, srv, "PUT", "/api/v1/sessions/ao-2/auto-review", `{}`)
	if status != http.StatusBadRequest || !strings.Contains(string(body), "AUTO_REVIEW_ENABLED_REQUIRED") {
		t.Fatalf("missing auto review enabled = %d, want 400; body=%s", status, body)
	}
	if !svc.sessions["ao-2"].AutoReviewEnabled {
		t.Fatal("malformed auto review request changed persisted state")
	}

	body, status, _ = doRequest(t, srv, "PATCH", "/api/v1/sessions/ao-2/auto-inject-review", `{"autoInjectReview":false}`)
	if status != http.StatusOK {
		t.Fatalf("auto-inject review policy = %d, want 200; body=%s", status, body)
	}
	var autoInjectPolicy struct {
		OK               bool   `json:"ok"`
		SessionID        string `json:"sessionId"`
		AutoInjectReview bool   `json:"autoInjectReview"`
	}
	mustJSON(t, body, &autoInjectPolicy)
	if !autoInjectPolicy.OK || autoInjectPolicy.SessionID != "ao-2" || autoInjectPolicy.AutoInjectReview {
		t.Fatalf("auto-inject review policy response = %#v", autoInjectPolicy)
	}
	if svc.sessions["ao-2"].AutoInjectReview {
		t.Fatalf("session auto-inject review policy not updated: %+v", svc.sessions["ao-2"])
	}

	body, status, _ = doRequest(t, srv, "PATCH", "/api/v1/sessions/ao-2/auto-inject-ci", `{"autoInjectCI":false}`)
	if status != http.StatusOK {
		t.Fatalf("auto-inject CI policy = %d, want 200; body=%s", status, body)
	}
	var ciPolicy struct {
		OK           bool   `json:"ok"`
		SessionID    string `json:"sessionId"`
		AutoInjectCI bool   `json:"autoInjectCI"`
	}
	mustJSON(t, body, &ciPolicy)
	if !ciPolicy.OK || ciPolicy.SessionID != "ao-2" || ciPolicy.AutoInjectCI {
		t.Fatalf("auto-inject CI policy response = %#v", ciPolicy)
	}
	if svc.autoInjectCISession != "ao-2" || svc.autoInjectCIEnabled || svc.sessions["ao-2"].AutoInjectCI {
		t.Fatalf("auto-inject CI service input = session:%q enabled:%v", svc.autoInjectCISession, svc.autoInjectCIEnabled)
	}

	body, status, _ = doRequest(t, srv, "POST", "/api/v1/sessions/ao-2/pin", "")
	if status != http.StatusOK {
		t.Fatalf("pin = %d, want 200; body=%s", status, body)
	}
	var pinned struct {
		Session struct {
			IsPinned bool `json:"isPinned"`
		} `json:"session"`
	}
	mustJSON(t, body, &pinned)
	if !pinned.Session.IsPinned {
		t.Fatalf("pin response = %#v", pinned)
	}
	if !svc.sessions["ao-2"].IsPinned {
		t.Fatalf("session pin not updated: %+v", svc.sessions["ao-2"])
	}

	body, status, _ = doRequest(t, srv, "DELETE", "/api/v1/sessions/ao-2/pin", "")
	if status != http.StatusOK {
		t.Fatalf("unpin = %d, want 200; body=%s", status, body)
	}
	var unpinned struct {
		Session struct {
			IsPinned bool `json:"isPinned"`
		} `json:"session"`
	}
	mustJSON(t, body, &unpinned)
	if unpinned.Session.IsPinned {
		t.Fatalf("unpin response = %#v", unpinned)
	}
	if svc.sessions["ao-2"].IsPinned {
		t.Fatalf("session unpin not updated: %+v", svc.sessions["ao-2"])
	}

	_, status, _ = doRequest(t, srv, "POST", "/api/v1/sessions/ghost-1/pin", "")
	if status != http.StatusNotFound {
		t.Fatalf("pin unknown = %d, want 404", status)
	}

	_, status, _ = doRequest(t, srv, "DELETE", "/api/v1/sessions/ghost-1/pin", "")
	if status != http.StatusNotFound {
		t.Fatalf("unpin unknown = %d, want 404", status)
	}

	body, status, _ = doRequest(t, srv, "POST", "/api/v1/orchestrators", `{"projectId":"ao"}`)
	if status != http.StatusCreated {
		t.Fatalf("orchestrator = %d, want 201; body=%s", status, body)
	}
}

func TestSessionsAPI_SetReviewerAllowsConfigWithoutHarness(t *testing.T) {
	svc := newFakeSessionService()
	srv := newSessionTestServer(t, svc)

	body, status, _ := doRequest(t, srv, "PUT", "/api/v1/sessions/ao-1/reviewer", `{"agentConfig":{"model":"gpt-5"}}`)
	if status != http.StatusOK {
		t.Fatalf("set reviewer with default harness override = %d, want 200; body=%s", status, body)
	}
	if got := svc.sessions["ao-1"]; got.ReviewerHarness != "" || got.ReviewerConfig.Model != "gpt-5" {
		t.Fatalf("reviewer update persisted = (%q, %+v), want default harness with model override", got.ReviewerHarness, got.ReviewerConfig)
	}
}

type sessionBody struct {
	ID               string `json:"id"`
	ProjectID        string `json:"projectId"`
	IssueID          string `json:"issueId"`
	Kind             string `json:"kind"`
	Harness          string `json:"harness"`
	DisplayName      string `json:"displayName"`
	Branch           string `json:"branch"`
	Status           string `json:"status"`
	SCMStatus        string `json:"scmStatus"`
	KanbanColumn     string `json:"kanbanColumn"`
	DisplayStatus    string `json:"displayStatus"`
	TerminalHandleID string `json:"terminalHandleId"`
}
