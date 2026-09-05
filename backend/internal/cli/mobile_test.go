package cli

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type mobileCapture struct {
	method string
	path   string
	body   []byte
}

func mobileServer(t *testing.T, status int, respBody string) (*httptest.Server, *mobileCapture) {
	t.Helper()
	capture := &mobileCapture{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// The CLI posts best-effort usage telemetry to /internal/*; ignore it so
		// assertions only see the actual API call under test.
		if strings.HasPrefix(r.URL.Path, "/internal/") {
			w.WriteHeader(http.StatusOK)
			return
		}
		capture.method = r.Method
		capture.path = r.URL.Path
		data, err := io.ReadAll(r.Body)
		if err != nil {
			t.Errorf("read request body: %v", err)
		}
		capture.body = data
		if !strings.HasPrefix(r.URL.Path, "/api/v1/mobile/") {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = io.WriteString(w, respBody)
	}))
	t.Cleanup(srv.Close)
	return srv, capture
}

const mobileDisabledStatusJSON = `{
	"enabled": false,
	"endpoints": [],
	"hostId": "h_test1234",
	"tunnel": {"supported": false},
	"host": "",
	"tailscaleHost": "",
	"port": 0,
	"password": "",
	"warning": "Traffic on this connection is not encrypted. Only use it on a network you trust.",
	"securePairing": {"enabled": false}
}`

const mobileEnabledStatusJSON = `{
	"enabled": true,
	"endpoints": [
		{"kind": "lan", "host": "192.168.1.50", "port": 3915, "secure": false},
		{"kind": "tailscale", "host": "100.64.0.7", "port": 3915, "secure": false}
	],
	"hostId": "h_test1234",
	"tunnel": {"supported": false},
	"host": "192.168.1.50",
	"tailscaleHost": "100.64.0.7",
	"port": 3915,
	"password": "ab12cd34",
	"warning": "Traffic on this connection is not encrypted. Only use it on a network you trust.",
	"securePairing": {"enabled": false}
}`

func TestMobileStatus_HumanOutput(t *testing.T) {
	cfg := setConfigEnv(t)
	srv, capture := mobileServer(t, http.StatusOK, mobileEnabledStatusJSON)
	writeRunFileFor(t, cfg, srv)

	out, errOut, err := executeCLI(t, Deps{
		ProcessAlive: func(int) bool { return true },
	}, "mobile", "status")
	if err != nil {
		t.Fatalf("unexpected error: %v\nstderr=%s", err, errOut)
	}
	if capture.method != http.MethodGet || capture.path != "/api/v1/mobile/status" {
		t.Fatalf("request = %s %s, want GET /api/v1/mobile/status", capture.method, capture.path)
	}
	for _, want := range []string{
		"Connect Mobile: enabled (host id h_test1234)",
		"lan:      http://192.168.1.50:3915",
		"tailscale: http://100.64.0.7:3915",
		"Warning: Traffic on this connection is not encrypted",
	} {
		if !strings.Contains(out, want) {
			t.Fatalf("status output missing %q:\n%s", want, out)
		}
	}
}

func TestMobileStatus_DisabledJSON(t *testing.T) {
	cfg := setConfigEnv(t)
	srv, capture := mobileServer(t, http.StatusOK, mobileDisabledStatusJSON)
	writeRunFileFor(t, cfg, srv)

	out, errOut, err := executeCLI(t, Deps{
		ProcessAlive: func(int) bool { return true },
	}, "mobile", "status", "--json")
	if err != nil {
		t.Fatalf("unexpected error: %v\nstderr=%s", err, errOut)
	}
	var got mobileStatusDTO
	if err := json.Unmarshal([]byte(out), &got); err != nil {
		t.Fatalf("decode json output: %v\nout=%s", err, out)
	}
	if got.Enabled || got.HostID != "h_test1234" || len(got.Endpoints) != 0 {
		t.Fatalf("status = %#v", got)
	}
	if capture.method != http.MethodGet {
		t.Fatalf("method = %s, want GET", capture.method)
	}
}

func TestMobileEnable_PostsAndPrintsPassword(t *testing.T) {
	cfg := setConfigEnv(t)
	srv, capture := mobileServer(t, http.StatusOK, mobileEnabledStatusJSON)
	writeRunFileFor(t, cfg, srv)

	out, errOut, err := executeCLI(t, Deps{
		ProcessAlive: func(int) bool { return true },
	}, "mobile", "enable")
	if err != nil {
		t.Fatalf("unexpected error: %v\nstderr=%s", err, errOut)
	}
	if capture.method != http.MethodPost || capture.path != "/api/v1/mobile/enable" {
		t.Fatalf("request = %s %s, want POST /api/v1/mobile/enable", capture.method, capture.path)
	}
	if !strings.Contains(out, "Connection password: ab12cd34") {
		t.Fatalf("enable output missing password:\n%s", out)
	}
}

func TestMobileDisable_RequiresConfirmation(t *testing.T) {
	cfg := setConfigEnv(t)
	srv, capture := mobileServer(t, http.StatusOK, mobileDisabledStatusJSON)
	writeRunFileFor(t, cfg, srv)

	// Wrong confirmation must abort without calling the daemon.
	out, errOut, err := executeCLI(t, Deps{
		ProcessAlive: func(int) bool { return true },
		In:           strings.NewReader("no\n"),
	}, "mobile", "disable")
	if err != nil {
		t.Fatalf("unexpected error: %v\nstderr=%s", err, errOut)
	}
	if capture.method != "" {
		t.Fatalf("disable issued request despite aborted confirmation (%s %s)", capture.method, capture.path)
	}
	if !strings.Contains(out, "aborted") {
		t.Fatalf("expected abort message:\n%s", out)
	}

	// "y" confirms and posts.
	capture.method = ""
	_, errOut, err = executeCLI(t, Deps{
		ProcessAlive: func(int) bool { return true },
		In:           strings.NewReader("y\n"),
	}, "mobile", "disable")
	if err != nil {
		t.Fatalf("unexpected error: %v\nstderr=%s", err, errOut)
	}
	if capture.method != http.MethodPost || capture.path != "/api/v1/mobile/disable" {
		t.Fatalf("confirmed request = %s %s, want POST /api/v1/mobile/disable", capture.method, capture.path)
	}
}

func TestMobileDisable_YesSkipsConfirmation(t *testing.T) {
	cfg := setConfigEnv(t)
	srv, capture := mobileServer(t, http.StatusOK, mobileDisabledStatusJSON)
	writeRunFileFor(t, cfg, srv)

	_, errOut, err := executeCLI(t, Deps{
		ProcessAlive: func(int) bool { return true },
		In:           strings.NewReader(""),
	}, "mobile", "disable", "--yes")
	if err != nil {
		t.Fatalf("unexpected error: %v\nstderr=%s", err, errOut)
	}
	if capture.method != http.MethodPost || capture.path != "/api/v1/mobile/disable" {
		t.Fatalf("request = %s %s, want POST /api/v1/mobile/disable", capture.method, capture.path)
	}
}

func TestMobileRegenerate_PostsAndPrintsPassword(t *testing.T) {
	cfg := setConfigEnv(t)
	srv, capture := mobileServer(t, http.StatusOK, mobileEnabledStatusJSON)
	writeRunFileFor(t, cfg, srv)

	out, errOut, err := executeCLI(t, Deps{
		ProcessAlive: func(int) bool { return true },
	}, "mobile", "regenerate", "--yes")
	if err != nil {
		t.Fatalf("unexpected error: %v\nstderr=%s", err, errOut)
	}
	if capture.method != http.MethodPost || capture.path != "/api/v1/mobile/regenerate" {
		t.Fatalf("request = %s %s, want POST /api/v1/mobile/regenerate", capture.method, capture.path)
	}
	if !strings.Contains(out, "Connection password: ab12cd34") {
		t.Fatalf("regenerate output missing password:\n%s", out)
	}
}

func TestMobileCommands_SurfaceDaemonErrorEnvelope(t *testing.T) {
	cfg := setConfigEnv(t)
	srv, _ := mobileServer(t, http.StatusInternalServerError, `{"message":"bridge failed","code":"MOBILE_ENABLE","requestId":"req-7"}`)
	writeRunFileFor(t, cfg, srv)

	_, errOut, err := executeCLI(t, Deps{
		ProcessAlive: func(int) bool { return true },
	}, "mobile", "enable")
	if err == nil {
		t.Fatal("expected error")
	}
	if got := ExitCode(err); got != 1 {
		t.Fatalf("ExitCode = %d, want 1 for daemon failure", got)
	}
	if !strings.Contains(err.Error(), "bridge failed (MOBILE_ENABLE) [request req-7]") {
		t.Fatalf("error = %v, want daemon envelope", err)
	}
	_ = errOut
}

func TestMobileCommands_RequireRunningDaemon(t *testing.T) {
	setConfigEnv(t) // no run file written

	_, _, err := executeCLI(t, Deps{}, "mobile", "status")
	if err == nil {
		t.Fatal("expected error")
	}
	if got := ExitCode(err); got != 1 {
		t.Fatalf("ExitCode = %d, want 1 for runtime failure", got)
	}
	if !strings.Contains(err.Error(), "AO daemon is not running") {
		t.Fatalf("error = %v, want not-running message", err)
	}
}

func TestMobilePairingCode_PrintsV1JSON(t *testing.T) {
	cfg := setConfigEnv(t)
	srv, capture := mobileServer(t, http.StatusOK, mobileEnabledStatusJSON)
	writeRunFileFor(t, cfg, srv)

	out, errOut, err := executeCLI(t, Deps{
		ProcessAlive: func(int) bool { return true },
	}, "mobile", "pairing-code")
	if err != nil {
		t.Fatalf("unexpected error: %v\nstderr=%s", err, errOut)
	}
	if capture.method != http.MethodGet || capture.path != "/api/v1/mobile/status" {
		t.Fatalf("request = %s %s, want GET /api/v1/mobile/status", capture.method, capture.path)
	}
	var payload pairingCodeV1
	if err := json.Unmarshal([]byte(strings.TrimSpace(out)), &payload); err != nil {
		t.Fatalf("decode pairing payload: %v\nout=%s", err, out)
	}
	if payload.V != 1 || payload.Host != "192.168.1.50" || payload.Port != 3915 || payload.Password != "ab12cd34" {
		t.Fatalf("payload = %#v", payload)
	}
}

func TestMobilePairingCode_RequiresEnabledBridge(t *testing.T) {
	cfg := setConfigEnv(t)
	srv, _ := mobileServer(t, http.StatusOK, mobileDisabledStatusJSON)
	writeRunFileFor(t, cfg, srv)

	_, errOut, err := executeCLI(t, Deps{
		ProcessAlive: func(int) bool { return true },
	}, "mobile", "pairing-code")
	if err == nil {
		t.Fatal("expected error")
	}
	if !strings.Contains(err.Error(), "connect mobile is disabled") {
		t.Fatalf("error = %v\nstderr=%s", err, errOut)
	}
}

func TestMobileRejectsUnexpectedArgs(t *testing.T) {
	// Group commands (mobile with no/unknown subcommand) show help like the
	// other CLI groups (browser, project); only leaf commands enforce args.
	for _, args := range [][]string{
		{"mobile", "status", "extra"},
		{"mobile", "enable", "extra"},
		{"mobile", "disable", "extra"},
		{"mobile", "regenerate", "extra"},
		{"mobile", "pairing-code", "extra"},
	} {
		t.Run(strings.Join(args, " "), func(t *testing.T) {
			_, _, err := executeCLI(t, Deps{}, args...)
			if err == nil {
				t.Fatal("expected usage error")
			}
			if got := ExitCode(err); got != 2 {
				t.Fatalf("ExitCode(%v) = %d, want 2", err, got)
			}
		})
	}
}
