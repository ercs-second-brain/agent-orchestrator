# Desktop release architecture

This repository publishes its own GitHub Releases. The desktop updater and
`ao start` both read **`ercs-second-brain/agent-orchestrator`**. See
[docs/release-repo.md](../../docs/release-repo.md).

## Cut a release

1. Land the changes you want on `main`.
2. Tag a stable semver and push it:

```bash
git tag v0.10.4
git push origin v0.10.4
```

3. `.github/workflows/release.yml` builds the four desktop targets, writes
   `latest.yml` / `latest-mac.yml` / `latest-linux.yml`, and publishes the
   GitHub Release. The Electron updater and `ao start` then see those assets.

You can also run **Release** from the Actions tab (`workflow_dispatch`) and
pass a version.

`.github/workflows/build-artifacts.yml` remains a dispatchable unsigned
builder for one-off artifacts. It does not create a release.

## Channels and assets

Stable tags must look like `v1.2.3` (no prerelease suffix) so
`/releases/latest` stays on the updater's stable channel.
`.github/workflows/release-latest-guard.yml` checks that latest is a real
stable release and still carries the updater feed files.

macOS must keep publishing the **zip** (and `latest-mac.yml`) forever:
electron-updater cannot install an update from a dmg. The dmg is first-install
only. Verify a signed macOS artifact with
`frontend/scripts/verify-mac-artifact.sh`, never a plain `unzip`.

## Signing

This workflow publishes unsigned artifacts unless Apple/Windows signing
secrets are present in the repository. Unsigned macOS builds will need a
right-click Open the first time. Add signing credentials later without
changing the update URL.
