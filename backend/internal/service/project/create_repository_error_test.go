package project

import (
	"errors"
	"testing"

	"github.com/ercs-second-brain/agent-orchestrator/backend/internal/httpd/apierr"
)

func TestHostedRepositoryCreateError_ClassifiesGhFailures(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		out  string
		code string
	}{
		{name: "missing read:org", out: "HTTP 403: missing required scopes: read:org", code: "GH_AUTH_SCOPES"},
		{name: "not logged in", out: "To get started with GitHub CLI, please run: gh auth login", code: "GH_AUTH_REQUIRED"},
		{name: "name taken", out: "HTTP 422: name already exists on this account", code: "REPOSITORY_CREATE_EXISTS"},
		{name: "generic", out: "GraphQL: Resource not accessible by personal access token", code: "REPOSITORY_CREATE_FAILED"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var e *apierr.Error
			err := hostedRepositoryCreateError(tc.out)
			if !errors.As(err, &e) {
				t.Fatalf("error = %v, want *apierr.Error", err)
			}
			if e.Code != tc.code {
				t.Fatalf("code = %q, want %q", e.Code, tc.code)
			}
		})
	}
}
