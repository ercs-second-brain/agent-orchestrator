package project_test

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/ercs-second-brain/agent-orchestrator/backend/internal/service/project"
	"github.com/ercs-second-brain/agent-orchestrator/backend/internal/storage/sqlite/sqlitetest"
)

func newCreateRepositoryManager(t *testing.T, create project.CreateHostedRepositoryFunc) project.Manager {
	t.Helper()
	t.Setenv("GIT_CEILING_DIRECTORIES", os.TempDir())
	store, err := sqlitetest.Open(t.TempDir())
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return project.NewWithDeps(project.Deps{Store: store, CreateHostedRepository: create})
}

func attachOrigin(t *testing.T, path, name string) {
	t.Helper()
	remote := "https://github.com/example/" + filepath.Base(name) + ".git"
	if out, err := exec.Command("git", "-C", path, "remote", "add", "origin", remote).CombinedOutput(); err != nil {
		t.Fatalf("git remote add: %v (%s)", err, out)
	}
}

func TestCreateRepository_CreatesPrivateCheckout(t *testing.T) {
	parent := t.TempDir()
	var seen project.HostedRepositoryCreate
	mgr := newCreateRepositoryManager(t, func(_ context.Context, in project.HostedRepositoryCreate) error {
		seen = in
		attachOrigin(t, in.Path, in.Name)
		return nil
	})

	created, err := mgr.CreateRepository(context.Background(), project.CreateRepositoryInput{
		Name:              "my-app",
		DestinationParent: parent,
	})
	if err != nil {
		t.Fatalf("CreateRepository: %v", err)
	}
	if created.Name != "my-app" {
		t.Fatalf("name = %q, want my-app", created.Name)
	}
	if created.Path != filepath.Join(parent, "my-app") {
		t.Fatalf("path = %q", created.Path)
	}
	if !seen.Private {
		t.Fatal("expected hosted create to default private")
	}
	if seen.Name != "my-app" {
		t.Fatalf("hosted name = %q", seen.Name)
	}
	if _, err := os.Stat(filepath.Join(created.Path, "README.md")); err != nil {
		t.Fatalf("README: %v", err)
	}
}

func TestCreateRepository_PublicAndOwnerName(t *testing.T) {
	parent := t.TempDir()
	public := false
	var seen project.HostedRepositoryCreate
	mgr := newCreateRepositoryManager(t, func(_ context.Context, in project.HostedRepositoryCreate) error {
		seen = in
		attachOrigin(t, in.Path, in.Name)
		return nil
	})

	created, err := mgr.CreateRepository(context.Background(), project.CreateRepositoryInput{
		Name:              "acme/widgets",
		Private:           &public,
		DestinationParent: parent,
	})
	if err != nil {
		t.Fatalf("CreateRepository: %v", err)
	}
	if created.Path != filepath.Join(parent, "widgets") {
		t.Fatalf("path = %q", created.Path)
	}
	if seen.Private {
		t.Fatal("expected public create")
	}
	if seen.Name != "acme/widgets" {
		t.Fatalf("hosted name = %q", seen.Name)
	}
}

func TestCreateRepository_RejectsInvalidName(t *testing.T) {
	mgr := newCreateRepositoryManager(t, func(context.Context, project.HostedRepositoryCreate) error {
		t.Fatal("should not create hosted repo")
		return nil
	})
	for _, name := range []string{"../etc", "..", ".", "a/b/c", ""} {
		_, err := mgr.CreateRepository(context.Background(), project.CreateRepositoryInput{Name: name})
		wantCode(t, err, "INVALID_REPOSITORY_NAME")
	}
}

func TestCreateRepository_ConflictWhenFolderExists(t *testing.T) {
	parent := t.TempDir()
	if err := os.Mkdir(filepath.Join(parent, "taken"), 0o755); err != nil {
		t.Fatal(err)
	}
	mgr := newCreateRepositoryManager(t, func(context.Context, project.HostedRepositoryCreate) error {
		t.Fatal("should not create hosted repo")
		return nil
	})
	_, err := mgr.CreateRepository(context.Background(), project.CreateRepositoryInput{
		Name:              "taken",
		DestinationParent: parent,
	})
	wantCode(t, err, "CLONE_DESTINATION_EXISTS")
}
