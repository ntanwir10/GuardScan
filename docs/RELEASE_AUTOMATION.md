# GuardScan release automation

GuardScan uses one RC-first, append-only release train for npm, standalone GitHub assets, Homebrew, Scoop, WinGet, Chocolatey, and PyPI. pnpm, both Yarn generations, and Bun consume the npm package and are verified as separate install channels.

The automation is fail-closed. A tag is an identity created by the release train, never publication authority. General CI has no tag trigger, publication permission, registry command, or GitHub release job.

## Release invariants

- `cli/package.json`, `cli/package-lock.json`, `cli/CHANGELOG.md`, the tag, and the exact commit agree.
- The stable Release Please PR remains at `1.1.0`. A bot-owned candidate commit derives `1.1.0-rc.1` from that exact PR head.
- Release builds use Node `22.23.1`, esbuild `0.28.1`, and postject `1.0.0-alpha.6`.
- Every public artifact is immutable and digest-bound to its source commit.
- Missing remote versions are published. Identical remote digests are accepted as retries. Different remote digests open an integrity incident and stop the train.
- Stable promotion is a machine decision after a full 24-hour window. It requires an unchanged release-PR head, fresh green canaries for every RC channel, and no open release incident.
- WinGet and Chocolatey remain `submitted` until their public catalogs accept them and a clean public installation passes.
- Rollback never mutates history or overwrites a release. It appends recovery events and prepares a forward-fix patch.

## Workflow ownership

| Workflow | Authority |
| --- | --- |
| `.github/workflows/ci.yml` | Required source, test, coverage, package, package-manager, audit, and five-host SEA gates. It cannot publish. |
| `.github/workflows/release-please.yml` | Maintains the stable release PR only, using a short-lived GitHub App token. |
| `.github/workflows/release-train.yml` | Derives RC commits, creates protected tags, dispatches builds/publication, reconciles every 30 minutes, promotes, rolls back, and persists release events. |
| `.github/workflows/release-build.yml` | Builds the exact npm tarball and five SEA targets, signs, notarizes, generates SPDX/CycloneDX, creates wheels, attests, archives deterministically, and aggregates the manifest/checksums. |
| `.github/workflows/release-publish.yml` | Publishes the tested handoffs through OIDC or first-party bot repositories. |
| `.github/workflows/release-canary.yml` | Runs hourly public install/invoke/uninstall canaries and polls moderated registries. |

Release workflows deliberately do not use dependency caches. Release-critical actions are pinned to immutable commits.

## Maintainer interface

Run from `cli/`, or use `npm run release -- <command>`:

```bash
npm run release -- build
npm run release -- manifest
npm run release -- publish --channel npm
npm run release -- verify --channel npm
npm run release -- reconcile
npm run release -- promote
npm run release -- rollback
npm run release -- status
```

The low-level commands require explicit source, manifest, ledger, timestamp, artifact, and remote-identity arguments. `npm run release -- --help` is the canonical option reference.

Important supporting commands:

```bash
npm run release:validate
npm run release:plan -- --profile full
npm run release:prepare -- \
  --profile full \
  --output-dir ../release-evidence/v1.1.0-rc.1 \
  --ledger ../release-evidence/v1.1.0-rc.1/events.jsonl \
  --timestamp 2026-07-25T18:00:00.000Z \
  --idempotency-key train:v1.1.0-rc.1
npm run release:render -- \
  --manifest ../release-evidence/v1.1.0-rc.1/release-manifest.json \
  --output-dir ../release-evidence/v1.1.0-rc.1/adapters
```

`advance` and the v1 mutable state schema remain temporarily available for compatibility with earlier local evidence. New automation uses only the hash-chained event ledger and materialized v2 state.

## Artifact contracts

Five host-native artifacts are required:

- `linux-x64-glibc`
- `linux-arm64-glibc`
- `darwin-x64`
- `darwin-arm64`
- `windows-x64`

The builder bundles one CommonJS program, allows only `tiktoken` and `chartjs-node-canvas` as optional externals, injects a Node SEA blob, and runs with Node and package managers absent from `PATH`. Required smoke covers:

- exact version and help;
- offline static scanning;
- SPDX 2.3 and CycloneDX 1.7;
- telemetry-disabled status;
- safe reduced capability behavior.

The standalone profile reports:

```json
{
  "coreScan": true,
  "sbom": true,
  "chartRendering": false,
  "accurateTokenCounting": false
}
```

Archives have normalized entry names, ordering, modes, timestamps, ownership, and compression. Inspection rejects traversal, absolute paths, links, duplicate/case-colliding entries, unexpected files, truncation, trailing data, invalid checksums, excessive entry counts, and excessive expanded size.

Each PyPI wheel contains the exact signed executable already represented by its standalone archive. Its standard-library-only launcher verifies the embedded executable digest, forwards arguments and exit status, and uses `exec` for POSIX signal behavior. Wheel tags are derived from the actual platform:

| Target | Wheel platform tag |
| --- | --- |
| Linux x64 glibc | `manylinux_2_28_x86_64` |
| Linux arm64 glibc | `manylinux_2_28_aarch64` |
| macOS x64 | `macosx_11_0_x86_64` |
| macOS arm64 | `macosx_11_0_arm64` |
| Windows x64 | `win_amd64` |

## Append-only state

Events live on the protected `release-ledger` branch under `events/vVERSION.jsonl`. Each event contains a sequence, previous-event hash, idempotency key, source identity, timestamp, payload, and its own digest.

Materialized channel states include:

```text
planned -> published
planned -> submitted -> accepted -> verified
any active state -> failed
published/verified -> withdrawn or superseded
```

Rollback is represented by `rollback_started`, `withdrawn`, and `superseded` events; no backward state mutation is needed. Integrity, security, and availability incidents use `incident_opened` and `incident_resolved`.

The repository also contains:

- `guardscan.release-event.v1`
- `guardscan.release-state.v2`
- `guardscan.promotion-decision.v1`
- strengthened `guardscan.release-manifest.v1`

## RC and promotion

Start the first candidate after provider onboarding:

```bash
gh workflow run release-train.yml \
  -f action=candidate \
  -f version=1.1.0-rc.1 \
  -f release_pr=RELEASE_PR_NUMBER
```

The train:

1. resolves the exact stable PR head;
2. creates a candidate commit containing only RC identity changes;
3. creates `v1.1.0-rc.1` with the release GitHub App;
4. builds, signs, attests, and verifies every artifact;
5. publishes npm under `next`, GitHub as a prerelease, TestPyPI then PyPI, and preview tap/bucket branches;
6. renders and validates WinGet/Chocolatey without publishing an RC;
7. records `publishedAt` and hourly canary evidence;
8. reconciles every 30 minutes.

Promotion produces `promotion-decision.json`. A permitted decision requires at least 24 green samples per required channel, a complete 24-hour wall-clock window, a fresh last sample, the same source PR head, and no open incident. The release App then auto-merges that unchanged PR, tags its exact merge commit, rebuilds stable artifacts, and publishes `latest`.

## Public installation contracts

These commands become user-facing only when the ledger shows `verified` from the public production source:

```bash
npm install -g guardscan
pnpm add -g guardscan
pnpm dlx guardscan
yarn global add guardscan
yarn dlx guardscan
bun add -g guardscan
bunx guardscan
brew install ntanwir10/tap/guardscan
scoop bucket add guardscan https://github.com/ntanwir10/scoop-bucket
scoop install guardscan
winget install --exact --id NaumanTanwir.GuardScan
choco install guardscan
pip install guardscan-cli
pipx install guardscan-cli
```

The npm package requires Node 22 or newer even when invoked by Bun. The standalone and wheel channels include the runtime.

## Recovery

Before stable promotion, any failed build, signature, digest, canary, vulnerability, or source-head check stops the train. The correction is a new `rc.N`.

After stable publication:

- immutable GitHub assets are retained and marked superseded;
- Homebrew/Scoop redirect to a known-good native release or remove the new listing;
- PyPI is yanked where authorized;
- npm is deprecated and moved forward through a patch;
- Chocolatey is unlisted/superseded;
- WinGet receives a corrective manifest;
- a higher patch version is prepared from selected known-good source.

A release is complete only when every selected channel materializes as `verified`.
