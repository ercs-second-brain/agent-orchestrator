package systeminstall

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/ercs-second-brain/agent-orchestrator/backend/internal/ports"
)

type installCapabilitiesStub struct {
	prefix            string
	prefixErr         error
	nodeVersion       string
	npmVersion        string
	homebrewPrefix    string
	homebrewErr       error
	homebrewInstalled bool
	writable          bool
	calls             *int
	probe             func(context.Context) error
}

func (s installCapabilitiesStub) Probe(ctx context.Context) (ports.InstallCapabilities, error) {
	if s.calls != nil {
		(*s.calls)++
	}
	if s.probe != nil {
		if err := s.probe(ctx); err != nil {
			return ports.InstallCapabilities{}, err
		}
	}
	nodeVersion := s.nodeVersion
	if nodeVersion == "" {
		nodeVersion = "v22.19.0"
	}
	npmVersion := s.npmVersion
	if npmVersion == "" {
		npmVersion = "10.0.0"
	}
	homebrewPrefix := s.homebrewPrefix
	if s.homebrewPrefix == "" && s.homebrewErr == nil {
		homebrewPrefix = "/opt/homebrew"
	}
	return ports.InstallCapabilities{
		NPM: ports.NPMInstallCapabilities{
			NodeVersion: nodeVersion, NPMVersion: npmVersion,
			GlobalPrefix: s.prefix, PrefixWritable: s.writable, Err: s.prefixErr,
		},
		Homebrew: ports.HomebrewInstallCapabilities{
			Prefix: homebrewPrefix, PrefixWritable: s.writable,
			Formulae: map[string]bool{}, Casks: map[string]bool{}, Err: s.homebrewErr,
		},
	}, nil
}

func TestAgentPlansSnapshotsCapabilitiesOnce(t *testing.T) {
	calls := 0
	s := newTestService("darwin", "npm", "sh")
	s.installCapabilities = installCapabilitiesStub{prefix: "/Users/test/.npm", writable: true, calls: &calls}
	if _, err := s.AgentPlans(context.Background()); err != nil {
		t.Fatal(err)
	}
	if calls != 1 {
		t.Fatalf("capability probes = %d, want one snapshot for the request", calls)
	}
}

func TestAgentPlansCancelsCapabilitySnapshotWithRequest(t *testing.T) {
	started := make(chan struct{})
	s := newTestService("darwin", "npm", "sh")
	s.installCapabilities = installCapabilitiesStub{probe: func(ctx context.Context) error {
		close(started)
		<-ctx.Done()
		return ctx.Err()
	}}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		_, err := s.AgentPlans(ctx)
		done <- err
	}()
	<-started
	cancel()
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("AgentPlans error = %v, want context canceled", err)
	}
}

func TestAgentPlansCoverEveryHarnessOnce(t *testing.T) {
	s := newTestService("darwin", "npm", "sh")
	plans, err := s.AgentPlans(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(plans) != 1 || plans[0].AgentID != string(TargetPi) {
		t.Fatalf("got %d plans (%+v), want exactly the pi plan", len(plans), plans)
	}
	plan := plans[0]
	if plan.DocumentationURL == "" {
		t.Fatalf("plan %q has no documentation URL", plan.AgentID)
	}
	if plan.Available && (!plan.Automatic || plan.Command == "" || plan.Method == "") {
		t.Fatalf("available plan %q is incomplete: %+v", plan.AgentID, plan)
	}
}

func TestPiOfficialInstallerPlansAreAutomaticAndServerOwned(t *testing.T) {
	tests := []struct {
		goos        string
		found       []string
		wantURL     string
		wantProgram string
	}{
		{"darwin", []string{"sh"}, "https://pi.dev/install.sh", "sh"},
		{"linux", []string{"sh"}, "https://pi.dev/install.sh", "sh"},
	}
	for _, tt := range tests {
		t.Run(tt.goos, func(t *testing.T) {
			plan := newTestService(tt.goos, tt.found...).planAgent(TargetPi)
			if plan.Method != "official-installer" || plan.Script == nil {
				t.Fatalf("plan = %+v", plan)
			}
			_ = tt
			if plan.Script.URL != tt.wantURL || plan.Script.Interpreter[0] != "/usr/bin/"+tt.wantProgram {
				t.Fatalf("script = %+v", plan.Script)
			}
			if len(plan.Command) != 0 {
				t.Fatalf("remote plan exposed executable argv: %v", plan.Command)
			}
		})
	}
}

func TestAgentInstallPlansNeverUseShellEvaluationOrSudo(t *testing.T) {
	found := []string{"npm", "bun", "uv", "pipx", "winget", "bash", "sh", "pwsh.exe", "powershell.exe"}
	for _, goos := range []string{"darwin", "linux", "windows"} {
		s := newTestService(goos, found...)
		planner, err := s.newRequestPlanner(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		for _, target := range agentTargets {
			for _, plan := range planner.agentMethodPlans(target, AgentOperationInstall) {
				argv := append([]string(nil), plan.Command...)
				if plan.Script != nil {
					argv = append(argv, plan.Script.Interpreter...)
				}
				for _, arg := range argv {
					if arg == "sudo" || arg == "-c" || arg == "-Command" || strings.Contains(arg, "|") {
						t.Fatalf("%s/%s/%s contains shell-evaluated argument %q: %+v", goos, target, plan.Method, arg, plan)
					}
				}
			}
		}
	}
}

func TestOfficialInstallersRejectUnsupportedOperatingSystems(t *testing.T) {
	plan := newTestService("freebsd", "sh", "bash", "pwsh").planAgent(TargetPi)
	if !plan.Unsupported || plan.Script != nil {
		t.Fatalf("pi plan = %+v, want manual unsupported plan", plan)
	}
}

func TestNPMPlanIsPreferredWhenOfficialInstallerIsMissing(t *testing.T) {
	s := newTestService("darwin", "npm")
	s.installCapabilities = installCapabilitiesStub{
		prefix: "/Users/test/.npm", writable: true,
	}
	plan := s.planAgent(TargetPi)
	if plan.Method != "npm" || plan.Unsupported {
		t.Fatalf("recommended method = %q (%+v), want npm", plan.Method, plan)
	}
}

func TestPiOfficialInstallerRequiresHeadlessNodePrerequisites(t *testing.T) {
	for _, tt := range []struct {
		name        string
		nodeVersion string
		npmVersion  string
		wantReason  string
	}{
		{name: "missing node", nodeVersion: "missing", npmVersion: "10.8.0", wantReason: "Node.js 22.19+"},
		{name: "old node", nodeVersion: "v22.18.0", npmVersion: "10.8.0", wantReason: "Node.js 22.19+"},
		{name: "missing npm", nodeVersion: "v22.19.0", npmVersion: "missing", wantReason: "npm"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			s := newTestService("darwin", "sh")
			s.installCapabilities = installCapabilitiesStub{
				prefix: "/Users/test/.npm", writable: true,
				nodeVersion: tt.nodeVersion, npmVersion: tt.npmVersion,
			}
			planner, err := s.newRequestPlanner(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			plan, err := planner.resolveAgentMethod(TargetPi, "official-installer", AgentOperationInstall)
			if !errors.Is(err, ErrInstallMethod) || !strings.Contains(err.Error(), tt.wantReason) {
				t.Fatalf("Pi official installer error = %v, want unavailable reason containing %q (plan=%+v)", err, tt.wantReason, plan)
			}
		})
	}
}

func TestNPMPlanUsesTargetSpecificNodeFloors(t *testing.T) {
	for _, tt := range []struct {
		name        string
		target      Target
		nodeVersion string
		wantAllowed bool
		wantReason  string
	}{
		{name: "pi rejects node 22.18", target: TargetPi, nodeVersion: "v22.18.0", wantReason: "Node.js 22.19+"},
		{name: "pi accepts node 22.19", target: TargetPi, nodeVersion: "v22.19.0", wantAllowed: true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			s := newTestService("darwin", "npm")
			s.installCapabilities = installCapabilitiesStub{
				prefix: "/Users/test/.npm", writable: true,
				nodeVersion: tt.nodeVersion, npmVersion: "9.0.0",
			}
			plan := s.planNPM(tt.target, "package")
			if tt.wantAllowed && plan.Unsupported {
				t.Fatalf("plan = %+v, want available", plan)
			}
			if !tt.wantAllowed && (!plan.Unsupported || !strings.Contains(plan.Reason, tt.wantReason)) {
				t.Fatalf("plan = %+v, want unavailable reason containing %q", plan, tt.wantReason)
			}
		})
	}
}

func TestNPMPlanRequiresWritableGlobalPrefix(t *testing.T) {
	tests := []struct {
		name       string
		caps       installCapabilitiesStub
		wantReason string
	}{
		{name: "prefix lookup fails", caps: installCapabilitiesStub{prefixErr: errors.New("npm failed")}, wantReason: "could not be inspected"},
		{name: "prefix not writable", caps: installCapabilitiesStub{prefix: "/usr/local", writable: false}, wantReason: "not writable"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := newTestService("darwin", "npm")
			s.installCapabilities = tt.caps
			plan := s.planNPM(TargetPi, "@earendil-works/pi-coding-agent")
			if !plan.Unsupported || !strings.Contains(plan.Reason, tt.wantReason) {
				t.Fatalf("plan = %+v, want unavailable reason containing %q", plan, tt.wantReason)
			}
		})
	}

	s := newTestService("darwin", "npm")
	s.installCapabilities = installCapabilitiesStub{prefix: "/Users/test/.npm", writable: true}
	plan := s.planNPM(TargetPi, "@earendil-works/pi-coding-agent")
	if plan.Unsupported || plan.ExpectedDestination != "/Users/test/.npm/bin" {
		t.Fatalf("plan = %+v, want writable npm destination", plan)
	}
}

func TestNPMPlanRequiresParseableNodeAndNPMVersions(t *testing.T) {
	tests := []struct {
		name        string
		nodeVersion string
		npmVersion  string
		wantReason  string
	}{
		{name: "unparseable node", nodeVersion: "unknown", npmVersion: "10.8.0", wantReason: "could not be validated"},
		{name: "unparseable npm", nodeVersion: "v22.19.0", npmVersion: "unknown", wantReason: "could not be validated"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := newTestService("darwin", "npm")
			s.installCapabilities = installCapabilitiesStub{
				prefix: "/Users/test/.npm", writable: true,
				nodeVersion: tt.nodeVersion, npmVersion: tt.npmVersion,
			}
			plan := s.planNPM(TargetPi, "@earendil-works/pi-coding-agent")
			if !plan.Unsupported || !strings.Contains(plan.Reason, tt.wantReason) {
				t.Fatalf("plan = %+v, want unavailable reason containing %q", plan, tt.wantReason)
			}
		})
	}
}

func TestResolveAgentMethodRejectsUnknownOrUnavailableMethod(t *testing.T) {
	s := newTestService("darwin", "npm")
	if _, err := s.resolveAgentMethod(TargetPi, "official-installer"); err == nil || !strings.Contains(err.Error(), "not available") {
		t.Fatalf("resolve official-installer error = %v, want unavailable", err)
	}
	if _, err := s.resolveAgentMethod(TargetPi, "made-up"); err == nil || !strings.Contains(err.Error(), "unknown install method") {
		t.Fatalf("resolve made-up error = %v, want unknown method", err)
	}
	plan, err := s.resolveAgentMethod(TargetPi, "npm")
	if err != nil || plan.Method != "npm" {
		t.Fatalf("resolve npm = %+v, %v", plan, err)
	}
}

func TestAgentTargetsAreValidButPrerequisitesAreNotHarnessRows(t *testing.T) {
	for _, target := range agentTargets {
		if !Valid(target) || !IsAgentTarget(target) {
			t.Fatalf("agent target %q is not accepted by both allowlists", target)
		}
	}
	for _, target := range []Target{TargetTmux, TargetGH, TargetClaude} {
		if !Valid(target) || IsAgentTarget(target) {
			t.Fatalf("prerequisite target %q was classified incorrectly", target)
		}
	}
	if !Valid(TargetCloudflared) || IsAgentTarget(TargetCloudflared) {
		t.Fatalf("cloudflared target classified incorrectly")
	}
}
