# Release repository

This checkout is an independent repository, not a GitHub fork. Desktop updates,
`ao start` downloads, and GitHub Releases all come from **`ercs-second-brain/agent-orchestrator`**.

Those three surfaces must name the same `owner/repo`. If they drift, installed
clients keep fetching from the old owner and only survive through GitHub's
rename redirect — which is not a contract.

| Surface | Source of truth |
| --- | --- |
| Electron updater feed (`app-update.yml`) | `AO_RELEASE_REPO` at build time, else `DEFAULT_RELEASE_REPO` in `frontend/forge.config.ts` |
| Feature-build picker fallback | `frontend/src/main/feature-builds.ts` (reads the baked `app-update.yml` when packaged) |
| `ao start` download URL | `releaseRepo` in `backend/internal/cli/start.go` (overridable with `-ldflags`) |
| In-app issue / star links | `frontend/src/shared/github-repo.ts` |

CI sets `AO_RELEASE_REPO=${{ github.repository }}` so a build published from
this repo never bakes a different feed. `.github/workflows/release.yml` is the
publisher for this repository: tag `vX.Y.Z` (or dispatch the workflow) to cut a
GitHub Release the updater and `ao start` can see.

Unsigned artifacts are enough for Linux/Windows and for `ao start` on macOS
(zip). Notarized macOS dmgs need Apple signing credentials in the repo secrets.
