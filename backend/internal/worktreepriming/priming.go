// Package worktreepriming caches installed node_modules trees per project so
// new session worktrees start pre-primed and workers can skip npm ci.
//
// How it works:
//
//  1. Hash: every package-lock.json under a tree (node_modules excluded) is
//     combined into one sha256. The hash keys the template, so any lockfile
//     change invalidates it automatically.
//  2. Harvest: when a spawn finds no template for the current hash, the daemon
//     copies node_modules from a source tree that already matches (usually the
//     project checkout, otherwise an existing session worktree) into
//     <dataDir>/worktree-templates/<projectID>/<hash>. The copy is a FULL copy
//     (not hard links) so later in-place writes inside session worktrees can
//     never propagate back into the source checkout. It is built under a temp
//     directory and atomically renamed into place; concurrent harvests of the
//     same hash are gated, and the loser of a rename race discards its copy.
//  3. Prime: when a template exists for the hash, its node_modules dirs are
//     hard-link copied into the fresh worktree before the agent launches —
//     thousands of link() calls instead of a multi-minute npm ci. A hard link
//     that cannot be created (e.g. across devices) falls back to a full file
//     copy. Symlinks are recreated as symlinks.
//
// Safety and trade-offs:
//
//   - The template is a pure cache: deleting it never breaks correctness, the
//     next spawn simply falls back to the worker running npm ci itself.
//   - Prime shares inodes between the template and the worktree. Tools that
//     replace files (delete + write, how npm operates) cannot corrupt the
//     template, but a tool that mutates a linked file in place would. This is
//     the standard hard-link store trade-off (the same one pnpm makes); the
//     worst case is a stale template that deleting the cache rebuilds.
//   - Harvest copies from source trees read-only, so an actively used source
//     at worst produces an inconsistent copy; that template may fail to work
//     and is rebuilt on a later spawn. Templates are keyed per project.
//   - Everything lives under the daemon data dir (AO_DATA_DIR respected).
package worktreepriming

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// TemplateRoot is the data-dir-relative directory holding per-project
// templates. Each project gets <TemplateRoot>/<projectID>/<lockfile-hash>/.
const TemplateRoot = "worktree-templates"

// lockfileName is the npm lockfile that keys templates.
const lockfileName = "package-lock.json"

// manifestName is written into a template directory only after every node_modules
// tree has been copied, so its presence marks a complete, primable template.
const manifestName = "manifest.json"

// excludedDirs are skipped when scanning for lockfiles: VCS metadata, installed
// dependencies (whose nested lockfiles are vendored copies, not inputs), and
// AO's own per-worktree attachment storage.
var excludedDirs = map[string]bool{
	".git":         true,
	"node_modules": true,
	".ao":          true,
}

// Primer maintains per-project worktree templates under a daemon data dir.
// All methods are safe for concurrent use. A Primer with an empty dataDir is
// inert: Hash still works, but Harvest and Prime no-op.
type Primer struct {
	dataDir string
	logger  *slog.Logger

	mu         sync.Mutex
	harvesting map[string]bool // "projectID/hash" -> harvest in flight
}

// New builds a Primer storing templates under dataDir. A nil logger defaults
// to slog.Default().
func New(dataDir string, logger *slog.Logger) *Primer {
	if logger == nil {
		logger = slog.Default()
	}
	return &Primer{
		dataDir:    dataDir,
		logger:     logger,
		harvesting: make(map[string]bool),
	}
}

// TemplateDir returns the directory holding the template for projectID and
// hash. Callers treat it as opaque; delete the whole tree to invalidate.
func (p *Primer) TemplateDir(projectID, hash string) string {
	return filepath.Join(p.dataDir, TemplateRoot, projectID, hash)
}

// manifest describes a complete template: which lockfiles it was keyed on and
// which repo-relative directories had a node_modules tree captured.
type manifest struct {
	Version   int      `json:"version"`
	Hash      string   `json:"hash"`
	Lockfiles []string `json:"lockfiles"`
	// Dirs are repo-relative directories (".", "frontend", ...) whose
	// node_modules was captured in the template.
	Dirs []string `json:"dirs"`
}

const manifestVersion = 1

// Lockfiles returns the repo-relative paths of every package-lock.json under
// root, sorted, excluding node_modules, .git, and AO's attachment dir.
func (p *Primer) Lockfiles(root string) ([]string, error) {
	var locks []string
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			if errors.Is(err, fs.ErrNotExist) {
				return nil // raced a delete; nothing to scan here
			}
			return err
		}
		if d.IsDir() {
			if path != root && excludedDirs[d.Name()] {
				return fs.SkipDir
			}
			return nil
		}
		if d.Name() == lockfileName {
			rel, relErr := filepath.Rel(root, path)
			if relErr != nil {
				return relErr
			}
			locks = append(locks, filepath.ToSlash(rel))
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return locks, nil
}

// Hash returns the combined sha256 of all package-lock.json files under root
// (paths and contents). An empty string means the tree has no lockfiles and
// priming does not apply.
func (p *Primer) Hash(root string) (string, error) {
	locks, err := p.Lockfiles(root)
	if err != nil || len(locks) == 0 {
		return "", err
	}
	digest := sha256.New()
	for _, rel := range locks {
		path := filepath.Join(root, filepath.FromSlash(rel))
		content, err := os.ReadFile(path)
		if err != nil {
			if errors.Is(err, fs.ErrNotExist) {
				continue // raced a lockfile deletion; hash what remains
			}
			return "", err
		}
		fmt.Fprintf(digest, "%s\x00%x\x00", rel, sha256.Sum256(content))
	}
	if digest.Size() == 0 {
		return "", nil
	}
	return hex.EncodeToString(digest.Sum(nil)), nil
}

// nodeModulesDirs returns the lockfile dirs under root that have an existing
// node_modules directory, as repo-relative paths.
func (p *Primer) nodeModulesDirs(root string) ([]string, error) {
	locks, err := p.Lockfiles(root)
	if err != nil {
		return nil, err
	}
	var dirs []string
	for _, rel := range locks {
		dir := filepath.ToSlash(filepath.Dir(rel))
		if info, err := os.Lstat(filepath.Join(root, filepath.FromSlash(dir), "node_modules")); err == nil && info.IsDir() {
			dirs = append(dirs, dir)
		}
	}
	return dirs, nil
}

// HasTemplate reports whether a complete template exists for projectID/hash.
func (p *Primer) HasTemplate(projectID, hash string) bool {
	if p.dataDir == "" || hash == "" {
		return false
	}
	_, err := os.Stat(filepath.Join(p.TemplateDir(projectID, hash), manifestName))
	return err == nil
}

// Prime populates the node_modules trees of worktree from the template for
// projectID/hash. It reports whether priming happened. A missing or incomplete
// template returns (false, nil) — callers fall back to a plain install. Dirs
// that already contain node_modules are skipped, so re-priming is harmless.
// An error means priming failed partway: leftover partial trees are cleaned
// up, and the worktree remains safe for a normal npm ci.
func (p *Primer) Prime(_ context.Context, projectID, worktree, hash string) (bool, error) {
	if p.dataDir == "" || hash == "" {
		return false, nil
	}
	templateDir := p.TemplateDir(projectID, hash)
	raw, err := os.ReadFile(filepath.Join(templateDir, manifestName))
	if err != nil {
		return false, nil
	}
	var man manifest
	if err := json.Unmarshal(raw, &man); err != nil || man.Hash != hash || len(man.Dirs) == 0 {
		return false, nil
	}
	primed := false
	for _, dir := range man.Dirs {
		target := filepath.Join(worktree, filepath.FromSlash(dir), "node_modules")
		if _, err := os.Lstat(target); err == nil {
			continue // already present; never clobber
		}
		source := filepath.Join(templateDir, filepath.FromSlash(dir), "node_modules")
		if _, err := os.Lstat(source); err != nil {
			continue // template tree vanished; treat as incomplete for this dir
		}
		if err := primeDir(source, target); err != nil {
			return primed, fmt.Errorf("prime %s/node_modules: %w", dir, err)
		}
		primed = true
	}
	return primed, nil
}

// primeDir hard-link copies source into target. The tree is materialized in a
// sibling temp directory and renamed into place, so target only ever appears
// complete. On rename failure because another goroutine won the race, the
// temp tree is discarded and success is reported.
func primeDir(source, target string) error {
	tmp, err := os.MkdirTemp(filepath.Dir(target), ".node_modules-priming-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmp)
	payload := filepath.Join(tmp, "node_modules")
	if err := linkTree(source, payload); err != nil {
		return err
	}
	if err := os.Rename(payload, target); err != nil {
		if _, statErr := os.Lstat(target); statErr == nil {
			return nil // another prime materialized it first
		}
		return err
	}
	return nil
}

// linkTree recursively hard-links every regular file from source into target,
// recreating symlinks as symlinks. Files that cannot be linked (typically a
// cross-device template) fall back to a content copy. Other entry types
// (sockets, fifos) are skipped. Links never follow symlinks.
func linkTree(source, target string) error {
	entries, err := os.ReadDir(source)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(target, 0o750); err != nil {
		return err
	}
	for _, entry := range entries {
		sPath := filepath.Join(source, entry.Name())
		tPath := filepath.Join(target, entry.Name())
		switch {
		case entry.Type()&fs.ModeSymlink != 0:
			link, err := os.Readlink(sPath)
			if err != nil {
				return err
			}
			if err := os.Symlink(link, tPath); err != nil && !errors.Is(err, os.ErrExist) {
				return err
			}
		case entry.IsDir():
			if err := linkTree(sPath, tPath); err != nil {
				return err
			}
		case entry.Type().IsRegular():
			if err := os.Link(sPath, tPath); err != nil {
				if copyErr := copyFile(sPath, tPath); copyErr != nil {
					return copyErr
				}
			}
		default:
			continue
		}
	}
	return nil
}

func copyFile(source, target string) error {
	in, err := os.Open(source)
	if err != nil {
		return err
	}
	defer in.Close()
	info, err := in.Stat()
	if err != nil {
		return err
	}
	out, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, info.Mode().Perm())
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}

// HarvestAsync builds a template for projectID/hash from source in a
// background goroutine when none exists yet. Best-effort: failures are logged,
// never surfaced; the next spawn retries. Duplicate harvests of the same
// project/hash are collapsed.
func (p *Primer) HarvestAsync(ctx context.Context, projectID, source, hash string) {
	if p.dataDir == "" || hash == "" || source == "" {
		return
	}
	key := projectID + "/" + hash
	p.mu.Lock()
	if p.harvesting[key] {
		p.mu.Unlock()
		return
	}
	p.harvesting[key] = true
	p.mu.Unlock()
	go func() {
		defer func() {
			p.mu.Lock()
			delete(p.harvesting, key)
			p.mu.Unlock()
		}()
		harvestCtx, cancel := context.WithTimeout(ctx, 10*time.Minute)
		defer cancel()
		if err := p.Harvest(harvestCtx, projectID, source, hash); err != nil {
			p.logger.Warn("worktree priming: template harvest failed",
				"projectID", projectID, "source", source, "error", err)
		}
	}()
}

// Harvest copies the node_modules trees of source into the template for
// projectID/hash if that template does not already exist. It is safe to call
// concurrently: builds run in unique temp directories and the rename into
// place succeeds for exactly one caller.
func (p *Primer) Harvest(_ context.Context, projectID, source, hash string) error {
	if p.dataDir == "" || hash == "" {
		return nil
	}
	if p.HasTemplate(projectID, hash) {
		return nil
	}
	dirs, err := p.nodeModulesDirs(source)
	if err != nil {
		return fmt.Errorf("scan %s: %w", source, err)
	}
	if len(dirs) == 0 {
		return nil // nothing installed in the source yet
	}
	locks, err := p.Lockfiles(source)
	if err != nil {
		return fmt.Errorf("scan %s: %w", source, err)
	}
	templateDir := p.TemplateDir(projectID, hash)
	if err := os.MkdirAll(filepath.Dir(templateDir), 0o750); err != nil {
		return err
	}
	build, err := os.MkdirTemp(filepath.Dir(templateDir), ".building-"+filepath.Base(hash)+"-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(build)
	for _, dir := range dirs {
		from := filepath.Join(source, filepath.FromSlash(dir), "node_modules")
		to := filepath.Join(build, filepath.FromSlash(dir))
		if err := copyTree(from, to); err != nil {
			return fmt.Errorf("copy %s/node_modules: %w", dir, err)
		}
	}
	man, err := json.Marshal(manifest{Version: manifestVersion, Hash: hash, Lockfiles: locks, Dirs: dirs})
	if err != nil {
		return err
	}
	// The manifest is written last: its presence is what makes the temp build
	// directory a complete template.
	if err := os.WriteFile(filepath.Join(build, manifestName), man, 0o600); err != nil {
		return err
	}
	if err := os.Rename(build, templateDir); err != nil {
		if p.HasTemplate(projectID, hash) {
			return nil // another harvester installed a template first
		}
		return fmt.Errorf("install template: %w", err)
	}
	p.logger.Info("worktree priming: template harvested",
		"projectID", projectID, "hash", hash, "source", source, "dirs", len(dirs))
	return nil
}

// copyTree recursively copies source into target (which it creates) with
// symlink recreation. Regular files are copied by content: the template must
// not share inodes with the source tree, so later writes inside a session
// worktree (or the project checkout) can never mutate the template — or the
// source — through it.
func copyTree(source, target string) error {
	entries, err := os.ReadDir(source)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(target, 0o750); err != nil {
		return err
	}
	for _, entry := range entries {
		sPath := filepath.Join(source, entry.Name())
		tPath := filepath.Join(target, entry.Name())
		switch {
		case entry.Type()&fs.ModeSymlink != 0:
			link, err := os.Readlink(sPath)
			if err != nil {
				return err
			}
			if err := os.Symlink(link, tPath); err != nil && !errors.Is(err, os.ErrExist) {
				return err
			}
		case entry.IsDir():
			if err := copyTree(sPath, tPath); err != nil {
				return err
			}
		case entry.Type().IsRegular():
			if err := copyFile(sPath, tPath); err != nil {
				return err
			}
		default:
			continue
		}
	}
	return nil
}
