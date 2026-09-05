package project

import "testing"

func TestGithubOwner(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name   string
		remote string
		want   string
	}{
		{"scp-style", "git@github.com:ercs-second-brain/agent-orchestrator.git", "ercs-second-brain"},
		{"https", "https://github.com/ercs-second-brain/agent-orchestrator.git", "ercs-second-brain"},
		{"https-no-suffix", "https://github.com/ercs-second-brain/agent-orchestrator", "ercs-second-brain"},
		{"http", "http://github.com/octocat/hello", "octocat"},
		{"ssh-url", "ssh://git@github.com/octocat/hello.git", "octocat"},
		{"git-proto", "git://github.com/octocat/hello.git", "octocat"},
		{"personal-account", "git@github.com:pulkit7070/dotfiles.git", "pulkit7070"},
		{"whitespace", "  https://github.com/ercs-second-brain/x.git  ", "ercs-second-brain"},
		{"empty", "", ""},
		{"non-github", "git@gitlab.com:group/repo.git", ""},
		{"owner-only-no-repo", "https://github.com/ercs-second-brain", ""},
		{"gist-subdomain-not-matched", "https://gist.github.com/ercs-second-brain/abc", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := githubOwner(tc.remote); got != tc.want {
				t.Fatalf("githubOwner(%q) = %q, want %q", tc.remote, got, tc.want)
			}
		})
	}
}
