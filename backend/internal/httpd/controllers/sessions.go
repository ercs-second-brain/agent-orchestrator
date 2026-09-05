package controllers

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"mime"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"

	"github.com/ercs-second-brain/agent-orchestrator/backend/internal/attachmentstore"
	"github.com/ercs-second-brain/agent-orchestrator/backend/internal/domain"
	"github.com/ercs-second-brain/agent-orchestrator/backend/internal/httpd/apispec"
	"github.com/ercs-second-brain/agent-orchestrator/backend/internal/httpd/envelope"
	"github.com/ercs-second-brain/agent-orchestrator/backend/internal/ports"
	sessionsvc "github.com/ercs-second-brain/agent-orchestrator/backend/internal/service/session"
	"github.com/ercs-second-brain/agent-orchestrator/backend/internal/workspacewatch"
)

const (
	maxPromptLen      = 4096
	maxMessageLen     = 4096
	maxModelLen       = 256
	maxDisplayNameLen = 20
	maxIdempotencyKey = 128

	// Agent-authored handoffs are deliberately bounded. Deterministic AO
	// context is stored separately and does not need to be repeated here.
	maxAgentHandoffBodyBytes = 256 << 10
	maxAgentHandoffBytes     = 64 << 10

	// Attachment limits guard the daemon against oversized spawn bodies. Files
	// are pasted/dropped into the task brief and inlined as base64 in the JSON
	// body, so the caps are deliberately conservative.
	maxAttachments      = 8
	maxAttachmentBytes  = attachmentstore.MaxFileBytes // 10 MiB per file, decoded
	maxAttachmentsBytes = 25 << 20                     // 25 MiB total, decoded
	// maxSpawnBodyBytes bounds the raw request body before it is decoded. The
	// per-attachment and total caps above only apply after the whole body is
	// materialized, so without this an oversized body (base64 inflates the
	// decoded total by ~4/3) would allocate in full first. Derived from the
	// decoded total plus headroom for the prompt and JSON envelope.
	maxSpawnBodyBytes = maxAttachmentsBytes*4/3 + (2 << 20)
	// maxSendBodyBytes is the /send equivalent of maxSpawnBodyBytes, sized off
	// maxAttachmentBytes (one attachment) rather than maxAttachmentsBytes
	// (spawn's up-to-eight): unlike spawn, a send carries at most one inline
	// attachment.
	maxSendBodyBytes = maxAttachmentBytes*4/3 + (2 << 20)
)

// blockedAttachmentMimes contains MIME types that are explicitly rejected for
// security reasons. SVG is excluded because it is XML that can carry active
// content (scripts/external entities).
var blockedAttachmentMimes = map[string]bool{
	"image/svg+xml": true,
}

// SessionService is the controller-facing session service contract.
type SessionService interface {
	List(ctx context.Context, filter sessionsvc.ListFilter) ([]domain.Session, error)
	Spawn(ctx context.Context, cfg ports.SpawnConfig) (domain.Session, int, int, error)
	SpawnOrchestrator(ctx context.Context, projectID domain.ProjectID, clean bool, requestedMode domain.SessionMode) (domain.Session, error)
	Get(ctx context.Context, id domain.SessionID) (domain.Session, error)
	Restore(ctx context.Context, id domain.SessionID) (sessionsvc.RestoreOutcome, error)
	ExitAgent(ctx context.Context, id domain.SessionID) (sessionsvc.ExitAgentOutcome, error)
	ResumeAgent(ctx context.Context, id domain.SessionID) (sessionsvc.ResumeAgentOutcome, error)
	Kill(ctx context.Context, id domain.SessionID) (bool, error)
	RollbackSpawn(ctx context.Context, id domain.SessionID) (sessionsvc.RollbackOutcome, error)
	Cleanup(ctx context.Context, project domain.ProjectID) (sessionsvc.CleanupOutcome, error)
	Rename(ctx context.Context, id domain.SessionID, displayName string) error
	SetTerminateOnPRMerge(ctx context.Context, id domain.SessionID, terminate bool) (domain.Session, error)
	SetAutoInjectReview(ctx context.Context, id domain.SessionID, autoInject bool) (domain.Session, error)
	SetAutoInjectCI(ctx context.Context, id domain.SessionID, autoInject bool) (domain.Session, error)
	SetReviewerHarness(ctx context.Context, id domain.SessionID, harness domain.ReviewerHarness, config domain.AgentConfig) (domain.Session, error)
	SetAutoReview(ctx context.Context, id domain.SessionID, enabled bool) (domain.Session, error)
	Send(ctx context.Context, id domain.SessionID, message string, attachment *ports.SpawnAttachment) error
	DelegateTask(ctx context.Context, in sessionsvc.DelegateTaskInput) (sessionsvc.DelegateTaskOutcome, error)
	ListPRSummaries(ctx context.Context, id domain.SessionID) ([]sessionsvc.PRSummary, error)
	ClaimPR(ctx context.Context, id domain.SessionID, ref string, opts sessionsvc.ClaimPROptions) (sessionsvc.ClaimPRResult, error)
	StageAttachments(ctx context.Context, id domain.SessionID, attachments []ports.SpawnAttachment) ([]string, error)
	WorkspaceWatchPaths(ctx context.Context, id domain.SessionID) ([]string, error)
	ListWorkspaceFiles(ctx context.Context, id domain.SessionID) (sessionsvc.WorkspaceFiles, error)
	GetWorkspaceFile(ctx context.Context, id domain.SessionID, path string, section sessionsvc.WorkspaceFileSection) (sessionsvc.WorkspaceFileDetail, error)
	GetWorkspaceFileBlob(ctx context.Context, id domain.SessionID, path string, side sessionsvc.WorkspaceFileBlobSide) (sessionsvc.WorkspaceFileBlob, error)
	ListWorkspaceTree(ctx context.Context, id domain.SessionID, path string) (sessionsvc.WorkspaceTree, error)
	InvalidateWorkspaceCache(id domain.SessionID)
	Pin(ctx context.Context, id domain.SessionID) (domain.Session, error)
	Unpin(ctx context.Context, id domain.SessionID) (domain.Session, error)
}

// ActivityRecorder applies an agent activity-state signal to a session. It is
// satisfied directly by *lifecycle.Manager: an activity signal is a pure
// lifecycle reduction (no runtime/workspace teardown), so it bypasses
// SessionService rather than threading a no-op passthrough through the session
// manager.
type ActivityRecorder interface {
	ApplyActivitySignal(ctx context.Context, id domain.SessionID, s ports.ActivitySignal) error
}

// SessionsController owns the session routes. Nil keeps routes registered but
// returns OpenAPI-backed 501s.
type SessionsController struct {
	Svc         SessionService
	Activity    ActivityRecorder
	Attachments *attachmentstore.Store
}

// Register mounts the session routes on the supplied router.
func (c *SessionsController) Register(r chi.Router) {
	r.Get("/sessions", c.list)
	r.Post("/sessions", c.spawn)
	r.Post("/sessions/cleanup", c.cleanup)
	r.Get("/sessions/{sessionId}", c.get)
	r.Post("/sessions/{sessionId}/attachments", c.stageAttachments)
	r.Get("/sessions/{sessionId}/workspace/files", c.listWorkspaceFiles)
	r.Get("/sessions/{sessionId}/workspace/file", c.getWorkspaceFile)
	r.Get("/sessions/{sessionId}/workspace/file/blob", c.getWorkspaceFileBlob)
	r.Get("/sessions/{sessionId}/workspace/tree", c.listWorkspaceTree)
	r.Get("/sessions/{sessionId}/pr", c.listPRs)
	r.Post("/sessions/{sessionId}/pr/claim", c.claimPR)
	r.Patch("/sessions/{sessionId}", c.rename)
	r.Patch("/sessions/{sessionId}/merge-policy", c.setMergePolicy)
	r.Patch("/sessions/{sessionId}/auto-inject-review", c.setAutoInjectReviewPolicy)
	r.Patch("/sessions/{sessionId}/auto-inject-ci", c.setAutoInjectCIPolicy)
	r.Put("/sessions/{sessionId}/reviewer", c.setReviewer)
	r.Put("/sessions/{sessionId}/auto-review", c.setAutoReview)
	r.Post("/sessions/{sessionId}/restore", c.restore)
	r.Post("/sessions/{sessionId}/exit-agent", c.exitAgent)
	r.Post("/sessions/{sessionId}/resume-agent", c.resumeAgent)
	r.Post("/sessions/{sessionId}/kill", c.kill)
	r.Post("/sessions/{sessionId}/rollback", c.rollback)
	r.Post("/sessions/{sessionId}/send", c.send)
	r.Post("/sessions/{sessionId}/activity", c.activity)
	r.Post("/sessions/{sessionId}/pin", c.pin)
	r.Delete("/sessions/{sessionId}/pin", c.unpin)
	r.Get("/orchestrators", c.listOrchestrators)
	r.Post("/orchestrators", c.spawnOrchestrator)
	r.Post("/orchestrators/delegate", c.delegateTask)
	r.Get("/orchestrators/{id}", c.getOrchestrator)
}

// RegisterStreams mounts long-lived session streams outside the REST timeout
// middleware. Worktree notifications remain active only while a client is
// actually viewing that session's files.
func (c *SessionsController) RegisterStreams(r chi.Router) {
	r.Get("/sessions/{sessionId}/workspace/events", c.streamWorkspaceChanges)
}

func (c *SessionsController) list(w http.ResponseWriter, r *http.Request) {
	if c.Svc == nil {
		apispec.NotImplemented(w, r, "GET", "/api/v1/sessions")
		return
	}
	filter, err := parseSessionListFilter(r)
	if err != nil {
		envelope.WriteAPIError(w, r, http.StatusBadRequest, "bad_request", "INVALID_QUERY", err.Error(), nil)
		return
	}
	sessions, err := c.Svc.List(r.Context(), filter)
	if err != nil {
		envelope.WriteError(w, r, err)
		return
	}
	envelope.WriteJSON(w, http.StatusOK, ListSessionsResponse{Sessions: sessionViews(sessions)})
}

func (c *SessionsController) spawn(w http.ResponseWriter, r *http.Request) {
	if c.Svc == nil {
		apispec.NotImplemented(w, r, "POST", "/api/v1/sessions")
		return
	}
	// Bound the body before decoding: this route is served on the LAN listener
	// (AO Mobile), not just loopback, and the attachment caps only run after the
	// whole body is decoded. MaxBytesReader stops the read past the limit so an
	// oversized base64 payload can't allocate in full first.
	r.Body = http.MaxBytesReader(w, r.Body, maxSpawnBodyBytes)
	var in SpawnSessionRequest
	if err := decodeJSON(r, &in); err != nil {
		envelope.WriteAPIError(w, r, http.StatusBadRequest, "bad_request", "INVALID_JSON", "Invalid JSON body", nil)
		return
	}
	if in.ProjectID == "" {
		envelope.WriteAPIError(w, r, http.StatusBadRequest, "bad_request", "PROJECT_ID_REQUIRED", "projectId is required", nil)
		return
	}
	mode, err := domain.ParseSessionMode(string(in.Mode))
	if err != nil {
		envelope.WriteAPIError(w, r, http.StatusBadRequest, "validation", "SESSION_MODE_INVALID", err.Error(), nil)
		return
	}
	in.Mode = mode
	if len(in.Prompt) > maxPromptLen {
		envelope.WriteAPIError(w, r, http.StatusBadRequest, "bad_request", "PROMPT_TOO_LONG", "prompt is too long", nil)
		return
	}
	// displayName is optional at the API (the desktop new-task dialog omits it
	// and the read model falls back to the session id). `ao spawn` makes it
	// required CLI-side. When present, it is held to the same length cap here so
	// a direct API call cannot exceed it.
	displayName := strings.TrimSpace(in.DisplayName)
	if utf8.RuneCountInString(displayName) > maxDisplayNameLen {
		envelope.WriteAPIError(w, r, http.StatusBadRequest, "bad_request", "DISPLAY_NAME_TOO_LONG", "displayName must be 20 characters or fewer", nil)
		return
	}
	if in.Kind == "" {
		in.Kind = domain.KindWorker
	}
	attachments, attachErr := decodeSpawnAttachments(in.Attachments)
	if attachErr != nil {
		envelope.WriteAPIError(w, r, http.StatusBadRequest, "bad_request", attachErr.code, attachErr.message, nil)
		return
	}
	sess, promptBytes, systemPromptBytes, err := c.Svc.Spawn(r.Context(), ports.SpawnConfig{ProjectID: in.ProjectID, IssueID: in.IssueID, TrackerProvider: in.TrackerProvider, Kind: in.Kind, Harness: in.Harness, Branch: in.Branch, RequestedMode: in.Mode, Prompt: in.Prompt, DisplayName: displayName, Attachments: attachments, AgentConfig: ports.AgentConfig{Model: in.Model}})
	if err != nil {
		envelope.WriteError(w, r, err)
		return
	}
	envelope.WriteJSON(w, http.StatusCreated, SpawnSessionResponse{Session: sessionView(sess), PromptBytes: promptBytes, SystemPromptBytes: systemPromptBytes})
}

// attachmentError carries a client-facing API error code + message for a
// rejected attachment payload.
type attachmentError struct {
	code    string
	message string
}

// extensionForMimeType returns a file extension for a MIME type. For known
// MIME types, it returns a standard extension. For unknown types, it attempts
// to extract a reasonable extension from the MIME type, or falls back to ".bin".
func extensionForMimeType(mimeType string) string {
	mimeType = strings.ToLower(strings.TrimSpace(mimeType))

	// Preferred extensions for MIME types with multiple options
	preferredExts := map[string]string{
		"image/jpeg": ".jpg",
		"image/jpg":  ".jpg",
		"text/plain": ".txt",
	}

	// Check if we have a preferred extension for this MIME type
	if pref, ok := preferredExts[mimeType]; ok {
		return pref
	}

	// Try the standard mime package
	exts, err := mime.ExtensionsByType(mimeType)
	if err == nil && len(exts) > 0 {
		// Prefer common extensions when available
		for _, ext := range exts {
			switch ext {
			case ".jpg", ".jpeg", ".png", ".gif", ".pdf", ".txt", ".json", ".xml", ".html", ".css", ".js", ".md", ".zip", ".tar", ".gz":
				return ext
			}
		}
		return exts[0] // Return the primary extension if no preferred match
	}

	// Fallback: extract from the MIME type itself
	// e.g., "application/pdf" -> ".pdf", "text/plain" -> ".plain"
	parts := strings.SplitN(mimeType, "/", 2)
	if len(parts) == 2 {
		subtype := parts[1]
		// Handle common suffixes like "+xml", "+json"
		if idx := strings.Index(subtype, "+"); idx >= 0 {
			subtype = subtype[:idx]
		}
		return "." + subtype
	}

	// Ultimate fallback for unknown MIME types
	return ".bin"
}

// decodeAttachment validates and base64-decodes a single inline file
// attachment shared by spawn, delegate, stage, and send requests, enforcing
// the blocked-MIME-type rule and per-file size cap. Callers handling multiple
// attachments are responsible for the count and total-size caps.
func decodeAttachment(a AttachmentInput) (ports.SpawnAttachment, *attachmentError) {
	mimeType := strings.ToLower(strings.TrimSpace(a.MimeType))
	if blockedAttachmentMimes[mimeType] {
		return ports.SpawnAttachment{}, &attachmentError{"UNSUPPORTED_ATTACHMENT_TYPE", "unsupported attachment type"}
	}
	ext := extensionForMimeType(mimeType)
	data, err := base64.StdEncoding.DecodeString(strings.TrimSpace(a.Data))
	if err != nil {
		return ports.SpawnAttachment{}, &attachmentError{"INVALID_ATTACHMENT_DATA", "attachment data is not valid base64"}
	}
	if len(data) == 0 {
		return ports.SpawnAttachment{}, &attachmentError{"INVALID_ATTACHMENT_DATA", "attachment is empty"}
	}
	if len(data) > maxAttachmentBytes {
		return ports.SpawnAttachment{}, &attachmentError{"ATTACHMENT_TOO_LARGE", "attachment is too large"}
	}
	return ports.SpawnAttachment{Ext: ext, Data: data}, nil
}

// decodeSpawnAttachments validates and base64-decodes the inline file
// attachments from a spawn request, enforcing count, per-file, and total size
// caps. It accepts any MIME type except explicitly blocked ones (e.g., SVG
// for security reasons). Returns a nil slice when there are no attachments.
func decodeSpawnAttachments(in []AttachmentInput) ([]ports.SpawnAttachment, *attachmentError) {
	if len(in) == 0 {
		return nil, nil
	}
	if len(in) > maxAttachments {
		return nil, &attachmentError{"TOO_MANY_ATTACHMENTS", "too many attachments"}
	}
	out := make([]ports.SpawnAttachment, 0, len(in))
	total := 0
	for _, a := range in {
		attachment, err := decodeAttachment(a)
		if err != nil {
			return nil, err
		}
		total += len(attachment.Data)
		if total > maxAttachmentsBytes {
			return nil, &attachmentError{"ATTACHMENTS_TOO_LARGE", "attachments are too large"}
		}
		out = append(out, attachment)
	}
	return out, nil
}

func (c *SessionsController) get(w http.ResponseWriter, r *http.Request) {
	if c.Svc == nil {
		apispec.NotImplemented(w, r, "GET", "/api/v1/sessions/{sessionId}")
		return
	}
	sess, err := c.Svc.Get(r.Context(), sessionID(r))
	if err != nil {
		envelope.WriteError(w, r, err)
		return
	}
	envelope.WriteJSON(w, http.StatusOK, SessionResponse{Session: sessionView(sess)})
}

func (c *SessionsController) listWorkspaceFiles(w http.ResponseWriter, r *http.Request) {
	if c.Svc == nil {
		apispec.NotImplemented(w, r, "GET", "/api/v1/sessions/{sessionId}/workspace/files")
		return
	}
	files, err := c.Svc.ListWorkspaceFiles(r.Context(), sessionID(r))
	if err != nil {
		envelope.WriteError(w, r, err)
		return
	}
	envelope.WriteJSON(w, http.StatusOK, workspaceFilesResponse(files))
}

func (c *SessionsController) getWorkspaceFile(w http.ResponseWriter, r *http.Request) {
	if c.Svc == nil {
		apispec.NotImplemented(w, r, "GET", "/api/v1/sessions/{sessionId}/workspace/file")
		return
	}
	relPath := strings.TrimSpace(r.URL.Query().Get("path"))
	if relPath == "" {
		envelope.WriteAPIError(w, r, http.StatusBadRequest, "bad_request", "WORKSPACE_PATH_REQUIRED", "path is required", nil)
		return
	}
	section := sessionsvc.WorkspaceFileSection(strings.TrimSpace(r.URL.Query().Get("section")))
	file, err := c.Svc.GetWorkspaceFile(r.Context(), sessionID(r), relPath, section)
	if err != nil {
		envelope.WriteError(w, r, err)
		return
	}
	envelope.WriteJSON(w, http.StatusOK, workspaceFileResponse(file))
}

// listWorkspaceTree returns one directory level of the session workspace's
// full file tree, git-status decorated. Unlike listWorkspaceFiles (changed
// files only), path is optional: an empty or missing path lists the
// workspace root.
func (c *SessionsController) listWorkspaceTree(w http.ResponseWriter, r *http.Request) {
	if c.Svc == nil {
		apispec.NotImplemented(w, r, "GET", "/api/v1/sessions/{sessionId}/workspace/tree")
		return
	}
	relPath := strings.TrimSpace(r.URL.Query().Get("path"))
	tree, err := c.Svc.ListWorkspaceTree(r.Context(), sessionID(r), relPath)
	if err != nil {
		envelope.WriteError(w, r, err)
		return
	}
	envelope.WriteJSON(w, http.StatusOK, workspaceTreeResponse(tree))
}

// getWorkspaceFileBlob streams one side of an image file's diff. The renderer
// points an <img> straight at this route, so the response is the raw bytes with
// their media type rather than a JSON envelope.
func (c *SessionsController) getWorkspaceFileBlob(w http.ResponseWriter, r *http.Request) {
	if c.Svc == nil {
		apispec.NotImplemented(w, r, "GET", "/api/v1/sessions/{sessionId}/workspace/file/blob")
		return
	}
	relPath := strings.TrimSpace(r.URL.Query().Get("path"))
	if relPath == "" {
		envelope.WriteAPIError(w, r, http.StatusBadRequest, "bad_request", "WORKSPACE_PATH_REQUIRED", "path is required", nil)
		return
	}
	side := sessionsvc.WorkspaceFileBlobSide(strings.TrimSpace(r.URL.Query().Get("side")))
	if side == "" {
		side = sessionsvc.WorkspaceBlobAfter
	}
	blob, err := c.Svc.GetWorkspaceFileBlob(r.Context(), sessionID(r), relPath, side)
	if err != nil {
		envelope.WriteError(w, r, err)
		return
	}
	h := w.Header()
	h.Set("Content-Type", blob.MediaType)
	h.Set("Content-Length", strconv.Itoa(len(blob.Data)))
	// The worktree changes under the viewer, and the URL carries no content
	// hash, so a cached response would show a stale image after every edit.
	h.Set("Cache-Control", "no-store")
	h.Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(blob.Data)
}

func (c *SessionsController) streamWorkspaceChanges(w http.ResponseWriter, r *http.Request) {
	if c.Svc == nil {
		apispec.NotImplemented(w, r, "GET", "/api/v1/sessions/{sessionId}/workspace/events")
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		envelope.WriteAPIError(w, r, http.StatusInternalServerError, "internal", "SSE_UNSUPPORTED", "Streaming is not supported by this server", nil)
		return
	}
	paths, err := c.Svc.WorkspaceWatchPaths(r.Context(), sessionID(r))
	if err != nil {
		envelope.WriteError(w, r, err)
		return
	}
	changes, err := workspacewatch.Watch(r.Context(), paths...)
	if err != nil {
		envelope.WriteError(w, r, err)
		return
	}

	h := w.Header()
	h.Set("Content-Type", "text/event-stream; charset=utf-8")
	h.Set("Cache-Control", "no-cache")
	h.Set("Connection", "keep-alive")
	h.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	keepAlive := time.NewTicker(15 * time.Second)
	defer keepAlive.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case _, ok := <-changes:
			if !ok {
				return
			}
			c.Svc.InvalidateWorkspaceCache(sessionID(r))
			if _, err := fmt.Fprint(w, "event: workspace_changed\ndata: {}\n\n"); err != nil {
				return
			}
			flusher.Flush()
		case <-keepAlive.C:
			if _, err := fmt.Fprint(w, ": keepalive\n\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

func (c *SessionsController) listPRs(w http.ResponseWriter, r *http.Request) {
	if c.Svc == nil {
		apispec.NotImplemented(w, r, "GET", "/api/v1/sessions/{sessionId}/pr")
		return
	}
	prs, err := c.Svc.ListPRSummaries(r.Context(), sessionID(r))
	if err != nil {
		envelope.WriteError(w, r, err)
		return
	}
	envelope.WriteJSON(w, http.StatusOK, ListSessionPRsResponse{SessionID: sessionID(r), PRs: sessionPRSummaries(prs)})
}

func (c *SessionsController) claimPR(w http.ResponseWriter, r *http.Request) {
	if c.Svc == nil {
		apispec.NotImplemented(w, r, "POST", "/api/v1/sessions/{sessionId}/pr/claim")
		return
	}
	var in ClaimPRRequest
	if err := decodeJSON(r, &in); err != nil {
		envelope.WriteAPIError(w, r, http.StatusBadRequest, "bad_request", "INVALID_JSON", "Invalid JSON body", nil)
		return
	}
	if strings.TrimSpace(in.PR) == "" {
		envelope.WriteAPIError(w, r, http.StatusBadRequest, "bad_request", "PR_REQUIRED", "pr is required", nil)
		return
	}
	allowTakeover := true
	if in.AllowTakeover != nil {
		allowTakeover = *in.AllowTakeover
	}
	res, err := c.Svc.ClaimPR(r.Context(), sessionID(r), in.PR, sessionsvc.ClaimPROptions{AllowTakeover: allowTakeover})
	if err != nil {
		writeSessionPRError(w, r, err)
		return
	}
	envelope.WriteJSON(w, http.StatusOK, ClaimPRResponse{OK: true, SessionID: sessionID(r), PRs: sessionPRFacts(res.PRs), BranchChanged: res.BranchChanged, TakenOverFrom: nonNilSessionIDs(res.TakenOverFrom)})
}

func (c *SessionsController) rename(w http.ResponseWriter, r *http.Request) {
	if c.Svc == nil {
		apispec.NotImplemented(w, r, "PATCH", "/api/v1/sessions/{sessionId}")
		return
	}
	var in RenameSessionRequest
	if err := decodeJSON(r, &in); err != nil {
		envelope.WriteAPIError(w, r, http.StatusBadRequest, "bad_request", "INVALID_JSON", "Invalid JSON body", nil)
		return
	}
	displayName := strings.TrimSpace(in.DisplayName)
	if displayName == "" {
		envelope.WriteAPIError(w, r, http.StatusBadRequest, "bad_request", "DISPLAY_NAME_REQUIRED", "displayName is required", nil)
		return
	}
	if err := c.Svc.Rename(r.Context(), sessionID(r), displayName); err != nil {
		envelope.WriteError(w, r, err)
		return
	}
	envelope.WriteJSON(w, http.StatusOK, RenameSessionResponse{OK: true, SessionID: sessionID(r), DisplayName: displayName})
}

func (c *SessionsController) setMergePolicy(w http.ResponseWriter, r *http.Request) {
	if c.Svc == nil {
		apispec.NotImplemented(w, r, "PATCH", "/api/v1/sessions/{sessionId}/merge-policy")
		return
	}
	var in SetSessionMergePolicyRequest
	if err := decodeJSON(r, &in); err != nil {
		envelope.WriteAPIError(w, r, http.StatusBadRequest, "bad_request", "INVALID_JSON", "Invalid JSON body", nil)
		return
	}
	sess, err := c.Svc.SetTerminateOnPRMerge(r.Context(), sessionID(r), in.TerminateOnPRMerge)
	if err != nil {
		envelope.WriteError(w, r, err)
		return
	}
	envelope.WriteJSON(w, http.StatusOK, SetSessionMergePolicyResponse{
		OK:                 true,
		SessionID:          sessionID(r),
		TerminateOnPRMerge: in.TerminateOnPRMerge,
		Session:            sessionView(sess),
	})
}

func (c *SessionsController) setAutoInjectReviewPolicy(w http.ResponseWriter, r *http.Request) {
	if c.Svc == nil {
		apispec.NotImplemented(w, r, "PATCH", "/api/v1/sessions/{sessionId}/auto-inject-review")
		return
	}
	var in SetSessionAutoInjectReviewRequest
	if err := decodeJSON(r, &in); err != nil {
		envelope.WriteAPIError(w, r, http.StatusBadRequest, "bad_request", "INVALID_JSON", "Invalid JSON body", nil)
		return
	}
	sess, err := c.Svc.SetAutoInjectReview(r.Context(), sessionID(r), in.AutoInjectReview)
	if err != nil {
		envelope.WriteError(w, r, err)
		return
	}
	envelope.WriteJSON(w, http.StatusOK, SetSessionAutoInjectReviewResponse{
		OK:               true,
		SessionID:        sessionID(r),
		AutoInjectReview: in.AutoInjectReview,
		Session:          sessionView(sess),
	})
}

func (c *SessionsController) setAutoInjectCIPolicy(w http.ResponseWriter, r *http.Request) {
	if c.Svc == nil {
		apispec.NotImplemented(w, r, "PATCH", "/api/v1/sessions/{sessionId}/auto-inject-ci")
		return
	}
	// Decode through a pointer so an omitted required field remains distinct
	// from the valid explicit value {"autoInjectCI":false}. The public request
	// DTO stays non-pointer so the generated OpenAPI schema remains a required,
	// non-nullable boolean.
	var in struct {
		AutoInjectCI *bool `json:"autoInjectCI"`
	}
	if err := decodeJSON(r, &in); err != nil {
		envelope.WriteAPIError(w, r, http.StatusBadRequest, "bad_request", "INVALID_JSON", "Invalid JSON body", nil)
		return
	}
	if in.AutoInjectCI == nil {
		envelope.WriteAPIError(w, r, http.StatusBadRequest, "bad_request", "AUTO_INJECT_CI_REQUIRED", "autoInjectCI is required", nil)
		return
	}
	autoInjectCI := *in.AutoInjectCI
	sess, err := c.Svc.SetAutoInjectCI(r.Context(), sessionID(r), autoInjectCI)
	if err != nil {
		envelope.WriteError(w, r, err)
		return
	}
	envelope.WriteJSON(w, http.StatusOK, SetSessionAutoInjectCIResponse{
		OK:           true,
		SessionID:    sessionID(r),
		AutoInjectCI: autoInjectCI,
		Session:      sessionView(sess),
	})
}

func (c *SessionsController) setReviewer(w http.ResponseWriter, r *http.Request) {
	if c.Svc == nil {
		apispec.NotImplemented(w, r, "PUT", "/api/v1/sessions/{sessionId}/reviewer")
		return
	}
	var in SetSessionReviewerRequest
	if err := decodeJSON(r, &in); err != nil {
		envelope.WriteAPIError(w, r, http.StatusBadRequest, "bad_request", "INVALID_JSON", "Invalid JSON body", nil)
		return
	}
	sess, err := c.Svc.SetReviewerHarness(r.Context(), sessionID(r), in.Harness, in.AgentConfig)
	if err != nil {
		envelope.WriteError(w, r, err)
		return
	}
	envelope.WriteJSON(w, http.StatusOK, SessionResponse{Session: sessionView(sess)})
}

func (c *SessionsController) setAutoReview(w http.ResponseWriter, r *http.Request) {
	if c.Svc == nil {
		apispec.NotImplemented(w, r, "PUT", "/api/v1/sessions/{sessionId}/auto-review")
		return
	}
	var in SetSessionAutoReviewRequest
	if err := decodeJSON(r, &in); err != nil {
		envelope.WriteAPIError(w, r, http.StatusBadRequest, "bad_request", "INVALID_JSON", "Invalid JSON body", nil)
		return
	}
	if !in.enabledPresent {
		envelope.WriteAPIError(w, r, http.StatusBadRequest, "bad_request", "AUTO_REVIEW_ENABLED_REQUIRED", "enabled is required", nil)
		return
	}
	sess, err := c.Svc.SetAutoReview(r.Context(), sessionID(r), in.Enabled)
	if err != nil {
		envelope.WriteError(w, r, err)
		return
	}
	envelope.WriteJSON(w, http.StatusOK, SessionResponse{Session: sessionView(sess)})
}

func (c *SessionsController) restore(w http.ResponseWriter, r *http.Request) {
	if c.Svc == nil {
		apispec.NotImplemented(w, r, "POST", "/api/v1/sessions/{sessionId}/restore")
		return
	}
	out, err := c.Svc.Restore(r.Context(), sessionID(r))
	if err != nil {
		envelope.WriteError(w, r, err)
		return
	}
	envelope.WriteJSON(w, http.StatusOK, RestoreSessionResponse{OK: true, SessionID: sessionID(r), RestoreMode: out.Mode, Session: sessionView(out.Session)})
}

func (c *SessionsController) pin(w http.ResponseWriter, r *http.Request) {
	if c.Svc == nil {
		apispec.NotImplemented(w, r, "POST", "/api/v1/sessions/{sessionId}/pin")
		return
	}
	sess, err := c.Svc.Pin(r.Context(), sessionID(r))
	if err != nil {
		envelope.WriteError(w, r, err)
		return
	}
	envelope.WriteJSON(w, http.StatusOK, SessionResponse{Session: sessionView(sess)})
}

func (c *SessionsController) unpin(w http.ResponseWriter, r *http.Request) {
	if c.Svc == nil {
		apispec.NotImplemented(w, r, "DELETE", "/api/v1/sessions/{sessionId}/pin")
		return
	}
	sess, err := c.Svc.Unpin(r.Context(), sessionID(r))
	if err != nil {
		envelope.WriteError(w, r, err)
		return
	}
	envelope.WriteJSON(w, http.StatusOK, SessionResponse{Session: sessionView(sess)})
}

func (c *SessionsController) resumeAgent(w http.ResponseWriter, r *http.Request) {
	if c.Svc == nil {
		apispec.NotImplemented(w, r, "POST", "/api/v1/sessions/{sessionId}/resume-agent")
		return
	}
	out, err := c.Svc.ResumeAgent(r.Context(), sessionID(r))
	if err != nil {
		envelope.WriteError(w, r, err)
		return
	}
	envelope.WriteJSON(w, http.StatusOK, ResumeAgentResponse{
		OK:         true,
		SessionID:  sessionID(r),
		ResumeMode: out.Mode,
		Session:    sessionView(out.Session),
	})
}

func (c *SessionsController) exitAgent(w http.ResponseWriter, r *http.Request) {
	if c.Svc == nil {
		apispec.NotImplemented(w, r, "POST", "/api/v1/sessions/{sessionId}/exit-agent")
		return
	}
	out, err := c.Svc.ExitAgent(r.Context(), sessionID(r))
	if err != nil {
		envelope.WriteError(w, r, err)
		return
	}
	envelope.WriteJSON(w, http.StatusOK, ExitAgentResponse{
		OK:        true,
		SessionID: sessionID(r),
		Session:   sessionView(out.Session),
	})
}

func (c *SessionsController) kill(w http.ResponseWriter, r *http.Request) {
	if c.Svc == nil {
		apispec.NotImplemented(w, r, "POST", "/api/v1/sessions/{sessionId}/kill")
		return
	}
	freed, err := c.Svc.Kill(r.Context(), sessionID(r))
	if err != nil {
		envelope.WriteError(w, r, err)
		return
	}
	envelope.WriteJSON(w, http.StatusOK, KillSessionResponse{OK: true, SessionID: sessionID(r), Freed: freed})
}

// rollback undoes a partially-completed spawn: if the session row is still in
// seed state (no workspace, no runtime handle yet), the row is deleted
// outright. If anything observable has landed it falls back to Kill so the
// runtime/workspace are torn down. Used by `ao spawn --claim-pr` to undo a
// session whose claim step failed, avoiding the orphan terminated row a
// plain Kill would leave behind.
func (c *SessionsController) rollback(w http.ResponseWriter, r *http.Request) {
	if c.Svc == nil {
		apispec.NotImplemented(w, r, "POST", "/api/v1/sessions/{sessionId}/rollback")
		return
	}
	out, err := c.Svc.RollbackSpawn(r.Context(), sessionID(r))
	if err != nil {
		envelope.WriteError(w, r, err)
		return
	}
	envelope.WriteJSON(w, http.StatusOK, RollbackSessionResponse{OK: true, SessionID: sessionID(r), Deleted: out.Deleted, Killed: out.Killed})
}

func (c *SessionsController) cleanup(w http.ResponseWriter, r *http.Request) {
	if c.Svc == nil {
		apispec.NotImplemented(w, r, "POST", "/api/v1/sessions/cleanup")
		return
	}
	out, err := c.Svc.Cleanup(r.Context(), domain.ProjectID(r.URL.Query().Get("project")))
	if err != nil {
		envelope.WriteError(w, r, err)
		return
	}
	skipped := make([]CleanupSkippedSession, 0, len(out.Skipped))
	for _, skip := range out.Skipped {
		skipped = append(skipped, CleanupSkippedSession{SessionID: skip.SessionID, Reason: skip.Reason})
	}
	envelope.WriteJSON(w, http.StatusOK, CleanupSessionsResponse{OK: true, Cleaned: out.Cleaned, Skipped: skipped})
}

func (c *SessionsController) send(w http.ResponseWriter, r *http.Request) {
	if c.Svc == nil {
		apispec.NotImplemented(w, r, "POST", "/api/v1/sessions/{sessionId}/send")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxSendBodyBytes)
	var in SendSessionMessageRequest
	if err := decodeJSON(r, &in); err != nil {
		envelope.WriteAPIError(w, r, http.StatusBadRequest, "bad_request", "INVALID_JSON", "Invalid JSON body", nil)
		return
	}
	if in.Message == "" {
		envelope.WriteAPIError(w, r, http.StatusBadRequest, "bad_request", "MESSAGE_REQUIRED", "Message is required", nil)
		return
	}
	if len(in.Message) > maxMessageLen {
		envelope.WriteAPIError(w, r, http.StatusBadRequest, "bad_request", "MESSAGE_TOO_LONG", "Message is too long", nil)
		return
	}
	var attachment *ports.SpawnAttachment
	if in.Attachment != nil {
		decoded, attachErr := decodeAttachment(*in.Attachment)
		if attachErr != nil {
			envelope.WriteAPIError(w, r, http.StatusBadRequest, "bad_request", attachErr.code, attachErr.message, nil)
			return
		}
		attachment = &decoded
	}
	message := domain.SanitizeControlChars(in.Message)
	if err := c.Svc.Send(r.Context(), sessionID(r), message, attachment); err != nil {
		envelope.WriteError(w, r, err)
		return
	}
	envelope.WriteJSON(w, http.StatusOK, SendSessionMessageResponse{OK: true, SessionID: sessionID(r), Message: message})
}

func (c *SessionsController) delegateTask(w http.ResponseWriter, r *http.Request) {
	if c.Svc == nil {
		apispec.NotImplemented(w, r, "POST", "/api/v1/orchestrators/delegate")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxSpawnBodyBytes)
	var in DelegateTaskRequest
	if err := decodeJSON(r, &in); err != nil {
		envelope.WriteAPIError(w, r, http.StatusBadRequest, "bad_request", "INVALID_JSON", "Invalid JSON body", nil)
		return
	}
	if in.ProjectID == "" {
		envelope.WriteAPIError(w, r, http.StatusBadRequest, "bad_request", "PROJECT_ID_REQUIRED", "projectId is required", nil)
		return
	}
	if len(in.Brief) > maxPromptLen {
		envelope.WriteAPIError(w, r, http.StatusBadRequest, "bad_request", "TASK_TOO_LONG", "Task is too long", nil)
		return
	}
	if utf8.RuneCountInString(strings.TrimSpace(in.Model)) > maxModelLen {
		envelope.WriteAPIError(w, r, http.StatusBadRequest, "bad_request", "MODEL_TOO_LONG", "Model must be 256 characters or fewer", nil)
		return
	}
	if in.Mode != "" {
		mode, err := domain.ParseSessionMode(string(in.Mode))
		if err != nil {
			envelope.WriteAPIError(w, r, http.StatusBadRequest, "bad_request", "INVALID_SESSION_MODE", "mode must be chat or tui", nil)
			return
		}
		in.Mode = mode
	}
	if !in.ApprovalMode.Valid() {
		envelope.WriteAPIError(w, r, http.StatusBadRequest, "bad_request", "INVALID_APPROVAL_MODE", "approvalMode is invalid", nil)
		return
	}
	attachments, attachErr := decodeSpawnAttachments(in.Attachments)
	if attachErr != nil {
		envelope.WriteAPIError(w, r, http.StatusBadRequest, "bad_request", attachErr.code, attachErr.message, nil)
		return
	}

	out, err := c.Svc.DelegateTask(r.Context(), sessionsvc.DelegateTaskInput{
		ProjectID:      in.ProjectID,
		Brief:          domain.SanitizeControlChars(in.Brief),
		RequestedAgent: in.Agent,
		Model:          domain.SanitizeControlChars(strings.TrimSpace(in.Model)),
		ApprovalMode:   in.ApprovalMode,
		RequestedMode:  in.Mode,
		Attachments:    attachments,
	})
	if err != nil {
		envelope.WriteError(w, r, err)
		return
	}
	envelope.WriteJSON(w, http.StatusAccepted, DelegateTaskResponse{OK: true, WorkerID: out.WorkerID, OrchestratorID: out.OrchestratorID})
}

// activity records an agent activity-state signal reported by an agent hook
// (via `ao hooks <agent> <event>`). It funnels through the single
// lifecycle.Manager so the reaper and hooks never race on the session's
// activity/termination columns.
func (c *SessionsController) activity(w http.ResponseWriter, r *http.Request) {
	if c.Activity == nil {
		apispec.NotImplemented(w, r, "POST", "/api/v1/sessions/{sessionId}/activity")
		return
	}
	var in SetActivityRequest
	if err := decodeJSON(r, &in); err != nil {
		envelope.WriteAPIError(w, r, http.StatusBadRequest, "bad_request", "INVALID_JSON", "Invalid JSON body", nil)
		return
	}
	state := domain.ActivityState(in.State)
	if state != "" {
		switch state {
		case domain.ActivityActive, domain.ActivityIdle, domain.ActivityWaitingInput, domain.ActivityBlocked, domain.ActivityExited:
		default:
			envelope.WriteAPIError(w, r, http.StatusBadRequest, "bad_request", "INVALID_ACTIVITY_STATE", "Unknown activity state", nil)
			return
		}
	}
	agentSessionID := capActivityMeta(domain.SanitizeControlChars(strings.TrimSpace(in.AgentSessionID)))
	if state == "" && agentSessionID == "" {
		envelope.WriteAPIError(w, r, http.StatusBadRequest, "bad_request", "ACTIVITY_OR_SESSION_ID_REQUIRED", "Activity state or agent session ID is required", nil)
		return
	}
	// The correlation fields ride the same lenient decode: absent on old CLIs.
	// They are externally-supplied strings headed for logs and in-memory maps,
	// so sanitize control chars and cap their length (a truncated id could
	// never match its pre/post counterpart, so overlong values are dropped by
	// the CLI; the cap here is defense against non-AO callers).
	sig := ports.ActivitySignal{
		Valid:                 state != "",
		State:                 state,
		Event:                 capActivityMeta(domain.SanitizeControlChars(in.Event)),
		ToolName:              capActivityMeta(domain.SanitizeControlChars(in.ToolName)),
		ToolUseID:             capActivityMeta(domain.SanitizeControlChars(in.ToolUseID)),
		AgentSessionID:        agentSessionID,
		LatestUserPrompt:      capActivityText(domain.SanitizeControlChars(strings.TrimSpace(in.LatestUserPrompt)), 16<<10),
		LatestAssistantUpdate: capActivityText(domain.SanitizeControlChars(strings.TrimSpace(in.LatestAssistantUpdate)), 16<<10),
		TranscriptPath:        capActivityText(domain.SanitizeControlChars(strings.TrimSpace(in.TranscriptPath)), 4096),
		LaunchID:              capActivityMeta(domain.SanitizeControlChars(strings.TrimSpace(in.LaunchID))),
	}
	if c.Activity != nil && (sig.Valid || sig.AgentSessionID != "") {
		if err := c.Activity.ApplyActivitySignal(r.Context(), sessionID(r), sig); err != nil {
			if errors.Is(err, ports.ErrSessionNotFound) {
				envelope.WriteAPIError(w, r, http.StatusNotFound, "not_found", "SESSION_NOT_FOUND", "Unknown session", nil)
				return
			}
			envelope.WriteError(w, r, err)
			return
		}
	}
	envelope.WriteJSON(w, http.StatusOK, SetActivityResponse{OK: true, SessionID: sessionID(r), State: in.State})
}

// capActivityMeta bounds an optional activity correlation string; overlong
// values are dropped, not truncated (see the comment at its call site).
func capActivityMeta(v string) string {
	const maxLen = 256
	if len(v) > maxLen {
		return ""
	}
	return v
}

func capActivityText(v string, maxLen int) string {
	if maxLen <= 0 || len(v) <= maxLen {
		return v
	}
	const marker = "\n[... truncated by AO ...]\n"
	budget := maxLen - len(marker)
	if budget <= 0 {
		return ""
	}
	head := budget / 2
	tail := budget - head
	return strings.ToValidUTF8(string([]byte(v)[:head])+marker+string([]byte(v)[len(v)-tail:]), "?")
}

func (c *SessionsController) spawnOrchestrator(w http.ResponseWriter, r *http.Request) {
	if c.Svc == nil {
		apispec.NotImplemented(w, r, "POST", "/api/v1/orchestrators")
		return
	}
	var in SpawnOrchestratorRequest
	if err := decodeJSON(r, &in); err != nil {
		envelope.WriteAPIError(w, r, http.StatusBadRequest, "bad_request", "INVALID_JSON", "Invalid JSON body", nil)
		return
	}
	if in.ProjectID == "" {
		envelope.WriteAPIError(w, r, http.StatusBadRequest, "bad_request", "PROJECT_ID_REQUIRED", "projectId is required", nil)
		return
	}
	if in.Mode != "" {
		if _, err := domain.ParseSessionMode(string(in.Mode)); err != nil {
			envelope.WriteAPIError(w, r, http.StatusBadRequest, "validation", "SESSION_MODE_INVALID", err.Error(), nil)
			return
		}
	}
	sess, err := c.Svc.SpawnOrchestrator(r.Context(), in.ProjectID, in.Clean, in.Mode)
	if err != nil {
		envelope.WriteError(w, r, err)
		return
	}
	envelope.WriteJSON(w, http.StatusCreated, SpawnOrchestratorResponse{
		Orchestrator: OrchestratorResponse{ID: sess.ID, ProjectID: sess.ProjectID},
	})
}

func (c *SessionsController) listOrchestrators(w http.ResponseWriter, r *http.Request) {
	if c.Svc == nil {
		apispec.NotImplemented(w, r, "GET", "/api/v1/orchestrators")
		return
	}
	sessions, err := c.Svc.List(r.Context(), sessionsvc.ListFilter{OrchestratorOnly: true})
	if err != nil {
		envelope.WriteError(w, r, err)
		return
	}
	envelope.WriteJSON(w, http.StatusOK, ListSessionsResponse{Sessions: sessionViews(sessions)})
}

func (c *SessionsController) getOrchestrator(w http.ResponseWriter, r *http.Request) {
	if c.Svc == nil {
		apispec.NotImplemented(w, r, "GET", "/api/v1/orchestrators/{id}")
		return
	}
	sess, err := c.Svc.Get(r.Context(), orchestratorID(r))
	if err != nil {
		envelope.WriteError(w, r, err)
		return
	}
	if sess.Kind != domain.KindOrchestrator {
		envelope.WriteAPIError(w, r, http.StatusNotFound, "not_found", "SESSION_NOT_FOUND", "Unknown session", nil)
		return
	}
	envelope.WriteJSON(w, http.StatusOK, SessionResponse{Session: sessionView(sess)})
}

func sessionID(r *http.Request) domain.SessionID {
	return domain.SessionID(chi.URLParam(r, "sessionId"))
}

func orchestratorID(r *http.Request) domain.SessionID {
	return domain.SessionID(chi.URLParam(r, "id"))
}

func parseSessionListFilter(r *http.Request) (sessionsvc.ListFilter, error) {
	q := r.URL.Query()
	filter := sessionsvc.ListFilter{ProjectID: domain.ProjectID(q.Get("project"))}
	if raw := q.Get("active"); raw != "" {
		active, err := strconv.ParseBool(raw)
		if err != nil {
			return sessionsvc.ListFilter{}, errors.New("active must be a boolean")
		}
		filter.Active = &active
	}
	if raw := q.Get("orchestratorOnly"); raw != "" {
		orchestratorOnly, err := strconv.ParseBool(raw)
		if err != nil {
			return sessionsvc.ListFilter{}, errors.New("orchestratorOnly must be a boolean")
		}
		filter.OrchestratorOnly = orchestratorOnly
	}
	if raw := q.Get("fresh"); raw != "" {
		fresh, err := strconv.ParseBool(raw)
		if err != nil {
			return sessionsvc.ListFilter{}, errors.New("fresh must be a boolean")
		}
		filter.Fresh = fresh
	}
	return filter, nil
}

func writeSessionPRError(w http.ResponseWriter, r *http.Request, err error) {
	var claimed ports.PRClaimedByActiveSessionError
	switch {
	case errors.Is(err, sessionsvc.ErrInvalidPRRef):
		envelope.WriteAPIError(w, r, http.StatusBadRequest, "bad_request", "INVALID_PR_REF", "PR reference must be a PR/MR URL or a number", nil)
	case errors.Is(err, sessionsvc.ErrPRNotFound):
		envelope.WriteAPIError(w, r, http.StatusNotFound, "not_found", "PR_NOT_FOUND", "Unknown PR", nil)
	case errors.Is(err, sessionsvc.ErrPRNotOpen):
		envelope.WriteAPIError(w, r, http.StatusConflict, "conflict", "PR_NOT_OPEN", "PR is not open", nil)
	case errors.As(err, &claimed):
		envelope.WriteAPIError(w, r, http.StatusConflict, "conflict", "PR_CLAIMED_BY_ACTIVE_SESSION", "PR is already claimed by active session "+string(claimed.Owner)+" (omit --no-takeover to steal)", map[string]any{"ownerSessionId": string(claimed.Owner)})
	case errors.Is(err, sessionsvc.ErrSessionNotClaimable):
		envelope.WriteAPIError(w, r, http.StatusUnprocessableEntity, "unprocessable", "SESSION_NOT_CLAIMABLE", "Session cannot claim PRs", nil)
	case errors.Is(err, sessionsvc.ErrSessionNoWorkspace):
		envelope.WriteAPIError(w, r, http.StatusUnprocessableEntity, "unprocessable", "SESSION_NO_WORKSPACE", "Session has no workspace", nil)
	case errors.Is(err, sessionsvc.ErrProjectMismatch):
		envelope.WriteAPIError(w, r, http.StatusUnprocessableEntity, "unprocessable", "PR_PROJECT_MISMATCH", "PR does not belong to the session project", nil)
	case errors.Is(err, sessionsvc.ErrSCMUnavailable):
		envelope.WriteAPIError(w, r, http.StatusServiceUnavailable, "unavailable", "SCM_UNAVAILABLE", "SCM unavailable", nil)
	default:
		envelope.WriteError(w, r, err)
	}
}

func sessionView(s domain.Session) SessionView {
	terminalGeneration := s.Metadata.RuntimeLaunchID
	view := SessionView{
		Session:            s,
		Branch:             s.Metadata.Branch,
		TerminalGeneration: terminalGeneration,
		PreviewURL:         s.Metadata.PreviewURL,
		PreviewRevision:    s.Metadata.PreviewRevision,
		Model:              s.Metadata.Model,
		LastUserMessageAt: func() *time.Time {
			if s.Metadata.LatestUserPromptAt.IsZero() {
				return nil
			}
			at := s.Metadata.LatestUserPromptAt
			return &at
		}(),
		PRs: sessionPRFacts(s.PRs),
	}
	return view
}

func sessionViews(sessions []domain.Session) []SessionView {
	out := make([]SessionView, 0, len(sessions))
	for _, s := range sessions {
		out = append(out, sessionView(s))
	}
	return out
}

func sessionPRFacts(prs []domain.PRFacts) []SessionPRFacts {
	out := make([]SessionPRFacts, 0, len(prs))
	for _, pr := range prs {
		out = append(out, SessionPRFacts{URL: pr.URL, Number: pr.Number, State: prState(pr), CI: pr.CI, Review: pr.Review, Mergeability: pr.Mergeability, ReviewComments: pr.ReviewComments, UpdatedAt: pr.UpdatedAt})
	}
	return out
}

func sessionPRSummaries(prs []sessionsvc.PRSummary) []SessionPRSummary {
	out := make([]SessionPRSummary, 0, len(prs))
	for _, pr := range prs {
		out = append(out, NewSessionPRSummary(pr))
	}
	return out
}

func workspaceFilesResponse(files sessionsvc.WorkspaceFiles) ListWorkspaceFilesResponse {
	return ListWorkspaceFilesResponse{
		SessionID:      files.SessionID,
		CompareBaseSHA: files.CompareBaseSHA,
		CompareBaseRef: files.CompareBaseRef,
		CompareMode:    files.CompareMode,
		Files:          workspaceFileSummariesResponse(files.Files),
		Truncated:      files.Truncated,
		Sections:       workspaceFileSectionsResponse(files.Sections),
		Commits:        workspaceCommitsResponse(files.Commits),
		Summary:        WorkspaceSummary(files.Summary),
		Ahead:          files.Ahead,
		Behind:         files.Behind,
	}
}

func workspaceFileSummaryResponse(file sessionsvc.WorkspaceFileSummary) WorkspaceFileSummary {
	return WorkspaceFileSummary{
		Path:         file.Path,
		PreviousPath: file.PreviousPath,
		Status:       file.Status,
		Additions:    file.Additions,
		Deletions:    file.Deletions,
		Size:         file.Size,
		Binary:       file.Binary,
	}
}

func workspaceFileSummariesResponse(files []sessionsvc.WorkspaceFileSummary) []WorkspaceFileSummary {
	out := make([]WorkspaceFileSummary, 0, len(files))
	for _, file := range files {
		out = append(out, workspaceFileSummaryResponse(file))
	}
	return out
}

func workspaceFileSectionsResponse(sections sessionsvc.WorkspaceFileSections) WorkspaceFileSections {
	return WorkspaceFileSections{
		Staged:    workspaceFileSummariesResponse(sections.Staged),
		Unstaged:  workspaceFileSummariesResponse(sections.Unstaged),
		Untracked: workspaceFileSummariesResponse(sections.Untracked),
		Committed: workspaceFileSummariesResponse(sections.Committed),
	}
}

func workspaceCommitsResponse(commits []sessionsvc.CommitSummary) []WorkspaceCommitSummary {
	out := make([]WorkspaceCommitSummary, 0, len(commits))
	for _, commit := range commits {
		out = append(out, WorkspaceCommitSummary{
			SHA:       commit.SHA,
			Subject:   commit.Subject,
			Author:    commit.Author,
			Timestamp: commit.Timestamp,
		})
	}
	return out
}

func workspaceFileResponse(file sessionsvc.WorkspaceFileDetail) WorkspaceFileResponse {
	return WorkspaceFileResponse{
		SessionID:        file.SessionID,
		Path:             file.Path,
		PreviousPath:     file.PreviousPath,
		Status:           file.Status,
		Additions:        file.Additions,
		Deletions:        file.Deletions,
		Size:             file.Size,
		Binary:           file.Binary,
		Deleted:          file.Deleted,
		ImageMediaType:   file.ImageMediaType,
		Content:          file.Content,
		ContentTruncated: file.ContentTruncated,
		Diff:             file.Diff,
		DiffTruncated:    file.DiffTruncated,
		CompareBaseSHA:   file.CompareBaseSHA,
		CompareBaseRef:   file.CompareBaseRef,
		CompareMode:      file.CompareMode,
	}
}

func workspaceTreeResponse(tree sessionsvc.WorkspaceTree) ListWorkspaceTreeResponse {
	out := make([]WorkspaceTreeEntry, 0, len(tree.Entries))
	for _, entry := range tree.Entries {
		out = append(out, WorkspaceTreeEntry{
			Name:       entry.Name,
			Path:       entry.Path,
			Type:       entry.Type,
			Status:     entry.Status,
			HasChanges: entry.HasChanges,
			Size:       entry.Size,
			Binary:     entry.Binary,
		})
	}
	return ListWorkspaceTreeResponse{
		SessionID: tree.SessionID,
		Path:      tree.Path,
		Entries:   out,
		Truncated: tree.Truncated,
	}
}

func prState(pr domain.PRFacts) string {
	switch {
	case pr.Merged:
		return string(domain.PRStateMerged)
	case pr.Closed:
		return string(domain.PRStateClosed)
	case pr.Draft:
		return string(domain.PRStateDraft)
	default:
		return string(domain.PRStateOpen)
	}
}

func nonNilSessionIDs(ids []domain.SessionID) []domain.SessionID {
	if ids == nil {
		return []domain.SessionID{}
	}
	return ids
}
