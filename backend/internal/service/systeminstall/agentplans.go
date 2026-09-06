package systeminstall

import (
	"context"
	"fmt"

	"github.com/ercs-second-brain/agent-orchestrator/backend/internal/ports"
)

// agentDocumentationURLs is indexed by Target; since ADR 0005 pi is the only
// user-facing harness install target.
var agentDocumentationURLs = map[Target]string{
	TargetPi: "https://github.com/earendil-works/pi",
}

func (s requestPlanner) agentMethodPlans(target Target, operation AgentOperation) []Plan {
	var plans []Plan
	switch target {
	case TargetPi:
		plans = []Plan{s.planNPM(target, "@earendil-works/pi-coding-agent")}
		if s.goos == "darwin" || s.goos == "linux" {
			plans = append(plans, s.planPiOfficialInstaller())
		}
	default:
		plans = []Plan{{Target: target, Unsupported: true, Method: "manual", Reason: "unknown install target"}}
	}
	for index := range plans {
		plans[index].DocsURL = agentDocumentationURLs[target]
		plans[index] = s.planForOperation(plans[index], operation)
	}
	return plans
}

func (s *Service) resolveAgentMethod(target Target, method string) (Plan, error) {
	planner, err := s.newRequestPlanner(context.Background())
	if err != nil {
		return Plan{}, err
	}
	return planner.resolveAgentMethod(target, method, AgentOperationInstall)
}

func (s requestPlanner) resolveAgentMethod(target Target, method string, operation AgentOperation) (Plan, error) {
	for _, plan := range s.agentMethodPlans(target, operation) {
		if plan.Method != method {
			continue
		}
		if plan.Unsupported {
			return Plan{}, fmt.Errorf("%w: install method %q is not available: %s", ErrInstallMethod, method, plan.Reason)
		}
		return plan, nil
	}
	return Plan{}, fmt.Errorf("%w: unknown install method %q for %s", ErrInstallMethod, method, target)
}

func (s requestPlanner) planPiOfficialInstaller() Plan {
	plan := s.planShellInstaller(TargetPi, "https://pi.dev/install.sh", "sh")
	if plan.Unsupported {
		return plan
	}
	if s.capabilities == nil {
		plan.Unsupported = true
		plan.Reason = "Node.js 22.19+ and npm could not be inspected; Pi's installer cannot repair them without a terminal."
		return plan
	}
	nodeVersion, nodeOK := parseToolVersion(s.capabilities.NPM.NodeVersion)
	if !nodeOK || !versionAtLeast(nodeVersion, minimumNodeVersionForTarget(TargetPi)) {
		plan.Unsupported = true
		plan.Reason = "Node.js 22.19+ is required before Pi's installer can run headlessly."
		return plan
	}
	if _, npmOK := parseToolVersion(s.capabilities.NPM.NPMVersion); !npmOK {
		plan.Unsupported = true
		plan.Reason = "npm is required before Pi's installer can run headlessly."
	}
	return plan
}

func (s requestPlanner) planForOperation(plan Plan, operation AgentOperation) Plan {
	if operation == AgentOperationInstall || plan.Unsupported {
		return plan
	}
	switch plan.Method {
	case "homebrew":
		// planHomebrew already chooses install when another manager owns the
		// harness and reinstall when the formula/cask itself is present.
	case "npm":
		plan.Command = append(plan.Command, "--force")
	case "winget":
		plan.Command = append(plan.Command, "--force")
	case "uv":
		pkg := plan.Command[len(plan.Command)-1]
		plan.Command = []string{"uv", "tool", "install", pkg, "--force", "--reinstall"}
	case "pipx":
		pkg := plan.Command[len(plan.Command)-1]
		plan.Command = []string{"pipx", "install", "--force", pkg}
	case "bun":
		plan.Command = append(plan.Command, "--force")
	case "official-installer":
		plan.Unsupported = true
		plan.Command = nil
		plan.Script = nil
		plan.Reason = "This vendor installer does not provide a verified headless reinstall operation."
	default:
		plan.Unsupported = true
		plan.Reason = "This installation method does not provide an explicit reinstall operation."
	}
	return plan
}

// planAgent preserves the legacy single-plan call sites while selecting from
// the same method registry used by the catalog and execution route.
func (s *Service) planAgent(target Target) Plan {
	planner, err := s.newRequestPlanner(context.Background())
	if err != nil {
		return Plan{Target: target, Unsupported: true, Method: "manual", Reason: "install capabilities could not be inspected", DocsURL: agentDocumentationURLs[target]}
	}
	plans := planner.agentMethodPlans(target, AgentOperationInstall)
	return plans[recommendedPlanIndex(plans)]
}

func (s *Service) officialByOS(target Target, unixURL, unixShell, windowsURL, docsURL string) Plan {
	switch s.goos {
	case "windows":
		return withDocs(s.planPowerShellInstaller(target, windowsURL), docsURL)
	case "darwin", "linux":
		return withDocs(s.planShellInstaller(target, unixURL, unixShell), docsURL)
	default:
		return manualPlan(target, fmt.Sprintf("The official installer does not support %s.", s.goos), docsURL)
	}
}

func (s *Service) planShellInstaller(target Target, url, shell string) Plan {
	resolved, err := s.executables.LookPath(shell)
	if err != nil {
		return Plan{Target: target, Unsupported: true, Method: "official-installer", Reason: fmt.Sprintf("%s was not found on PATH.", shell)}
	}
	return Plan{
		Target: target, Method: "official-installer",
		Script: &ports.InstallScriptCommand{URL: url, Interpreter: []string{resolved}},
	}
}

func (s *Service) planPowerShellInstaller(target Target, url string) Plan {
	for _, shell := range []string{"pwsh.exe", "powershell.exe", "pwsh", "powershell"} {
		resolved, err := s.executables.LookPath(shell)
		if err != nil {
			continue
		}
		return Plan{
			Target: target, Method: "official-installer",
			Script: &ports.InstallScriptCommand{
				URL:         url,
				Interpreter: []string{resolved, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"},
			},
		}
	}
	return Plan{Target: target, Unsupported: true, Method: "official-installer", Reason: "PowerShell was not found on PATH."}
}

func manualPlan(target Target, reason, docsURL string) Plan {
	return Plan{Target: target, Unsupported: true, Method: "manual", Reason: reason, DocsURL: docsURL}
}
