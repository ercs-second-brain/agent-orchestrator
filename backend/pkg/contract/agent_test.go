package contract_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"slices"
	"testing"

	"github.com/ercs-second-brain/agent-orchestrator/backend/pkg/contract"
)

var agentCapabilities = []contract.AgentCapability{
	contract.CapabilityInterfaceTUI,
	contract.CapabilityModelCatalog,
	contract.CapabilityCustomModel,
	contract.CapabilityAttachments,
	contract.CapabilityReviewExecute,
	contract.CapabilityResume,
}

func TestHasAgentCapability(t *testing.T) {
	profile := contract.AgentProfile{
		Capabilities: []contract.AgentCapability{
			contract.CapabilityInterfaceTUI,
			contract.CapabilityResume,
		},
	}

	if !contract.HasAgentCapability(profile, contract.CapabilityResume) {
		t.Fatal("resume capability was not found")
	}
	if contract.HasAgentCapability(profile, contract.CapabilityAttachments) {
		t.Fatal("undeclared attachment capability was found")
	}
}

func TestAgentProfileJSONKeepsPolicyInAvailability(t *testing.T) {
	profile := contract.AgentProfile{
		ID:           "runtime-agent",
		Label:        "Runtime Agent",
		Capabilities: []contract.AgentCapability{contract.CapabilityInterfaceTUI},
		Availability: contract.AgentAvailability{
			Available:          false,
			Installation:       contract.AgentInstallationInstalled,
			Authentication:     contract.AgentAuthenticationUnauthorized,
			OrganizationPolicy: contract.OrganizationPolicyDenied,
			Reason:             "Disabled for this organization.",
		},
	}

	data, err := json.Marshal(profile)
	if err != nil {
		t.Fatal(err)
	}

	var value map[string]any
	if err := json.Unmarshal(data, &value); err != nil {
		t.Fatal(err)
	}
	if _, ok := value["organizationPolicy"]; ok {
		t.Fatal("organization policy must not be an intrinsic profile field")
	}
	availability, ok := value["availability"].(map[string]any)
	if !ok ||
		availability["installation"] != "installed" ||
		availability["authentication"] != "unauthorized" ||
		availability["organizationPolicy"] != "denied" {
		t.Fatalf("availability = %#v", value["availability"])
	}
}

func agentCapabilityStrings() []string {
	out := make([]string, len(agentCapabilities))
	for i, capability := range agentCapabilities {
		out[i] = string(capability)
	}
	return out
}

func TestSharedAgentVocabulariesMatchProductUI(t *testing.T) {
	_, currentFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("locate test file")
	}
	repoRoot := filepath.Join(filepath.Dir(currentFile), "..", "..", "..")

	productPath := filepath.Join(repoRoot, "packages", "product-ui", "src", "agent-capabilities.ts")
	data, err := os.ReadFile(productPath)
	if err != nil {
		t.Fatal(err)
	}

	checks := []struct {
		productConst string
		want         []string
	}{
		{"AGENT_CAPABILITIES", agentCapabilityStrings()},
		{
			"AGENT_INSTALLATION_STATES",
			[]string{
				string(contract.AgentInstallationInstalled),
				string(contract.AgentInstallationNotInstalled),
				string(contract.AgentInstallationUnknown),
				string(contract.AgentInstallationNotApplicable),
			},
		},
		{
			"AGENT_AUTHENTICATION_STATES",
			[]string{
				string(contract.AgentAuthenticationAuthorized),
				string(contract.AgentAuthenticationUnauthorized),
				string(contract.AgentAuthenticationUnknown),
				string(contract.AgentAuthenticationNotApplicable),
			},
		},
	}

	for _, check := range checks {
		t.Run(check.productConst, func(t *testing.T) {
			pattern := `(?s)` + regexp.QuoteMeta(check.productConst) + ` = \[(.*?)\] as const`
			block := regexp.MustCompile(pattern).FindSubmatch(data)
			if len(block) != 2 {
				t.Fatalf("product UI has no %s array", check.productConst)
			}
			matches := regexp.MustCompile(`"([^"]+)"`).FindAllSubmatch(block[1], -1)
			got := make([]string, len(matches))
			for i, match := range matches {
				got[i] = string(match[1])
			}
			if !slices.Equal(got, check.want) {
				t.Fatalf("product UI %s = %q, want %q", check.productConst, got, check.want)
			}
		})
	}
}
