# GuardScan distribution launch checklist

## Implementation progress — local automation complete, channel acceptance pending

- [x] Implement the exact-source RC and stable train with 30-minute reconciliation and a 24-hour machine promotion policy.
- [x] Add an append-only hash-chained ledger, idempotent remote classification, integrity incidents, and forward-fix rollback planning.
- [x] Build the full npm/native/PyPI manifest, deterministic archives and wheels, artifact SBOMs, signed checksums, and build attestations.
- [x] Implement OIDC npm/PyPI publication plus GitHub, Homebrew, Scoop, WinGet, and Chocolatey workflows.
- [x] Add hourly fail-closed canaries for every selected install contract and serialize protected ledger updates.
- [x] Add release CLI interfaces for build, manifest, publish, verify, reconcile, promote, rollback, and status.
- [x] Pass local typecheck, build, 787-test coverage suite, 53 release contracts, lint ratchet, production audit, and packed-artifact inspection.
- [ ] Complete the one-time provider/account onboarding in `docs/RELEASE_ONBOARDING.md`.
- [ ] Confirm hosted signing and cross-platform matrices, publish `1.1.0-rc.1`, and complete its 24-hour soak.
- [ ] Promote and verify `1.1.0` on every public channel; moderated registries remain pending until external acceptance.

## Checkpoint A — clean npm and npm-client release

- [ ] GS-DIST-001 split the dirty remediation branch into reviewable delivery units and verify a clean release commit.
- [ ] GS-DIST-002 raise the supported Node floor to a non-EOL line, recommended Node 22, and publish the OS/capability support policy.
- [ ] GS-DIST-003 reserve channel names and secure publisher identities with 2FA/OIDC.
- [ ] GS-DIST-004 automate one reviewable version/changelog/lockfile release PR and protected-tag creation.
- [ ] GS-DIST-101 make package smoke invoke an actual global `guardscan` shim on Linux, macOS, and Windows.
- [ ] GS-DIST-101 test optional native dependencies in full and graceful-degradation modes.
- [ ] GS-DIST-102 add pnpm global/dlx smoke.
- [ ] GS-DIST-102 add Yarn Modern dlx/project-local smoke and separate Yarn Classic legacy smoke.
- [ ] GS-DIST-102 add Bun global/bunx smoke and document whether Node is required.
- [ ] GS-DIST-103 run post-publish canaries against the exact npm version and add scheduled registry health.
- [ ] GS-DIST-500 add tested `plan`, `prepare`, `validate`, `render`, `dry-run`, `publish`, `status`, and `resume` commands plus versioned manifest/state schemas.
- [ ] GS-DIST-500 keep workflow YAML thin by moving deterministic release logic into unit-tested modules shared by local and CI runs.
- [ ] Rehearse `1.1.0` as a prerelease/dist-tag before promoting it to `latest`.

## Checkpoint B — standalone release assets

- [ ] GS-DIST-201 confirm the proposed standalone-builder ADR by passing the Node SEA host matrix; the builder and CI feasibility jobs are implemented, while Bun compile remains rejected unless product runtime compatibility is separately established.
- [ ] GS-DIST-202 make schemas, version metadata, dynamic modules, and optional charts safe for the selected builder.
- [ ] GS-DIST-203 build macOS arm64/x64, Linux arm64/x64 glibc, and Windows x64 artifacts.
- [ ] GS-DIST-204 generate a machine-readable release manifest, SHA-256 sums, per-artifact SBOMs, and attestations.
- [ ] GS-DIST-204 establish macOS signing/notarization and Windows code signing.
- [ ] GS-DIST-205 pass the exact downloaded-artifact smoke suite with Node absent.
- [ ] GS-DIST-206 build deterministic, schema-aware renderers and golden tests for every planned package adapter.
- [ ] GS-DIST-206 validate generated adapter fixtures with each ecosystem's native tooling before publication.
- [ ] Publish immutable GitHub Release assets only after all target gates pass.

## Checkpoint C — native package managers

- [ ] GS-DIST-301 create and test the first-party Homebrew tap on macOS and Linuxbrew.
- [ ] GS-DIST-302 create and test a first-party Scoop manifest/bucket.
- [ ] GS-DIST-302 validate and submit WinGet manifests after Windows artifact stability.
- [ ] GS-DIST-303 build, locally test, submit, and obtain approval for the Chocolatey package.
- [ ] Generate adapter versions, URLs, and hashes from the canonical release manifest.
- [ ] Exercise install, upgrade, uninstall, and rollback for every native channel.

## Checkpoint D — optional channels

- [ ] GS-DIST-401 decide whether Python users justify a PyPI/pipx channel.
- [ ] If approved, reserve the PyPI project and prove platform wheels on TestPyPI.
- [ ] GS-DIST-402 bundle the exact native executable in each wheel; do not bootstrap npm/npx or download on first run.
- [ ] Prefer `pipx install` in end-user docs and test install/upgrade/uninstall/yank behavior.
- [ ] Evaluate a signed multi-architecture GHCR image before APT/RPM or shell installers.

## Cross-cutting release and operations

- [ ] GS-DIST-501 compose reusable, matrix-based workflows with immutable artifact handoffs and a single-release concurrency lock.
- [ ] GS-DIST-502 pin release actions, minimize permissions, remove long-lived token fallback after OIDC is proven, and protect tags/releases.
- [ ] GS-DIST-503 document and rehearse rollback for npm, GitHub, Homebrew, Scoop, WinGet, Chocolatey, and optional PyPI.
- [ ] GS-DIST-504 publish only commands that resolve to tested public artifacts; label preview channels explicitly.
- [ ] GS-DIST-505 detect channel drift, broken URLs, bad checksums, signing expiry, and installation failures without end-user telemetry.
- [ ] GS-DIST-506 open reviewable, no-op-aware downstream update pull requests from GS-DIST-206 output.
- [ ] GS-DIST-507 persist a release ledger and prove dry-run, status, no-op rerun, remote-conflict detection, and partial-release resume.
- [ ] GS-DIST-508 automate reviewed release-tool/Action/template updates, ownership routing, credential-expiry alerts, and scheduled rehearsals.
- [ ] GS-DIST-509 document and test the narrow renderer/validator/smoke/rollback interface required to add a future channel.

## Final go/no-go gate

- [ ] One protected source commit and one version produced every advertised artifact.
- [ ] Exact-artifact install/version/help/offline-scan/SBOM/upgrade/uninstall tests pass on every supported target.
- [ ] Provenance, checksums, platform signatures, release manifest, SBOMs, and verification instructions are public.
- [ ] Channel owners, support route, incident communication, and rollback runbooks are active.
- [ ] A routine release requires one release PR plus a machine-approved 24-hour RC soak and no manual version, URL, checksum, manifest, or promotion synchronization.
- [ ] Release automation can be dry-run, inspected, safely retried, and resumed without rebuilding artifacts.
- [ ] No documentation overstates Bun-runtime, Python-native, Homebrew-core, offline, privacy, or platform support.
