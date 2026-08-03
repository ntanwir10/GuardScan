# GuardScan multi-channel distribution and launch plan

## Active execution plan — v1.1.0 release closure (2026-08-02)

### Objective

Move GuardScan from a clean, CI-green `release/1.1.0` implementation branch to
an operational RC-first release train that publishes `1.1.0-rc.1`, observes it
for 24 hours, and promotes the unchanged stable source to `1.1.0` across npm,
GitHub Releases, the shared Homebrew/Scoop catalog, PyPI, WinGet, and
Chocolatey. Homebrew Core remains an optional discovery channel and must never
block the first-party Homebrew tap or the stable release.

The plan separates repository work from external authority boundaries. Code,
tests, workflow definitions, documentation, and bootstrap branches are
automatable. Account creation, legal agreements, trusted-publisher approval,
Apple identity, Azure identity, and registry moderation require provider-owned
state and cannot be simulated by repository changes.

### Current baseline

- Source: clean `release/1.1.0` at `d94a07a5cf9c2bf06723cdcbb3ef80f3d6982636`.
- Review: PR #32 is open and draft; its exact-head 27-job CI run is green.
- Public state: npm and GitHub stop at `1.0.5`; every new 1.1.0 channel is
  unpublished.
- Automation: release workflows exist only on the release branch, while
  GitHub requires dispatch and scheduled workflows to exist on the default
  branch. `RELEASE_AUTOMATION_ENABLED` is intentionally false.
- Provider state: release environments exist but are empty; the GitHub App,
  signing identities, moderated-registry credentials, and trusted publishers
  are not proven. The current local GitHub CLI credential is invalid.
- Shared catalog: `ntanwir10/homebrew-tap` is public, protected, and healthy in
  its intentionally empty bootstrap state.

### Architecture and operating decisions

1. Keep `release/1.1.0` as the stable product source. Land inert workflow
   definitions on `main` through a separate bootstrap PR, then merge that
   bootstrap commit back into the release branch before deriving the RC.
2. Keep automation disabled until every release environment passes a
   credential/preflight rehearsal. Tags alone never authorize publication.
3. Use the exact tested npm tarball for npm, pnpm, Yarn, and Bun. These clients
   are compatibility channels, not independent publications.
4. Use the exact signed standalone executable for GitHub, the shared catalog,
   WinGet, Chocolatey, and the platform wheels published to PyPI.
5. Keep Homebrew and Scoop in one generated, cryptographically locked catalog.
   GuardScan is authoritative; the catalog is a projection and reports back by
   signed dispatch plus scheduled reconciliation.
6. Treat Homebrew Core as optional. Include it in release state only when an
   explicit provider setting enables submission. Never advertise
   `brew install guardscan` until Core acceptance and a public canary succeed.
7. Treat WinGet and Chocolatey `submitted`, `accepted`, and `verified` as
   different append-only states. Expected moderation delay is pending, not
   failure.
8. Use tests first for behavioral fixes. Workflow text/structure tests must
   reproduce each release bug before the YAML or release logic is changed.
9. Keep the Cloudflare retirement downstream of verified stable publication:
   seven days of `410 Gone`, then deletion, with no collection or redirect.

### Dependency graph

```text
Release-content truth (changelog, docs, ADR, command contracts)
    |
    +--> Workflow correctness (PR readiness, per-version canaries,
    |    moderation states, native TestPyPI lifecycle)
    |       |
    |       +--> Default-branch workflow bootstrap
    |               |
    |               +--> GitHub App and repository protections
    |               +--> npm/PyPI trusted publishers
    |               +--> Apple/Azure signing
    |               +--> WinGet/Chocolatey publisher onboarding
    |                       |
    |                       +--> v1.1.0-rc.1 publication
    |                               |
    |                               +--> 24-hour canary evidence
    |                                       |
    |                                       +--> v1.1.0 promotion
    |                                               |
    |                                               +--> moderated acceptance
    |                                               +--> Homebrew Core optional PR
    |                                               +--> Cloudflare retirement
    +--> Whole-product acceptance expansion -----------------------^
```

### Phase 1 — release-content and product-contract truth

#### Task 1.1 — Reconcile the 1.1.0 changelog

**Description:** Move every 1.1.0-bound entry out of `Unreleased`, merge it into
one authoritative `1.1.0` section, and harden source validation so a stable
release cannot pass with populated release notes stranded above its version.

**Acceptance criteria:**

- One stable `1.1.0` section contains all release changes, including hosted
  telemetry retirement.
- Candidate derivation adds only RC identity and does not duplicate stable
  release notes.
- A focused regression test fails for the former split-changelog structure.

**Verification:** `npm run test:release`; `npm run release:validate`.

**Dependencies:** None. **Scope:** Medium, 3-4 files.

#### Task 1.2 — Correct public command syntax and command inventory

**Description:** Align README and quick-start examples with the actual
Commander definitions for `review`, `docs`, `test-gen`, and `refactor`, and add
a contract test that checks documented invocations against `--help` output.

**Acceptance criteria:**

- No documented positional argument is accepted only in prose.
- The documented 29-command inventory matches registered commands.
- Documentation tests fail if command syntax drifts again.

**Verification:** focused documentation/CLI test; full build and tests.

**Dependencies:** None. **Scope:** Small, 2-3 files.

#### Task 1.3 — Promote the standalone ADR from proposal to accepted evidence

**Description:** Define the exact evidence required to change ADR 006 from
`Proposed` to `Accepted`. Repository feasibility can accept the architecture;
production signing evidence remains an explicit launch gate.

**Acceptance criteria:**

- ADR status and evidence distinguish architectural acceptance from provider
  rehearsal.
- Reduced standalone capabilities remain explicit and machine-readable.
- Documentation never claims chart rendering or accurate tokenization in SEA.

**Verification:** release documentation contract tests and review.

**Dependencies:** Task 1.1. **Scope:** Small, 2 files.

#### Task 1.4 — Expand whole-product acceptance evidence

**Description:** Replace placeholder RAG assertions with deterministic local
index/search/chat tests, and maintain an acceptance matrix that separates
offline core behavior, optional external tools, mocked BYOK providers, and live
provider rehearsals.

**Acceptance criteria:**

- RAG tests exercise real repository indexing and retrieval with deterministic
  local doubles only at the network/provider boundary.
- Every advertised command has more than a help-only contract or is explicitly
  classified as requiring an external tool/provider.
- No CI test requires paid API credentials or uploads source code.

**Verification:** focused RAG/command tests; full coverage suite.

**Dependencies:** Task 1.2. **Scope:** split into multiple medium follow-ups.

### Phase 2 — release workflow correctness

#### Task 2.1 — Make canary execution version-safe

**Description:** Stop selecting the first active train as a shared checkout.
Use default-branch release tooling for ledger recording while every matrix item
continues to verify its own immutable public version.

**Acceptance criteria:**

- Two simultaneous active trains cannot use one another's tag as tooling.
- Manual single-version canaries remain supported.
- Workflow contract tests reproduce and prevent the former first-train bug.

**Verification:** release workflow tests and YAML parse.

**Dependencies:** Phase 1 plan only. **Scope:** Small, 2 files.

#### Task 2.2 — Preserve pending moderation states

**Description:** Make WinGet and Chocolatey absence during normal review an
explicit pending result. Only install, signature, checksum, or invocation
failures after discovery may produce `failed`.

**Acceptance criteria:**

- “Package not public yet” remains pending.
- A discovered package that fails installation/invocation is failed.
- Reconciliation keeps polling pending channels without opening an incident.

**Verification:** workflow regression test plus release-state unit tests.

**Dependencies:** None. **Scope:** Small, 2-3 files.

#### Task 2.3 — Add idempotent moderated-registry submission evidence

**Description:** Capture WinGet PR identity and Chocolatey package submission
identity, distinguish matching prior submissions from integrity conflicts, and
persist these identities in the ledger.

**Acceptance criteria:**

- Rerunning a matching submission records/reuses the same identity.
- Conflicting remote content stops as an integrity incident.
- WinGet submission and catalog acceptance are separate states.

**Verification:** mocked remote-contract tests and workflow text contracts.

**Dependencies:** Task 2.2. **Scope:** Medium, 4-5 files.

#### Task 2.4 — Test every TestPyPI wheel natively before PyPI

**Description:** After TestPyPI publication, install the exact version with pip
and pipx on Linux x64/arm64, macOS x64/arm64, and Windows x64. Production PyPI
must depend on the complete matrix.

**Acceptance criteria:**

- All five platform tags select and run their intended executable.
- Version, help, offline scan, and uninstall pass for pip and pipx.
- PyPI publication cannot start if any native TestPyPI lifecycle fails.

**Verification:** workflow structure tests, then hosted RC rehearsal.

**Dependencies:** Task 2.1. **Scope:** Medium, 2 files.

#### Task 2.5 — Exercise reduced standalone capabilities

**Description:** Add a deterministic runtime capability diagnostic and smoke
that actually invokes token-count estimation and chart-unavailable degradation
with optional native modules absent.

**Acceptance criteria:**

- SEA reports `accurateTokenCounting=false` and demonstrates estimated token
  counting without `tiktoken`.
- A report path that requests charts completes safely without
  `chartjs-node-canvas` and records the reduced capability.
- Artifact metadata is derived from the observed smoke, not an unconditional
  boolean.

**Verification:** failing focused tests first, local package tests, five hosted
SEA jobs.

**Dependencies:** Task 1.3. **Scope:** Medium, 4-5 files.

#### Task 2.6 — Make release-PR readiness zero-touch and fail closed

**Description:** Candidate preparation must inspect the exact PR, mark the
bot-owned release PR ready when allowed, and fail if it is closed, from a fork,
or no longer targets `main`. Promotion still requires unchanged head and all
required checks.

**Acceptance criteria:**

- The current draft state cannot silently deadlock promotion.
- Untrusted/fork PRs never receive release credentials or tags.
- Ready state, base branch, head SHA, and mergeability are recorded.

**Verification:** workflow contract tests and a non-publishing GitHub rehearsal.

**Dependencies:** Tasks 2.1-2.5. **Scope:** Small, 2 files.

#### Task 2.7 — Make Homebrew Core honestly optional

**Description:** Remove phantom planned state when Core submission is not
configured. If enabled, render, validate, submit, record PR identity, poll
acceptance, and verify public installation without blocking required channels.

**Acceptance criteria:**

- Stable completion is possible with the first-party tap while Core is off.
- When on, Core progresses `submitted -> accepted -> verified` with evidence.
- User docs expose `brew install guardscan` only after verification.

**Verification:** release-state tests, renderer tests, workflow contracts.

**Dependencies:** Tasks 2.2-2.3. **Scope:** split into medium implementation
and external onboarding tasks.

### Phase 3 — default-branch bootstrap and repository controls

#### Task 3.1 — Create an inert workflow-bootstrap change

**Description:** Prepare a branch from `origin/main` containing the reusable
release workflows and their default-branch entrypoints, with automation still
off. Do not merge the product release or create a release tag.

**Acceptance criteria:**

- GitHub lists the train, canary, build, publish, and Release Please workflows
  on `main` after merge.
- Schedules and dispatches are inert while the repository variable is false.
- Bootstrap CI passes and no registry receives a publication request.

**Verification:** PR checks, GitHub workflow listing, dry dispatch rejection.

**Dependencies:** Phase 2 complete. **Scope:** remote Git/GitHub operation.

#### Task 3.2 — Finish GitHub App and protection setup

**Description:** Install `guardscan-release-bot` on GuardScan and the shared
catalog; configure short-lived token inputs; protect release tags and restrict
ledger writes to the App while preserving break-glass recovery.

**Acceptance criteria:**

- No long-lived general-purpose token publishes a release.
- Release tags and ledger writes are limited to the intended identity.
- Catalog notifications authenticate cross-repository and are idempotent.

**Verification:** permission-negative tests from a fork and positive dry runs.

**Dependencies:** Valid GitHub authentication and Task 3.1.

#### Task 3.3 — Merge bootstrap truth back into the stable release PR

**Description:** Merge `main` into `release/1.1.0`, resolve only release-owned
files, rerun the exact source gate, and confirm PR #32 remains unchanged after
the final approved head is selected.

**Acceptance criteria:** clean worktree, green exact-SHA CI, PR ready for
review, no unreviewed product change after RC derivation.

**Verification:** full local gate and hosted CI.

**Dependencies:** Tasks 3.1-3.2.

### Phase 4 — provider onboarding and production rehearsals

#### Task 4.1 — npm and PyPI trusted publishing

Configure exact workflow/environment bindings for npm, TestPyPI, and PyPI;
rehearse OIDC issuance; verify provenance; remove the legacy `NPM_TOKEN` only
after OIDC succeeds.

#### Task 4.2 — Apple and Windows signing

Provision Developer ID/notary credentials and Azure Artifact Signing OIDC;
build, sign, notarize/timestamp, staple, and verify representative artifacts.

#### Task 4.3 — WinGet and Chocolatey publisher authority

Complete the Microsoft CLA and scoped GitHub credential; confirm Chocolatey
publisher ownership and API key; submit non-public validation fixtures where
the provider allows it.

#### Task 4.4 — Homebrew Core optional authority

Configure a narrowly scoped contribution credential and enable the optional
channel only after the first-party stable formula is verified.

#### Task 4.5 — Credential-expiry monitoring

Add scheduled checks for certificate dates, App installation health, OIDC
bindings, and provider identity revalidation, with alerts that contain no
secret material.

**Phase 4 acceptance:** every required environment passes a preflight, secrets
stay out of logs/artifacts, fork PRs cannot mint tokens, and automation remains
off until the final go/no-go decision.

### Phase 5 — RC, soak, stable promotion, and recovery

#### Task 5.1 — Publish `v1.1.0-rc.1`

Enable automation and dispatch the candidate from `main` using PR #32. Publish
npm `next`, an immutable GitHub prerelease, TestPyPI then PyPI `1.1.0rc1`, and
isolated shared-catalog preview branches. Render but do not submit RC WinGet or
Chocolatey packages.

#### Task 5.2 — Complete the 24-hour soak

Require at least 24 hourly samples per required channel, fresh final evidence,
unchanged source head, no high/critical dependency vulnerability, valid public
digests/signatures, and no open release/security incident.

#### Task 5.3 — Promote stable `v1.1.0`

Materialize the machine promotion decision, auto-merge the unchanged PR,
rebuild/sign/attest from the exact merge commit, publish npm `latest`, GitHub,
PyPI, the shared catalog, then submit WinGet and Chocolatey.

#### Task 5.4 — Reconcile moderated channels and optional Core

Poll external review without misclassifying delay. Mark release completion only
when every required selected channel is verified; keep optional Core evidence
separate.

#### Task 5.5 — Execute post-release Cloudflare retirement

After stable public verification, serve seven days of `410 Gone` without
collection or redirect, monitor old-client traffic only through aggregate
infrastructure signals if already available, then remove the hosted Worker and
DNS/runtime resources according to ADR 007.

### Verification checkpoints

#### Checkpoint A — repository correctness

- Focused regression tests are red before each behavioral fix and green after.
- `npm run typecheck`, `npm run build`, `npm run test:release`, release package
  verification, documentation contracts, and `git diff --check` pass.

#### Checkpoint B — whole product

- Full coverage suite passes in band.
- Production dependency audit has no high or critical result.
- Packed npm artifact and all five package-manager smokes pass.
- Offline scan, SPDX, CycloneDX, telemetry disabled, and declared optional
  degradation pass from installed artifacts.

#### Checkpoint C — hosted release feasibility

- Exact-SHA 27-job or expanded CI matrix passes.
- Five signed native artifacts pass platform verification.
- Five TestPyPI wheels pass native pip/pipx lifecycles.

#### Checkpoint D — public RC

- Manifest, signatures, SBOMs, checksums, attestations, URLs, and public bytes
  agree for every artifact.
- Required channel canaries remain green for 24 hours.

#### Checkpoint E — stable completion

- Every required public install command reports `1.1.0`.
- Moderated channels are tracked as pending/submitted until truly public.
- Rollback/forward-fix procedures are executable without overwriting artifacts.

### Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Workflow bootstrap accidentally publishes | Critical | Keep automation false; no provider credentials in bootstrap environments |
| RC source changes during soak | Critical | Bind candidate metadata to PR head and fail promotion on any head change |
| Registry rerun overwrites/conflicts | Critical | Digest preflight; identical means continue, different means incident |
| Apple/Azure setup blocks native launch | High | Rehearse before enabling; never publish unsigned substitutes |
| Moderation lasts days | Medium | Separate submitted/accepted/verified; do not block already verified first-party channels |
| Homebrew Core rejects formula | Low | First-party tap remains supported; Core stays optional |
| Shared catalog drifts | High | One generated projection, lock file, protected CI, dispatch plus reconciliation |
| Optional native modules crash SEA | High | Exercise actual fallback paths and bind observed capabilities into metadata |
| Documentation overstates availability | High | Publish install commands only from verified ledger state |
| Legacy Cloudflare clients keep sending | Medium | Stable upgrade notice, seven-day 410 window, then teardown |

### External authority boundaries

Implementation may prepare every command and validation, but it must stop for
the owner when a provider requires identity verification, MFA, legal terms,
certificate purchase/renewal, CLA acceptance, trusted-publisher approval, or
moderator action. These are not code defects and must not be bypassed with
long-lived or over-scoped credentials.

Status: historical design record, superseded by the approved RC-first zero-touch release train. This document does not authorize a release by itself. The current operating contract is in `docs/RELEASE_AUTOMATION.md`, and provider onboarding is in `docs/RELEASE_ONBOARDING.md`.

## Implementation status — 2026-07-25

The complete local implementation now includes:

- an append-only, hash-chained release ledger and machine-generated 24-hour promotion decision;
- exact-source RC derivation and stable promotion through a protected GitHub App identity;
- production artifact manifests covering npm, five signed SEA archives, and five executable-bearing PyPI wheels;
- OIDC publication for npm and PyPI, immutable GitHub assets, and generated Homebrew, Scoop, WinGet, and Chocolatey adapters;
- scheduled public canaries, deterministic reconciliation, and append-only rollback/forward-fix planning;
- required local and hosted gates for Node 22/24/26, npm/pnpm/Yarn/Bun, offline scan, SPDX, CycloneDX, signatures, provenance, and package lifecycle checks.

Local tests and contract gates pass. Hosted signing, registry publication, the 24-hour RC soak, and moderated-channel acceptance remain pending the one-time external onboarding in `docs/RELEASE_ONBOARDING.md`.

## Outcome

Ship GuardScan through trustworthy, testable installation channels without creating divergent implementations:

- npm remains the canonical Node package.
- npm-compatible clients (pnpm, Yarn, and Bun) consume that same npm package; they are compatibility targets, not separate publications.
- GitHub Releases becomes the canonical source for versioned standalone executables and their integrity metadata.
- Homebrew, Scoop, WinGet, and Chocolatey become thin installation adapters over immutable release artifacts.
- PyPI publishes platform wheels that bundle the exact signed release binary and expose a console entry point; it does not invoke npm, npx, or an unverified runtime download.
- Every channel carries the same GuardScan version and has an explicit install, upgrade, uninstall, smoke-test, rollback, and ownership contract.
- Routine future releases are prepared, built, verified, published, and monitored through reusable automation; a machine policy promotes an unchanged RC after its 24-hour soak without hand-edited versions, checksums, URLs, manifests, or human approval.

## Historical baseline at plan approval

- The repository package is `guardscan@1.1.0`; npm `latest` is currently `1.0.5`.
- The npm package has a valid `bin` entry and Node shebang, and the package smoke suite verifies packed contents and important offline/privacy contracts.
- CI tests Node 18/20/22/24/26 on Ubuntu and Windows, but package smoke runs only with Node 24 and does not test macOS or invoke a globally installed `guardscan` shim.
- The declared runtime floor is Node 18 even though Node 18 and Node 20 are end-of-life. Optional native chart dependencies also have a narrower Node 18 floor than the package declaration.
- Tag releases publish npm first and then create a notes-only GitHub Release. There are no standalone binaries, checksums, release manifest, signatures, attestations, Homebrew formulae, Python distributions, Chocolatey packages, Scoop manifests, or WinGet manifests.
- Release logic currently lives in one growing CI workflow, has no reusable release-tool contract, and does not persist enough machine-readable state to safely resume a partially published multi-channel release.
- The current worktree is a large, dirty remediation branch. It must be split and reviewed before it becomes a release source.

## Architectural decisions

1. **One implementation and one version.** The TypeScript/Node CLI remains the product implementation. Adapters may launch it but may not fork behavior.
2. **Separate runtime-bearing and runtime-free channels.** npm, pnpm, Yarn, and Bun installs require a supported Node runtime unless GuardScan explicitly passes a future Bun-runtime compatibility gate. Native channels use standalone executables and must run with Node absent from `PATH`.
3. **Build once per immutable tag.** A release workflow creates all publishable artifacts from one protected tag/commit, tests the exact artifacts, then promotes them. Downstream package metadata references those exact assets and SHA-256 values.
4. **No install-time execution of unversioned code.** Installers may download only versioned immutable assets over HTTPS and must verify checksums. PyPI will not bootstrap through npm/npx, and package adapters will not use a `latest` download URL.
5. **No big-bang multi-registry publish.** Ship in checkpoints: npm-compatible clients, standalone artifacts, first-party native channels, community registries, then optional PyPI.
6. **Truthful support labels.** Documentation identifies channels as stable, preview, community-reviewed, or deferred. Availability in a package manager is not described as runtime compatibility with that package manager's JavaScript engine.
7. **Rollback is designed before publishing.** Every channel gets an emergency procedure and retained-version policy before its first stable release.
8. **One declarative release authority.** `cli/package.json` remains the product-version source, while a generated release manifest becomes the authority for artifact names, digests, URLs, capabilities, and channel rendering. Derived data is never copied manually between workflows or package-manager files.
9. **Thin workflows, testable release code.** GitHub Actions YAML coordinates jobs and permissions; deterministic version resolution, manifest generation, validation, rendering, and release-state logic lives in small, unit-tested scripts that run identically locally and in CI.
10. **Generated adapters with checked-in review diffs.** Homebrew, Scoop, WinGet, Chocolatey, optional PyPI, and documentation snippets are rendered from templates plus the release manifest. Automation opens reviewable update pull requests instead of directly mutating every downstream stable channel.
11. **Idempotent, resumable publication.** Each publish step records immutable input/output identity and treats an already-published matching artifact as success; a mismatched artifact is a hard failure. A retry resumes from verified state and never rebuilds or overwrites the version.
12. **Cost-aware verification tiers.** Pull requests run fast package and generator checks, release candidates run the full platform/artifact matrix, stable promotion reuses those exact tested artifacts, and scheduled canaries use a minimal representative matrix.
13. **One authoritative repository and one shared generated catalog.**
    GuardScan owns release state. `ntanwir10/homebrew-tap` contains both
    `Formula/guardscan.rb` and `bucket/guardscan.json`, bound by
    `channel-lock.json`; it never changes GuardScan state directly. A
    post-merge dispatch reduces latency and 30-minute reconciliation guarantees
    convergence. The repositories do not use submodules, subtrees, mirroring,
    or bidirectional synchronization.
14. **Homebrew Core is an optional discovery layer.** The first-party tap is
    the stable fallback. After a stable release, automation may submit a
    source-building Homebrew Core formula using Homebrew `node` and
    `std_npm_args`; Core acceptance and its public canary are tracked but do not
    block the release.

## Target channel matrix

| Channel | Publication model | Initial user command | Initial status |
| --- | --- | --- | --- |
| npm | Publish `guardscan` to npm with trusted publishing | `npm install -g guardscan` | Canonical Node channel |
| pnpm | Reuse npm package; no second publication | `pnpm add -g guardscan` or `pnpm dlx guardscan@VERSION` | Phase 1 |
| Yarn Modern | Reuse npm package; prefer one-shot/project-local use | `yarn dlx guardscan@VERSION` | Phase 1 |
| Yarn Classic | Reuse npm package; legacy compatibility only | `yarn global add guardscan` | Best effort, tested separately |
| Bun | Reuse npm package; Node remains required until proven otherwise | `bun install --global guardscan` or `bunx guardscan@VERSION` | Phase 1 preview until matrix passes |
| GitHub Releases | Signed/attested archives per OS/CPU plus manifest/checksums | Download a versioned archive | Phase 2 canonical binary channel |
| Homebrew | Formula in the shared first-party catalog referencing immutable release assets | `brew install ntanwir10/tap/guardscan` | Phase 3; Core later |
| Homebrew Core | Source-building formula using Homebrew `node` | `brew install guardscan` | Optional after stable acceptance and public canary |
| Scoop | JSON manifest in the same shared catalog referencing the Windows portable archive | `scoop bucket add guardscan https://github.com/ntanwir10/homebrew-tap`, then `scoop install guardscan` | Phase 3 |
| WinGet | Community manifest referencing signed Windows artifact | `winget install <publisher>.GuardScan` | Phase 3 after binary stability |
| Chocolatey | `.nupkg` referencing or embedding the official Windows artifact | `choco install guardscan` | Phase 3 after binary stability |
| PyPI/pipx | Platform wheels bundling the exact standalone binary | `pipx install guardscan-cli` (name to be reserved) | Phase 4 decision gate |
| GHCR | Versioned OCI image for CI and isolated scans | `docker run ... ghcr.io/ntanwir10/guardscan:VERSION` | Optional Phase 4 |

## Workstream 0: release baseline and product contract

### GS-DIST-001 — Split and stabilize the current release candidate

- **Depends on:** none.
- **Files/systems:** current worktree, changelog, branch protection, CI.
- **Scope:** split the broad remediation into independently reviewable commits or stacked pull requests; preserve user changes; reconcile the `1.1.0` changelog and release notes; run all existing release gates from a clean checkout.
- **Acceptance:** no unexplained dirty files; every release-critical change is reviewed; `git diff --check`, typecheck, build, full tests, coverage, lint ratchet, audit, package smoke, and packed-artifact inspection pass on the exact release commit.
- **Verification:** clone or checkout the protected commit into a clean worktree and execute the documented release-gate sequence.

### GS-DIST-002 — Define supported runtimes, operating systems, and capabilities

- **Depends on:** GS-DIST-001.
- **Files:** `cli/package.json`, CI matrix, README/support policy, optional-chart code and tests.
- **Scope:** raise the supported Node floor to a non-EOL line, recommended Node `>=22`; define stable OS/CPU targets; state whether chart rendering is optional; distinguish npm-installed and standalone capabilities.
- **Acceptance:** package metadata, docs, CI, native dependency behavior, and error messages agree; unsupported runtimes fail clearly; no EOL Node line is advertised as supported.
- **Verification:** test the exact minimum Node release plus current supported LTS lines; test core CLI both with and without optional native chart dependencies.

### GS-DIST-003 — Reserve names and secure publisher identities

- **Depends on:** none.
- **Systems:** npm, GitHub, Homebrew tap, Chocolatey, PyPI/TestPyPI, WinGet, Scoop.
- **Scope:** search for existing packages and ownership conflicts; reserve available names; define publisher IDs; enable hardware-backed 2FA; document owners and recovery contacts; use OIDC/trusted publishing where supported.
- **Acceptance:** each proposed identifier has an owner and collision decision; no production credential is stored in the repository; at least two trusted maintainers can recover release access.
- **Verification:** read-only ownership audit and a non-production/TestPyPI or draft-package authentication rehearsal.

### GS-DIST-004 — Automate version, changelog, and release-candidate preparation

- **Depends on:** GS-DIST-001.
- **Files:** release automation configuration, `cli/package.json`, `cli/package-lock.json`, `cli/CHANGELOG.md`, contribution/release docs.
- **Scope:** select and configure a maintained release-PR mechanism suitable for this single-package repository; derive the next semantic version from reviewed change metadata; update package and lock versions plus changelog in one reviewable pull request; create a protected tag only from the merged release commit.
- **Acceptance:** maintainers do not manually synchronize version strings or changelog headings; a no-change run is a no-op; prerelease and stable versions are deterministic; breaking/minor/patch intent is visible before merge.
- **Verification:** fixture-based dry runs for patch, minor, major, prerelease, no-change, and malformed-history cases, followed by a non-publishing release-PR rehearsal.

## Workstream 1: npm-compatible client launch

### GS-DIST-101 — Harden the npm artifact and global binary contract

- **Depends on:** GS-DIST-001, GS-DIST-002.
- **Files:** `cli/package.json`, `cli/package-lock.json`, `cli/scripts/package-smoke.js`, `.github/workflows/ci.yml` or a dedicated package workflow.
- **Scope:** test an actual global install and the generated `guardscan` shim, not only `node dist/index.js`; validate `--version`, `--help`, initialization, offline static scan, SBOM, telemetry-disabled state, upgrade, and uninstall; add macOS.
- **Acceptance:** the packed tarball passes on Linux, macOS, and Windows using the supported Node floor and primary LTS; optional native dependencies either install successfully or produce documented graceful degradation.
- **Verification:** PR jobs install the locally packed tarball globally in isolated homes with install scripts both enabled and disabled.

### GS-DIST-102 — Add pnpm, Yarn, and Bun compatibility smoke jobs

- **Depends on:** GS-DIST-101.
- **Files:** new package-manager smoke script(s), CI workflow, install documentation.
- **Scope:** test pnpm global and `dlx`; Yarn Modern `dlx` and project-local execution; Yarn Classic global only as legacy coverage; Bun global and `bunx`; pin tested package-manager versions in CI.
- **Acceptance:** each advertised command launches the packed GuardScan artifact, reports the expected version, completes a non-destructive offline scan, and leaves telemetry disabled. Bun documentation explicitly says Node is required unless a Node-free Bun runtime test passes.
- **Verification:** run the client matrix against the local tarball on PRs and against `guardscan@VERSION` after publication. Do not create extra application lockfiles solely to publish through these clients.

### GS-DIST-103 — Add post-publication registry canaries

- **Depends on:** GS-DIST-102.
- **Files/systems:** release workflow, scheduled workflow.
- **Scope:** after npm publish, install the exact version through npm, pnpm, Yarn Modern, and Bun; add a daily read-only canary for the latest stable version.
- **Acceptance:** a release is not marked complete until the registry version is resolvable and the client matrix passes; failures produce a channel-status issue or alert without collecting end-user telemetry.
- **Verification:** rehearse with an npm prerelease/dist-tag before the stable release.

## Workstream 2: standalone artifact foundation

### GS-DIST-201 — Decide the standalone build technology through an ADR and spike

- **Depends on:** GS-DIST-002.
- **Files:** `docs/adrs/`, isolated build prototypes, no production packaging switch until approved.
- **Scope:** compare Node Single Executable Applications, a maintained Node bundler/packager, and Bun compilation against GuardScan's dynamic imports, `package.json` access, schemas, optional native modules, subprocesses, and private-state behavior.
- **Acceptance:** the ADR records security maintenance, licensing, platform coverage, binary size/startup, native-module support, asset embedding, reproducibility, code signing, and failure behavior. The chosen prototype passes the core offline smoke suite with Node removed from `PATH`.
- **Verification:** build and execute prototypes on native Linux, macOS, and Windows runners; reject any option that silently omits required scanners or schemas.

### GS-DIST-202 — Make the CLI bundle/standalone safe

- **Depends on:** GS-DIST-201.
- **Files:** entrypoint/module loading, schema asset resolution, version loading, report/chart boundaries, build configuration and focused tests.
- **Scope:** eliminate unsupported dynamic loading in the selected builder; embed or colocate versioned schemas; isolate optional chart rendering; preserve safe project-code and offline policies.
- **Acceptance:** help/version/startup do not load optional native modules; static scan and both SBOM formats work; unsupported optional features return explicit status rather than crashing; no source token, environment file, test fixture, or local state is embedded.
- **Verification:** inspect artifact contents and run adversarial package smoke in temporary homes and untrusted fixture repositories.

### GS-DIST-203 — Build the initial native target matrix

- **Depends on:** GS-DIST-202.
- **Files:** dedicated release workflow and packaging scripts.
- **Scope:** initially target `darwin-arm64`, `darwin-x64`, `linux-x64-gnu`, `linux-arm64-gnu`, and `windows-x64`; defer Alpine/musl and Windows ARM64 until tested.
- **Acceptance:** each archive uses a stable name such as `guardscan-vVERSION-OS-ARCH`; the executable reports the tag version and operates with no Node installation; archives include license/notices.
- **Verification:** build on native runners where practical and run install, help, init, offline scan, SBOM, upgrade-replacement, and uninstall/removal tests.

### GS-DIST-204 — Add release integrity, provenance, and machine-readable metadata

- **Depends on:** GS-DIST-203.
- **Files:** release workflow, `release-manifest` schema/script, security and install docs.
- **Scope:** generate SHA-256 sums, per-artifact SBOMs, GitHub artifact attestations, and a release manifest containing version, commit, target, size, digest, URL, capability flags, and signature/attestation references; version the manifest schema, use stable key/list ordering, define compatibility and migration policy, retain a release-evidence bundle, and add macOS signing/notarization plus Windows code-signing workstreams.
- **Acceptance:** every executable asset is represented in the manifest and checksums; users have documented verification commands; signing failures block stable promotion; release assets are immutable after promotion; the evidence bundle records resolved metadata, tool versions, validation results, and artifact inventory for future audits and resumes.
- **Verification:** verify checksums and attestations from a clean machine; verify platform signatures using native tools; verify the manifest against its schema; run golden compatibility tests against current and prior supported manifest versions.

### GS-DIST-205 — Create native artifact smoke and compatibility gates

- **Depends on:** GS-DIST-204.
- **Files:** native smoke harness, CI workflows, fixtures.
- **Scope:** test no-Node execution, offline/no-egress behavior, privacy defaults, file permissions, path handling, Unicode/spaces, exit codes, project-code opt-in, malformed state, and optional feature degradation.
- **Acceptance:** every target passes before release promotion; failures identify target and capability; no target is published with a reduced capability set unless the release manifest and docs say so.
- **Verification:** exact downloaded release assets, not rebuilt substitutes, pass the same tests after draft upload.

### GS-DIST-206 — Build deterministic package-adapter renderers

- **Depends on:** GS-DIST-204, GS-DIST-500.
- **Files:** versioned adapter templates, renderer modules, golden fixtures, native-validator wrappers.
- **Scope:** define the narrow input/output contract that converts one release manifest into Homebrew, Scoop, WinGet, Chocolatey, optional PyPI, and installation-document metadata; keep rendering pure and side-effect free; emit stable, reviewable output with generated-file provenance headers where the format permits.
- **Acceptance:** identical manifest/template inputs produce byte-identical output; every emitted version, URL, digest, architecture, and capability comes from canonical metadata; generated output passes its ecosystem validator before any channel publication.
- **Verification:** golden tests, repeated-build identity checks, malformed/unknown-schema fixtures, and each native package-manager validator against non-publishing fixtures.

## Workstream 3: native package-manager adapters

### GS-DIST-301 — Launch a first-party Homebrew tap

- **Depends on:** GS-DIST-204, GS-DIST-205, GS-DIST-206, GS-DIST-003.
- **Files/systems:** shared `ntanwir10/homebrew-tap` catalog, formula
  template/update automation, `channel-lock.json`, release docs.
- **Scope:** generate `Formula/guardscan.rb` as a binary adapter using immutable
  versioned assets and checksums; support Apple Silicon, Intel macOS, and
  Linuxbrew where artifacts exist; avoid self-update behavior. Update it in the
  same catalog PR and lock as the Scoop manifest.
- **Acceptance:** `brew audit`, `brew style`, install, test, upgrade, and uninstall pass; formula test executes `guardscan --version` and a safe offline command; formula version/digest match the release manifest.
- **Verification:** test from a clean macOS runner on both available
  architectures and a Linuxbrew runner. After a stable release, optionally
  submit a separate source-building formula to `homebrew/core` using Homebrew
  `node` and `std_npm_args`; only advertise `brew install guardscan` after Core
  acceptance and a clean public canary.

### GS-DIST-302 — Launch Scoop and prepare WinGet

- **Depends on:** GS-DIST-204, GS-DIST-205, GS-DIST-206, GS-DIST-003.
- **Files/systems:** `bucket/guardscan.json` in the shared
  `ntanwir10/homebrew-tap` catalog, WinGet manifests or submission automation.
- **Scope:** create an architecture-aware Scoop manifest with immutable URLs
  and SHA-256; map the executable to `guardscan`; generate it in the same
  catalog PR and cryptographic lock as the Homebrew formula; define update
  automation and retained-version behavior.
- **Acceptance:** Scoop install/update/uninstall and `checkver` pass; WinGet manifests validate and pass Windows Sandbox install/upgrade/uninstall before submission.
- **Verification:** test Windows without Node installed, and verify the executable hash against the release manifest before and after each adapter install.

### GS-DIST-303 — Launch Chocolatey

- **Depends on:** GS-DIST-204, GS-DIST-205, GS-DIST-206, GS-DIST-003.
- **Files/systems:** Chocolatey packaging source, `.nuspec`, install/uninstall scripts, community repository account.
- **Scope:** package the official portable Windows artifact or download it from its immutable release URL; enforce checksum verification; include license, project URLs, release notes, and silent install behavior; automate version/checksum updates only after the first package is approved.
- **Acceptance:** `choco pack`, package validation, local install, upgrade, uninstall, verification, and cleanup pass in Windows Sandbox; no unversioned URL or mutable script executes; community moderation requirements are satisfied.
- **Verification:** local feed test followed by a prerelease/community moderation rehearsal; stable documentation is enabled only when the public package is approved.

## Workstream 4: PyPI decision and optional launcher

### GS-DIST-401 — Validate Python-channel product value and naming

- **Depends on:** GS-DIST-205, GS-DIST-003.
- **Files:** ADR/product decision, no PyPI publication yet.
- **Scope:** measure whether Python users need a PyPI-native installation path; check `guardscan` and `guardscan-cli` ownership; compare platform-wheel maintenance with the simpler native channels.
- **Acceptance:** an explicit go/no-go decision identifies supported Python versions, operating systems, wheel tags, package name, support burden, and deprecation policy.
- **Verification:** user/support evidence and a TestPyPI prototype. Default decision is no-go if the package only wraps npm/npx or downloads unverified code at runtime.

### GS-DIST-402 — If approved, build a thin, offline-capable Python launcher

- **Depends on:** approved GS-DIST-401, GS-DIST-204.
- **Files:** separate Python packaging directory or repository, `pyproject.toml`, launcher, wheel tests, trusted-publishing workflow.
- **Scope:** build platform-specific wheels that contain the exact version-matched GuardScan executable and expose the `guardscan` console command; publish with PyPI trusted publishing; prefer `pipx install` in docs.
- **Acceptance:** installation performs no npm/npx bootstrap and no first-run download; wheel version equals GuardScan version; install, run, upgrade, uninstall, offline use, and artifact identity pass on every declared wheel target.
- **Verification:** build/check wheels, install from TestPyPI with pipx in clean environments, compare embedded binary digest with the release manifest, then rehearse yanking a test release.

## Workstream 5: release orchestration, operations, and launch

### GS-DIST-500 — Establish the reusable release automation foundation

- **Depends on:** GS-DIST-004, GS-DIST-101.
- **Files:** focused `cli/scripts/release/` modules and tests, release-manifest schema, `.gitignore`, reusable CI workflow(s), maintainer documentation.
- **Scope:** define stable commands for `plan`, `prepare`, `validate`, `render`, `dry-run`, `publish`, `status`, and `resume`; separate pure planning/rendering/validation from credentialed mutation; keep each command deterministic and non-interactive; define a versioned release-manifest and release-state schema; make workflow YAML call these commands instead of reimplementing logic in shell fragments.
- **Acceptance:** local and CI runs produce byte-equivalent metadata from the same inputs; every command supports check-only behavior and structured output; generated files cannot drift unnoticed; release scripts are explicitly included by `.gitignore` and package/repository checks.
- **Verification:** unit and golden-fixture tests plus a workflow test that compares local and CI-generated manifest output for the same commit.

### GS-DIST-501 — Replace the linear tag workflow with staged promotion

- **Depends on:** GS-DIST-103, GS-DIST-204, GS-DIST-500.
- **Files:** split CI/release workflows, GitHub environments, release scripts.
- **Scope:** compose small reusable workflows for validation, target builds, artifact tests, signing/attestation, draft release, registry publication, adapter updates, and canaries. Use protected-tag and environment gates, a single-release concurrency lock, matrix builds for independent targets, and immutable artifact handoffs so stable promotion never rebuilds release inputs.
- **Acceptance:** version/tag mismatch, duplicate version, missing artifact,
  failed signature, failed smoke, denied machine promotion policy, or changed
  artifact identity blocks promotion; reruns never overwrite a released version;
  channel status and artifact lineage are visible in a concise job summary.
- **Verification:** full prerelease dry run with an intentionally failed channel, concurrent release attempt, cancellation, and safe retry/resume using the original tested artifacts.

### GS-DIST-502 — Harden the release supply chain

- **Depends on:** GS-DIST-501.
- **Files/systems:** Actions workflows, npm/PyPI publisher configuration, repository settings.
- **Scope:** pin third-party actions to reviewed commit SHAs; minimize workflow permissions; use GitHub environments and OIDC; remove long-lived npm-token fallback after trusted publishing is proven; enable tag protection and immutable releases; retain provenance and SBOMs; configure grouped, reviewed updates for Actions, builders, signing tools, release dependencies, schemas, and package-manager test versions.
- **Acceptance:** release jobs have least privilege; no reusable long-lived publish secret exists where OIDC is available; workflow provenance links to the protected source commit; automated dependency updates cannot merge without the complete release-contract dry run and named-owner review.
- **Verification:** permissions review, secret inventory, provenance verification, and a release from an authorized environment only.

### GS-DIST-503 — Document channel-specific rollback and incident response

- **Depends on:** first implementation of each channel.
- **Files:** release runbook, security docs, maintainer checklist, CODEOWNERS.
- **Scope:** define npm dist-tag/deprecation response, GitHub release revocation guidance, Homebrew tap revert, Scoop manifest rollback, WinGet replacement/removal, Chocolatey unlisting/superseding, and PyPI yanking; retain historical artifacts according to policy; assign primary and backup release owners plus credential-recovery responsibility.
- **Acceptance:** each channel has primary/backup owners, rollback command/process, communication template, and maximum expected response; release automation has CODEOWNERS coverage; no plan relies on overwriting an existing version.
- **Verification:** tabletop exercise using a fake compromised/broken version and a non-production channel.

### GS-DIST-504 — Publish truthful installation and support documentation

- **Depends on:** the relevant channel acceptance gate.
- **Files:** root/CLI README, quick start, website/docs, support matrix, security verification guide, changelog.
- **Scope:** provide stable/preview labels, prerequisites, exact install/update/uninstall commands, Node requirement for JS-client installs, no-Node promise for native artifacts, checksum/attestation verification, privacy/offline expectations, and known limitations; generate the channel/support/version table and command snippets from canonical metadata where practical.
- **Acceptance:** no command is documented before its public artifact exists and passes canaries; all docs identify canonical source, version policy, and support route.
- **Verification:** automated documentation command checks plus manual copy/paste tests on clean systems.

### GS-DIST-505 — Add distribution health without product telemetry

- **Depends on:** GS-DIST-103 and native channel launch.
- **Files/systems:** scheduled CI, issue automation/status documentation.
- **Scope:** query public registry/release metadata and perform clean installs on a schedule; compare every public channel with the canonical manifest; detect version drift, broken URLs, checksum mismatches, expired signing credentials, and install failures; encode expected moderation lag, maximum version skew, severity, and reconciliation action for each channel.
- **Acceptance:** stale or broken channels create one idempotent actionable issue or update pull request at the correct severity; expected moderation lag does not create alert noise; no user machine, repository, or usage data is collected.
- **Verification:** inject fixture mismatches inside and outside each channel's allowed lag and prove detection, deduplication, escalation, and reconciliation behavior.

### GS-DIST-506 — Automate downstream channel update pull requests

- **Depends on:** GS-DIST-206, first implementation of each adapter.
- **Files/systems:** release renderers/templates, renderer fixtures, shared
  `ntanwir10/homebrew-tap` catalog, moderated-registry packaging sources,
  documentation snippets.
- **Scope:** use GS-DIST-206 output to open one reviewable shared-catalog PR
  containing the Homebrew formula, Scoop manifest, and
  `guardscan.channel-catalog.v1` lock. Catalog CI refetches the immutable
  release manifest and rerenders from the exact GuardScan source commit.
  Catalog merge sends a `catalog_updated` dispatch as a hint; GuardScan
  independently validates the merged commit and reconciles every 30 minutes.
- **Acceptance:** no adapter contains a hand-copied version, URL, or checksum;
  `render --check` fails on drift; unchanged output creates no commit or pull
  request; same-release digest conflicts open an integrity incident; remote
  identities bind the catalog commit and channel path. The catalog never
  independently updates GuardScan.
- **Verification:** golden tests for every renderer, lock schema/digest tests,
  native manifest validation, missed-dispatch recovery, catalog
  older/exact/conflicting/unexpected-newer fixtures, and a dry-run against the
  shared catalog fixture.

### GS-DIST-507 — Make releases dry-runnable, observable, and safely resumable

- **Depends on:** GS-DIST-500, GS-DIST-501.
- **Files/systems:** release-state schema, orchestration scripts, workflow summaries/artifacts, runbook.
- **Scope:** persist a release ledger containing commit, version, artifact
  digests, signatures, attestations, per-channel publication identity, machine
  policy decisions, and errors; add `dry-run`, `status`, and `resume` paths;
  query remote state before every mutation; never infer completion only from a
  previous job's exit code.
- **Acceptance:** maintainers can determine exactly what published and what remains from one status command; retrying a completed matching step is harmless; conflicting remote state stops with an actionable error; dry-run performs every validation without publishing.
- **Verification:** deterministic scenarios for no-op rerun, failure before publication, failure after one channel, lost CI job state, remote match, remote conflict, and successful resume.

### GS-DIST-508 — Automate release-system upkeep

- **Depends on:** GS-DIST-500, GS-DIST-502.
- **Files/systems:** dependency-update configuration, scheduled workflows, CODEOWNERS, signing/publisher inventory.
- **Scope:** automatically propose reviewed updates for Actions, release tools, package managers, schemas, and packaging templates; alert before certificate, token, or publisher-configuration expiry; assign release-code ownership; run a scheduled non-publishing rehearsal and stale-channel audit.
- **Acceptance:** automation dependencies have named owners and update cadence; release-critical updates must pass the dry-run/artifact matrix; expiring credentials or signing identities alert with enough lead time; two maintainers can execute recovery.
- **Verification:** dependency-update fixture, simulated expiry alert, CODEOWNERS review routing, and scheduled rehearsal on a synthetic version.

### GS-DIST-509 — Enforce a maintainable release-automation contract

- **Depends on:** GS-DIST-500 through GS-DIST-508.
- **Files:** release developer guide, test fixtures, contribution checklist, CI policy checks.
- **Scope:** document module boundaries and the procedure for adding a target or channel; cap shell/YAML duplication; require schema migration notes for release-manifest changes; keep platform-specific behavior inside adapters; define retention and deprecation rules for obsolete automation.
- **Acceptance:** adding a channel requires only a renderer/template, native validator, smoke test, rollback entry, and ownership metadata; core orchestration does not need channel-specific branching; all release-state/schema changes are backward-compatible or explicitly migrated.
- **Verification:** implement a no-publish fixture adapter and demonstrate that it participates in render, validate, dry-run, status, and drift checks without modifying orchestration.

## Optional follow-on channels

- **GHCR image:** valuable for CI and hermetic use. Run as a non-root user, support read-only repository mounts plus an explicit output mount, publish multi-architecture images by digest, and attest them.
- **Shell/PowerShell installer:** only after signed standalone assets exist. Default to a user-local directory, accept an explicit version, verify checksum/signature, and avoid `curl | sh` as the only documented path.
- **APT/RPM:** add only after usage justifies repository signing, mirror operations, distro compatibility, and long-term update maintenance.
- **Homebrew Core:** submit only after a stable first-party release. Build from
  the tested npm source tarball with Homebrew `node` and `std_npm_args`; keep
  Core acceptance non-blocking and switch the primary install command to
  `brew install guardscan` only after public-Core verification. The tap remains
  the fallback.

## Release checkpoints

### Checkpoint A — Node ecosystem ready

- GS-DIST-001 through GS-DIST-103 plus GS-DIST-500 complete.
- Release `1.1.0` or its successor to npm only after clean exact-artifact tests.
- Document npm, pnpm, Yarn, and Bun commands with accurate Node prerequisites.
- A routine Node-only release can be prepared through one release PR, exercised
  in dry-run mode, machine-gated, and resumed without manually editing version
  or registry metadata.

### Checkpoint B — Binary foundation ready

- GS-DIST-201 through GS-DIST-206 complete.
- GitHub Release has tested, signed/attested artifacts, checksums, SBOMs, and manifest.
- No native package-manager publication before this checkpoint.

### Checkpoint C — Native channels ready

- The first-party Homebrew formula and Scoop manifest pass together from the
  shared, cryptographically locked catalog.
- WinGet and Chocolatey submissions follow after Windows signing and stable binary canaries.
- Channel rollback runbooks are exercised.

### Checkpoint D — Optional ecosystem expansion

- PyPI proceeds only on an approved ADR and platform-wheel prototype.
- GHCR is favored before PyPI when CI/container users have clearer demand.

## Principal risks and controls

| Risk | Control |
| --- | --- |
| Divergent behavior across wrappers | One implementation; exact-version binary digest checks |
| EOL runtime exposure | Raise Node floor and test only supported release lines |
| Native module/bundler failure | Builder spike; isolate optional charts; exact native smoke |
| Registry partial release | Draft/staged promotion; idempotent channel jobs; visible status |
| Release logic duplicated in YAML/shell | Thin reusable workflows backed by unit-tested release modules |
| Release cannot resume after CI loss | Persisted release ledger plus remote identity checks and idempotent steps |
| Supply-chain compromise | OIDC, least privilege, pinned actions, signatures, attestations, immutable assets |
| Package-name collision | Reserve names and document canonical publisher IDs before launch |
| Channel drift | Generated manifests from one release manifest plus scheduled canaries |
| Misleading Bun/PyPI claims | Explicit runtime labels and go/no-go decision gates |
| Unsustainable maintenance | Launch checkpoints, named owners, and rollback/upgrade tests per channel |
| Automation dependency or certificate decay | Reviewed automated updates, rehearsals, ownership, and expiry alerts |

## Definition of multi-channel launch complete

- A clean protected commit produced all artifacts for one version.
- Every advertised installation command has passed install, version/help, offline smoke, upgrade, and uninstall on its supported platforms.
- npm and standalone artifacts have verifiable provenance; native artifacts have checksums and platform signatures where applicable.
- All channels resolve to the same product version and artifact identity.
- Routine releases require one reviewed release PR and a machine-approved
  24-hour RC soak, not manual edits across package-manager files.
- The release can be dry-run, inspected, retried, and resumed from persisted machine-readable state without rebuilding or overwriting artifacts.
- Channel manifests and install documentation are generated and drift-checked
  from the canonical release manifest; shared-catalog state is bound by its lock
  and exact merged commit.
- Privacy, offline, safe-execution, SBOM, and exit-code contracts remain unchanged across channels.
- Documentation, support ownership, monitoring, and rollback are live before stable channel labels are applied.
