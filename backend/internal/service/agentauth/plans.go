package agentauth

import "strings"

// plans is the code-reviewed authentication allowlist. Since ADR 0005 pi is
// the single supported harness. Commands must be added here, never supplied by
// clients.
var plans = []Plan{
	terminalInputPlan("pi", ActionLogin, "Log in to Pi", []string{"pi"}, "/login\r", "Select Open login after Pi finishes starting", "https://github.com/earendil-works/pi"),
}

func terminalInputPlan(agentID string, action Action, title string, command []string, terminalInput, guidance, docs string) Plan {
	p := plan(agentID, action, title, command, guidance, docs)
	p.terminalInput = terminalInput
	return p
}

var planByAgentID = func() map[string]Plan {
	out := make(map[string]Plan, len(plans))
	for _, plan := range plans {
		out[plan.AgentID] = plan
	}
	return out
}()

func plan(agentID string, action Action, title string, command []string, guidance, docs string) Plan {
	return Plan{
		AgentID:          agentID,
		Action:           action,
		LaunchMode:       LaunchTerminal,
		DisplayCommand:   strings.Join(command, " "),
		Guidance:         guidance,
		DocumentationURL: docs,
		command:          command,
		title:            title,
	}
}
