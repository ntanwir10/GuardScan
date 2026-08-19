# GuardScan release automation

GuardScan uses one RC-first, append-only release train for npm, standalone GitHub assets, Homebrew, Scoop, WinGet, Chocolatey, and PyPI. pnpm, both Yarn generations, and Bun consume the npm package and are verified as separate install channels.

The automation is fail-closed. A tag is an identity created by the release train, never publication authority. General CI has no tag trigger, publication permission, registry command, or GitHub release job.

[`FUNCTIONAL_ACCEPTANCE.md`](./FUNCTIONAL_ACCEPTANCE.md) maps every public
command and major workflow to its strongest evidence class, install/runtime
variants, and remaining launch gate. [`RELEASE_ONBOARDING.md`](./RELEASE_ONBOARDING.md)
defines the one-time default-branch bootstrap and provider activation order.
Neither an implemented workflow nor a green component test is public-release
evidence until it is bound to the selected commit and exact artifact.

## Release invariants

- `cli/package.json`, `cli/package-lock.json`, `cli/CHANGELOG.md`, the tag, and the exact commit agree.
- The stable Release Please PR remains at `1.1.0`. A bot-owned candidate commit derives `1.1.0-rc.1` from that exact PR head.
- Release builds use Node `22.23.1`, esbuild `0.28.1`, and postject `1.0.0-alpha.6`.
- Every public artifact is immutable and digest-bound to its source commit.
- A signed build is persisted as a deterministic draft-release checkpoint
  before any provider publication. Retries rehydrate those exact bytes or a
  complete verified public release; they never rebuild an existing release
  identity.
- Missing remote versions are published. Identical remote digests are accepted as retries. Different remote digests open an integrity incident and stop the train.
- Stable promotion is a machine decision after a full 24-hour window. It requires an unchanged release-PR head, fresh green canaries for every RC channel, and no open release incident.
- WinGet and Chocolatey remain `submitted` until their public catalogs accept them and a clean public installation passes.
- Recovery never mutates history or overwrites a release. Normal rollback restores a verified known-good source through a forward-fix patch; the first stable train instead fails closed into withdrawal when no verified baseline exists.

## Selected channels

The current RC train selects npm, its pnpm/Yarn/Bun consumer canaries, GitHub
native assets, Homebrew tap preview, Scoop preview, and PyPI. The stable train
selects those channels plus WinGet and Chocolatey. Every selected channel must
reach `verified` before the stable release is complete.

Homebrew Core is not selected. The renderer and validator are dormant building
blocks only: the orchestrator calls `releaseTrainChannels` without the explicit
`homebrewCoreEnabled` option, so it cannot submit Core in the current train.
Core requires a separate reviewed enablement and remains nonblocking.

## Workflow ownership

| Workflow | Authority |
| --- | --- |
| `.github/workflows/ci.yml` | Required source, test, coverage, package, package-manager, audit, and five-host SEA gates. It cannot publish. |
| `.github/workflows/release-please.yml` | Maintains the stable release PR only, using a short-lived GitHub App token. |
| `.github/workflows/release-train.yml` | Derives RC commits, creates protected tags, dispatches builds/publication, reconciles every 30 minutes, promotes, rolls back, and persists release events. |
| `.github/workflows/release-first-withdrawal.yml` | Withdraws the first stable train only when the protected ledger proves no verified predecessor exists; it never invents forward-fix source. |
| `.github/workflows/release-build.yml` | Builds the exact npm tarball and five SEA targets, signs, notarizes, generates SPDX/CycloneDX, creates wheels, attests, archives deterministically, and aggregates the manifest/checksums. |
| `.github/workflows/release-provider-rehearsal.yml` | Runs exact-head Apple and Azure signing rehearsals while publication automation is disabled; it emits non-production evidence only. |
| `.github/workflows/release-publish.yml` | Expands a persisted checkpoint, publishes tested registry handoffs through OIDC, and opens the generated shared-catalog update PR. |
| `.github/workflows/release-canary.yml` | Runs hourly public install/invoke/uninstall canaries and polls moderated registries. |

Release workflows deliberately do not use dependency caches. Release-critical actions are pinned to immutable commits.

## Shared package-manager catalog

GuardScan is the sole release authority. The public
`ntanwir10/homebrew-tap` repository is a generated, cryptographically bound
projection of one GuardScan release manifest; it is not a second source of
product or release state. The shared catalog contains both first-party
package-manager adapters:

```text
Formula/guardscan.rb
bucket/guardscan.json
channel-lock.json
.github/workflows/verify.yml
```

A stable release renders the formula, Scoop manifest, and lock together and
opens one catalog pull request. RCs use the temporary branch
`channel-preview/vVERSION`; stable users read catalog `main`. Catalog CI
fetches the immutable GuardScan manifest, verifies its SHA-256 and tagged
source commit, reruns the renderer from that exact source commit, checks every
asset URL and digest, and runs the native lifecycle tests before merge.
Hand-written catalog changes fail unless they are byte-identical to renderer
output.

`channel-lock.json` uses schema `guardscan.channel-catalog.v1` and binds the
projection without trying to include the catalog commit in its own contents:

```json
{
  "schemaVersion": "guardscan.channel-catalog.v1",
  "source": {
    "repository": "ntanwir10/GuardScan",
    "version": "1.1.0",
    "tag": "v1.1.0",
    "commit": "GUARDSCAN_SOURCE_COMMIT",
    "manifestUrl": "IMMUTABLE_RELEASE_MANIFEST_URL",
    "manifestSha256": "RELEASE_MANIFEST_SHA256"
  },
  "generator": {
    "repository": "ntanwir10/GuardScan",
    "commit": "GENERATOR_COMMIT"
  },
  "files": {
    "Formula/guardscan.rb": {
      "sha256": "FORMULA_SHA256"
    },
    "bucket/guardscan.json": {
      "sha256": "SCOOP_MANIFEST_SHA256"
    }
  }
}
```

After merge, the catalog sends a `catalog_updated` repository dispatch
containing the merged commit and lock digest. The dispatch is only a latency
hint: GuardScan refetches the catalog at that commit and validates the lock,
manifest, and generated file digests before appending evidence to the release
ledger. Scheduled reconciliation repeats this check every 30 minutes, so a
missed dispatch cannot create permanent drift.

Reconciliation is idempotent and fail-closed:

- missing or older catalog state opens or reuses the deterministic update PR;
- the exact expected lock and file digests materialize as `verified`;
- different digests for the same release open a release-integrity incident;
- an unexpected newer catalog version stops automated mutation for review.

The ledger records the catalog repository, merged commit, pull-request number,
lock digest, manifest digest, and channel-specific path/digest. Channel remote
identities are:

```text
github:ntanwir10/homebrew-tap@COMMIT#Formula/guardscan.rb
github:ntanwir10/homebrew-tap@COMMIT#bucket/guardscan.json
```

This is strong convergence, not a cross-repository atomic transaction: the
release remains incomplete while the catalog is behind. A rollback is another
generated catalog PR pointing to a verified known-good release plus append-only
ledger events. The repositories are intentionally not connected with
submodules, subtrees, mirroring, or bidirectional synchronization.

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

## Retry-safe release checkpoints

The train resolves remote state before starting a signed build. A new release
identity may build only when no matching GitHub release exists. Before
publication, the train creates a draft release and uploads a deterministic
`guardscan-release-checkpoint-VERSION.tar.gz` plus its
`guardscan.release-checkpoint.v1` sidecar. The checkpoint contains the complete
public payload and the npm handoff metadata; the duplicate npm tarball is
restored from the payload during rehydration.

A retry accepts only one of these states:

- no remote release or an existing empty draft, which authorizes a fresh build;
- a draft with both valid checkpoint assets, which skips the build and
  rehydrates the exact bytes;
- an expanded draft whose complete individual asset set, checksums, signature,
  manifest, tag, and source commit all verify, which resumes publication after
  checkpoint removal; or
- a published release whose complete asset set, checksums, signature, manifest,
  tag, and source commit all verify, which also skips the build.

A partial checkpoint without a complete expanded asset inventory, an
incomplete or unexpected expanded/public inventory, a digest mismatch, or a
published release missing an asset is a release integrity incident. Publication
expands and
redownloads every individual asset, then removes the private checkpoint
immediately before making the verified draft public. If that final transition
is interrupted, the complete individual draft asset set remains recoverable
without rebuilding signed bytes.

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
- safe reduced capability behavior, proven by invoking
  `guardscan capabilities --json` from the exact standalone executable.

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

Rollback is represented by `rollback_started`, `withdrawn`, and `superseded`
events; no backward state mutation is needed. Integrity, security,
availability, and recovery incidents use `incident_opened` and
`incident_resolved`. An `action_required` event records a provider-owned task;
it does not claim that a package has been withdrawn.

The repository also contains:

- `guardscan.release-event.v1`
- `guardscan.release-state.v2`
- `guardscan.promotion-decision.v1`
- strengthened `guardscan.release-manifest.v1`

## RC and promotion

Before the first candidate, merge the inert automation bootstrap to `main`
while `RELEASE_AUTOMATION_ENABLED=false` and `RELEASE_PLEASE_ENABLED=false`,
complete every onboarding check, and
verify that the release PR head and full gate are unchanged. Refetch the
protected `release-ledger` branch and fail if its tree contains anything other
than the empty `active-versions.json` seed; this is the explicit no-migration
boundary for the first source-bound event schema. Then set the variable to
`true` and start the candidate from the default-branch workflow:

```bash
EXPECTED_HEAD="$(gh pr view RELEASE_PR_NUMBER --json headRefOid --jq .headRefOid)"
gh workflow run release-train.yml \
  -f action=candidate \
  -f version=1.1.0-rc.1 \
  -f release_pr=RELEASE_PR_NUMBER \
  -f expected_head="$EXPECTED_HEAD"
```

The train:

1. resolves the exact stable PR head;
2. creates a candidate commit containing only RC identity changes;
3. creates `v1.1.0-rc.1` with the release GitHub App;
4. builds, signs, attests, and verifies every artifact;
5. publishes npm under `next`, GitHub as a prerelease, TestPyPI then PyPI, and the shared catalog preview branch `channel-preview/v1.1.0-rc.1`;
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
scoop bucket add guardscan https://github.com/ntanwir10/homebrew-tap
scoop install guardscan
winget install --exact --id NaumanTanwir.GuardScan
choco install guardscan
pip install guardscan-cli
pipx install guardscan-cli
```

The npm package requires Node 22 or newer even when invoked by Bun. The standalone and wheel channels include the runtime.

The one-part command `brew install guardscan` is **not selected or advertised by
the current train**. It becomes available only after a separately reviewed
change enables the optional `homebrew-core` channel, a source-building formula
is submitted and accepted, and a clean public-Core canary reaches `verified`.
Until then, `brew install ntanwir10/tap/guardscan` is the only supported Homebrew
contract.

If enabled later, `homebrew-core` uses the normal append-only
`submitted -> accepted -> verified` states. Submission is not acceptance,
acceptance is not public verification, and Core never blocks first-party release
completion.

## Recovery

Before stable promotion, any failed build, signature, digest, canary, vulnerability, or source-head check stops the train. The correction is a new `rc.N`.

After stable publication:

- immutable GitHub assets are retained and marked superseded;
- Homebrew/Scoop move together through a generated shared-catalog PR to a known-good native release, or remove the new listing;
- PyPI is yanked where authorized;
- npm is deprecated and moved forward through a patch;
- Chocolatey is unlisted/superseded;
- WinGet receives a corrective manifest;
- a higher patch version is prepared from selected known-good source.

The first ledger-backed stable release is the only exception to the
known-good requirement. Dispatching rollback without `known_good` invokes the
separate first-release withdrawal workflow. It is authorized only when the
protected ledger proves that the defective version is the active first stable
train and that no earlier stable ledger ever reached completion. The workflow:

- retains immutable GitHub assets and marks them superseded;
- removes only an exact matching `Formula/guardscan.rb`,
  `bucket/guardscan.json`, and `channel-lock.json`, or records that the catalog
  was already in the valid empty bootstrap state; it also closes the exact
  still-open publication PR so that a delayed merge cannot restore the listing;
- appends provider-owned npm, PyPI, WinGet, Chocolatey, and optional Core
  actions without claiming they have completed;
- records `provider-actions-pending` while any of those external actions remain,
  keeps a recovery incident open, deactivates the train only after repository
  evidence is persisted, and requires a separately reviewed next patch;
- makes retries prove the active train is absent, repository-owned channels are
  terminal, the catalog is still empty, and no publication PR remains open;
- never creates a forward-fix branch from the defective source.

Once any earlier stable release has reached completion, omitting `known_good`
fails closed and the normal verified-baseline rollback is mandatory.

```bash
# First ledger-backed stable release only; protected-ledger proof is mandatory.
gh workflow run release-train.yml \
  -f action=rollback \
  -f version=1.1.0

# Every later stable release requires an exact verified predecessor.
gh workflow run release-train.yml \
  -f action=rollback \
  -f version=DEFECTIVE_VERSION \
  -f known_good=VERIFIED_PREDECESSOR
```

A release is complete only when every selected blocking channel materializes
as `verified`. Optional Homebrew Core submission/acceptance is tracked
separately and never blocks the release train.
