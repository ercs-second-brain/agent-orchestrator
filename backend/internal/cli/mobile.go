package cli

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"strings"

	"github.com/spf13/cobra"
)

// mobileEndpointDTO mirrors mobilebridge.Endpoint as the daemon serializes it.
type mobileEndpointDTO struct {
	Kind   string `json:"kind"`
	Host   string `json:"host"`
	Port   int    `json:"port"`
	Secure bool   `json:"secure"`
}

// mobileTunnelStatusDTO mirrors mobilebridge.TunnelStatus.
type mobileTunnelStatusDTO struct {
	Supported bool   `json:"supported"`
	Running   bool   `json:"running"`
	Ready     bool   `json:"ready"`
	Hostname  string `json:"hostname"`
	Location  string `json:"location"`
	LastError string `json:"lastError"`
}

// mobileSecurePairingStatusDTO mirrors controllers.SecurePairingStatus.
type mobileSecurePairingStatusDTO struct {
	Enabled   bool   `json:"enabled"`
	Available bool   `json:"available"`
	Active    bool   `json:"active"`
	Host      string `json:"host"`
	Port      int    `json:"port"`
	Reason    string `json:"reason"`
}

// mobileStatusDTO mirrors controllers.MobileStatusResponse. The CLI is a thin
// client: it hand-mirrors the wire shape instead of importing the HTTP
// controller package.
type mobileStatusDTO struct {
	Enabled       bool                         `json:"enabled"`
	Endpoints     []mobileEndpointDTO          `json:"endpoints"`
	HostID        string                       `json:"hostId"`
	Tunnel        mobileTunnelStatusDTO        `json:"tunnel"`
	Host          string                       `json:"host"`
	TailscaleHost string                       `json:"tailscaleHost"`
	Port          int                          `json:"port"`
	Password      string                       `json:"password"`
	Warning       string                       `json:"warning"`
	SecurePairing mobileSecurePairingStatusDTO `json:"securePairing"`
}

// newMobileCommand manages the Connect Mobile LAN listener over the loopback
// API. It exists for headless deployments (a server VM running `ao daemon`)
// where the desktop app's Connect Mobile settings are not available. These
// commands are the thin-client mirror of the loopback-only /api/v1/mobile
// routes; the LAN listener itself must never serve them (lanControlBlock).
func newMobileCommand(ctx *commandContext) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "mobile",
		Short: "Manage the Connect Mobile LAN listener",
		Long: "Manage the Connect Mobile LAN listener: the opt-in 0.0.0.0 listener that\n" +
			"lets phones and browsers reach this daemon over the local network behind a\n" +
			"connection password.\n\n" +
			"State persists under ~/.ao and is restored on daemon restart, so this is a\n" +
			"one-time setup per deployment.",
		Args: noArgs,
	}
	cmd.AddCommand(newMobileStatusCommand(ctx))
	cmd.AddCommand(newMobileEnableCommand(ctx))
	cmd.AddCommand(newMobileDisableCommand(ctx))
	cmd.AddCommand(newMobileRegenerateCommand(ctx))
	cmd.AddCommand(newMobilePairingCodeCommand(ctx))
	return cmd
}

func newMobileStatusCommand(ctx *commandContext) *cobra.Command {
	var jsonOutput bool
	cmd := &cobra.Command{
		Use:   "status",
		Short: "Show Connect Mobile status and advertised endpoints",
		Args:  noArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			var res mobileStatusDTO
			if err := ctx.getJSON(cmd.Context(), "mobile/status", &res); err != nil {
				return err
			}
			if jsonOutput {
				return writeJSON(cmd.OutOrStdout(), res)
			}
			return writeMobileStatus(cmd.OutOrStdout(), res)
		},
	}
	cmd.Flags().BoolVar(&jsonOutput, "json", false, "print the structured response as JSON")
	return cmd
}

func newMobileEnableCommand(ctx *commandContext) *cobra.Command {
	var jsonOutput bool
	cmd := &cobra.Command{
		Use:   "enable",
		Short: "Enable the LAN listener and print the connection password",
		Long: "Enable the Connect Mobile LAN listener and print the connection password.\n\n" +
			"Clients authenticate with this password as a bearer token (REST) or via the\n" +
			"web login (browsers). Rotating it later with `ao mobile regenerate` drops\n" +
			"every currently paired client.",
		Args: noArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			var res mobileStatusDTO
			if err := ctx.postJSON(cmd.Context(), "mobile/enable", nil, &res); err != nil {
				return err
			}
			if jsonOutput {
				return writeJSON(cmd.OutOrStdout(), res)
			}
			return writeMobileStatus(cmd.OutOrStdout(), res)
		},
	}
	cmd.Flags().BoolVar(&jsonOutput, "json", false, "print the structured response as JSON")
	return cmd
}

func newMobileDisableCommand(ctx *commandContext) *cobra.Command {
	var jsonOutput, yes bool
	cmd := &cobra.Command{
		Use:   "disable",
		Short: "Disable the LAN listener",
		Long: "Disable the Connect Mobile LAN listener, closing the 0.0.0.0 socket.\n\n" +
			"Disabling drops every LAN client, including paired phones and open web\n" +
			"sessions. The connection password is kept, so a later enable pairs again\n" +
			"without rotating anything.",
		Args: noArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			if !yes {
				confirmed, err := confirmMobileAction(cmd, "Disable Connect Mobile? All paired phones and web sessions lose access. Type y to confirm: ")
				if err != nil {
					return err
				}
				if !confirmed {
					_, err := fmt.Fprintln(cmd.OutOrStdout(), "aborted")
					return err
				}
			}
			var res mobileStatusDTO
			if err := ctx.postJSON(cmd.Context(), "mobile/disable", nil, &res); err != nil {
				return err
			}
			if jsonOutput {
				return writeJSON(cmd.OutOrStdout(), res)
			}
			return writeMobileStatus(cmd.OutOrStdout(), res)
		},
	}
	cmd.Flags().BoolVarP(&yes, "yes", "y", false, "Skip confirmation prompt")
	cmd.Flags().BoolVar(&jsonOutput, "json", false, "print the structured response as JSON")
	return cmd
}

func newMobileRegenerateCommand(ctx *commandContext) *cobra.Command {
	var jsonOutput, yes bool
	cmd := &cobra.Command{
		Use:   "regenerate",
		Short: "Rotate the connection password",
		Long: "Rotate the Connect Mobile connection password.\n\n" +
			"Every currently paired phone and open web session loses access until it\n" +
			"re-authenticates with the new password, which this command prints.",
		Args: noArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			if !yes {
				confirmed, err := confirmMobileAction(cmd, "Rotate the connection password? Currently paired phones and web sessions lose access until re-paired. Type y to confirm: ")
				if err != nil {
					return err
				}
				if !confirmed {
					_, err := fmt.Fprintln(cmd.OutOrStdout(), "aborted")
					return err
				}
			}
			var res mobileStatusDTO
			if err := ctx.postJSON(cmd.Context(), "mobile/regenerate", nil, &res); err != nil {
				return err
			}
			if jsonOutput {
				return writeJSON(cmd.OutOrStdout(), res)
			}
			return writeMobileStatus(cmd.OutOrStdout(), res)
		},
	}
	cmd.Flags().BoolVarP(&yes, "yes", "y", false, "Skip confirmation prompt")
	cmd.Flags().BoolVar(&jsonOutput, "json", false, "print the structured response as JSON")
	return cmd
}

// pairingCodeV1 is the legacy JSON payload some clients paste directly. v2 deep
// links remain the primary mobile format; desktop remote attach accepts both.
type pairingCodeV1 struct {
	V        int    `json:"v"`
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Password string `json:"password"`
	Secure   bool   `json:"secure,omitempty"`
}

func newMobilePairingCodeCommand(ctx *commandContext) *cobra.Command {
	var jsonOutput bool
	cmd := &cobra.Command{
		Use:   "pairing-code",
		Short: "Print a pasteable LAN pairing payload",
		Long: "Print a pasteable LAN pairing payload for desktop and mobile clients.\n\n" +
			"By default this emits a compact v1 JSON object {v, host, port, password}.\n" +
			"Use --json for the full mobile/status shape plus a pairingPayload field.\n\n" +
			"The bridge must be enabled (ao mobile enable) and reachable on the LAN.",
		Args: noArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			var res mobileStatusDTO
			if err := ctx.getJSON(cmd.Context(), "mobile/status", &res); err != nil {
				return err
			}
			if !res.Enabled || res.Password == "" {
				return fmt.Errorf("connect mobile is disabled; run `ao mobile enable` first")
			}
			host, port, secure := firstPairingEndpoint(res)
			if host == "" || port == 0 {
				return fmt.Errorf("connect mobile has no advertised LAN endpoint yet")
			}
			payload := pairingCodeV1{
				V:        1,
				Host:     host,
				Port:     port,
				Password: res.Password,
				Secure:   secure,
			}
			if jsonOutput {
				out := struct {
					mobileStatusDTO
					PairingPayload pairingCodeV1 `json:"pairingPayload"`
				}{
					mobileStatusDTO: res,
					PairingPayload:  payload,
				}
				return writeJSON(cmd.OutOrStdout(), out)
			}
			// The pairing payload exists to hand the connection password to the
			// client being paired; emitting it here is the command's purpose,
			// not an accidental leak.
			data, err := json.Marshal(payload) //nolint:gosec // G117: the password is the point of `ao mobile pairing-code`
			if err != nil {
				return err
			}
			_, err = fmt.Fprintln(cmd.OutOrStdout(), string(data))
			return err
		},
	}
	cmd.Flags().BoolVar(&jsonOutput, "json", false, "print status plus pairingPayload as JSON")
	return cmd
}

// firstPairingEndpoint prefers a LAN endpoint, then Tailscale, then any entry.
func firstPairingEndpoint(res mobileStatusDTO) (host string, port int, secure bool) {
	if len(res.Endpoints) == 0 {
		if res.Host != "" && res.Port > 0 {
			return res.Host, res.Port, res.SecurePairing.Active
		}
		return "", 0, false
	}
	prefer := []string{"lan", "tailscale", "tunnel", "relay"}
	for _, kind := range prefer {
		for _, ep := range res.Endpoints {
			if ep.Kind == kind {
				return ep.Host, ep.Port, ep.Secure
			}
		}
	}
	ep := res.Endpoints[0]
	return ep.Host, ep.Port, ep.Secure
}

// writeMobileStatus renders the status for humans: state, host id, endpoints,
// and the password when the response carries one (enable/regenerate on an
// enabled bridge). The password is the only secret here and it is deliberately
// printed: a headless operator has no other way to read it.
func writeMobileStatus(w io.Writer, res mobileStatusDTO) error {
	state := "disabled"
	if res.Enabled {
		state = "enabled"
	}
	if _, err := fmt.Fprintf(w, "Connect Mobile: %s (host id %s)\n", state, res.HostID); err != nil {
		return err
	}
	if res.Enabled && len(res.Endpoints) > 0 {
		if _, err := fmt.Fprintln(w, "Advertised endpoints:"); err != nil {
			return err
		}
		for _, ep := range res.Endpoints {
			scheme := "http"
			if ep.Secure {
				scheme = "https"
			}
			if _, err := fmt.Fprintf(w, "  %-9s %s://%s:%d\n", ep.Kind+":", scheme, ep.Host, ep.Port); err != nil {
				return err
			}
		}
	}
	if res.Password != "" {
		if _, err := fmt.Fprintf(w, "Connection password: %s\n", res.Password); err != nil {
			return err
		}
	}
	if res.Warning != "" {
		if _, err := fmt.Fprintf(w, "Warning: %s\n", res.Warning); err != nil {
			return err
		}
	}
	return nil
}

// confirmMobileAction is the shared yes/no confirmation for destructive mobile
// actions, mirroring confirmProjectRemoval's style.
func confirmMobileAction(cmd *cobra.Command, prompt string) (bool, error) {
	if _, err := fmt.Fprint(cmd.OutOrStdout(), prompt); err != nil {
		return false, err
	}
	reader := bufio.NewReader(cmd.InOrStdin())
	line, err := reader.ReadString('\n')
	if err != nil && line == "" {
		return false, err
	}
	answer := strings.ToLower(strings.TrimSpace(line))
	return answer == "y" || answer == "yes", nil
}
