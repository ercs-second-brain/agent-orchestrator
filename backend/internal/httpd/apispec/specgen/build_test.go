package specgen_test

import (
	"bytes"
	"slices"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"

	"github.com/ercs-second-brain/agent-orchestrator/backend/internal/httpd/apispec"
	"github.com/ercs-second-brain/agent-orchestrator/backend/internal/httpd/apispec/specgen"
)

type openAPISchemaNode struct {
	Ref        string                       `yaml:"$ref"`
	Type       any                          `yaml:"type"`
	Format     string                       `yaml:"format"`
	Enum       []string                     `yaml:"enum"`
	Required   []string                     `yaml:"required"`
	Properties map[string]openAPISchemaNode `yaml:"properties"`
	AnyOf      []openAPISchemaNode          `yaml:"anyOf"`
	OneOf      []openAPISchemaNode          `yaml:"oneOf"`
}

// TestBuild_MatchesEmbedded is the drift guard: the committed (embedded)
// openapi.yaml must equal fresh Build() output. If this fails, run
// `go generate ./...` and commit the result.
func TestBuild_MatchesEmbedded(t *testing.T) {
	got, err := specgen.Build()
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	embedded := apispec.Default().YAML()
	if !bytes.Equal(normalizeYAML(got), normalizeYAML(embedded)) {
		t.Fatalf("embedded openapi.yaml is stale — run `go generate ./...` and commit.\n"+
			"len(fresh)=%d len(embedded)=%d", len(got), len(embedded))
	}
}

func TestBuild_InstallJobTargetRemainsAnEnum(t *testing.T) {
	got, err := specgen.Build()
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	var doc struct {
		Components struct {
			Schemas map[string]openAPISchemaNode `yaml:"schemas"`
		} `yaml:"components"`
	}
	if err := yaml.Unmarshal(got, &doc); err != nil {
		t.Fatalf("parse generated OpenAPI: %v", err)
	}
	targets := doc.Components.Schemas["InstallJob"].Properties["target"].Enum
	for _, target := range []string{"tmux", "cloudflared", "pi"} {
		if !slices.Contains(targets, target) {
			t.Fatalf("InstallJob.target enum = %v, missing %q", targets, target)
		}
	}
	for _, removed := range []string{"cursor", "prime-agent", "codex"} {
		if slices.Contains(targets, removed) {
			t.Fatalf("InstallJob.target enum = %v, legacy target %q must be gone", targets, removed)
		}
	}
}

func TestBuild_SpawnHarnessEnumIncludesPrimeAgent(t *testing.T) {
	got, err := specgen.Build()
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	if !strings.Contains(string(got), "          - pi\n") {
		t.Fatal("SpawnSessionRequest harness enum does not contain pi")
	}
}

func TestBuild_DelegateAgentEnumIncludesPrimeAgent(t *testing.T) {
	got, err := specgen.Build()
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	var doc struct {
		Components struct {
			Schemas map[string]struct {
				Properties map[string]struct {
					Enum []string `yaml:"enum"`
				} `yaml:"properties"`
			} `yaml:"schemas"`
		} `yaml:"components"`
	}
	if err := yaml.Unmarshal(got, &doc); err != nil {
		t.Fatalf("parse generated OpenAPI: %v", err)
	}
	agents := doc.Components.Schemas["DelegateTaskRequest"].Properties["agent"].Enum
	if !slices.Contains(agents, "pi") {
		t.Fatalf("DelegateTaskRequest agent enum = %v, want pi", agents)
	}
}

func TestBuild_OMPIsPubliclySpawnable(t *testing.T) {
	doc := buildSchemas(t)
	harnesses := doc.Components.Schemas["SpawnSessionRequest"].Properties["harness"].Enum
	if !slices.Contains(harnesses, "pi") {
		t.Fatalf("SpawnSessionRequest harness enum = %v, want pi", harnesses)
	}
}

func TestBuild_OMPIsPubliclyDelegatable(t *testing.T) {
	doc := buildSchemas(t)
	agents := doc.Components.Schemas["DelegateTaskRequest"].Properties["agent"].Enum
	if !slices.Contains(agents, "pi") {
		t.Fatalf("DelegateTaskRequest agent enum = %v, want pi", agents)
	}
}

type schemaDocument struct {
	Components struct {
		Schemas map[string]struct {
			Properties map[string]struct {
				Enum []string `yaml:"enum"`
			} `yaml:"properties"`
		} `yaml:"schemas"`
	} `yaml:"components"`
}

func buildSchemas(t *testing.T) schemaDocument {
	t.Helper()
	got, err := specgen.Build()
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	var doc schemaDocument
	if err := yaml.Unmarshal(got, &doc); err != nil {
		t.Fatalf("parse generated OpenAPI: %v", err)
	}
	return doc
}

// TestBuild_Deterministic guards against nondeterministic output (which would
// make the drift check flaky in CI).
func TestBuild_Deterministic(t *testing.T) {
	a, err := specgen.Build()
	if err != nil {
		t.Fatalf("Build #1: %v", err)
	}
	b, err := specgen.Build()
	if err != nil {
		t.Fatalf("Build #2: %v", err)
	}
	if !bytes.Equal(a, b) {
		t.Fatal("Build() is not deterministic across calls")
	}
}

func normalizeYAML(in []byte) []byte {
	return bytes.ReplaceAll(in, []byte("\r\n"), []byte("\n"))
}
