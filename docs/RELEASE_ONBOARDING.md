# One-time release provider onboarding

The repository contains the zero-touch release implementation. The following provider-owned identity and account steps must be completed once before `1.1.0-rc.1`. Automation must not fabricate or bypass them.

## GitHub

- Reauthenticate `gh` as `ntanwir10`.
- Create `ntanwir10/homebrew-tap` as the public shared Homebrew/Scoop catalog.
- Create `guardscan-release-bot` as a GitHub App.
- Grant the App Actions, Contents, Pull requests, Issues, and Workflows
  **write** permission plus Metadata **read** permission.
- Install the App only on GuardScan and `ntanwir10/homebrew-tap`.
- Store `RELEASE_APP_ID` as a repository variable and `RELEASE_APP_PRIVATE_KEY` as a secret.
- Seed the orphan `release-ledger` branch from
  `.github/release-ledger/active-versions.json`, then protect the branch and
  require the App identity for writes. Do not copy application source onto the
  ledger branch.
- Protect `v*` tags so only the release App can create them.
- Enable immutable releases for GuardScan.
- Enable squash merge and auto-merge, and require the full `Release gate`
  status on the stable release PR.
- Set repository variable `RELEASE_AUTOMATION_ENABLED=false` until every
  onboarding rehearsal below passes. Scheduled reconciliation and canaries
  must remain dormant while it is false.

Create environments without manual reviewers:

- `release-rc`
- `release-stable`
- `npm-publish`
- `pypi`
- `apple-notarization`
- `windows-signing`
- `winget`
- `chocolatey`

Allow protected branch `main` in these environments because the authorized
`workflow_dispatch` caller runs from `main`; add protected candidate/stable tags
where an environment needs them. Fork pull requests must not receive
environment secrets or OIDC tokens.

The reusable build and publish workflows run in the security context of their
caller. Environment and OIDC policies therefore identify
`.github/workflows/release-train.yml`, not the called reusable workflow.

## Shared Homebrew and Scoop catalog

Initialize `ntanwir10/homebrew-tap` with:

```text
README.md
.github/workflows/verify.yml
```

Before the first verified stable native release, all of
`Formula/guardscan.rb`, `bucket/guardscan.json`, and `channel-lock.json` must
remain absent. The verification workflow accepts only that exact unpublished
state; it rejects partial catalog metadata. The first stable catalog PR creates
all three generated files atomically. After publication, the repository layout
contains all five files.

Protect catalog `main`; require pull requests and the catalog verification
check. Stable metadata is merged only to `main`. RC metadata lives on temporary
`channel-preview/vVERSION` branches. Install the release App on this repository
so it can open and update one generated PR containing both package-manager
files and their cryptographic lock. Add the same `RELEASE_APP_ID` variable and
`RELEASE_APP_PRIVATE_KEY` secret to the catalog so its post-merge workflow can
mint a short-lived cross-repository dispatch token; do not store a personal
access token for this notification.

Configure the catalog's post-merge workflow to send `catalog_updated` to
GuardScan with the merged commit and lock digest. This notification does not
authorize a ledger transition: GuardScan must refetch that exact commit and
validate `channel-lock.json`, the release-manifest digest, and both generated
file digests. The 30-minute GuardScan reconciliation schedule is the recovery
path for missed dispatches and drift.

Do not add a Git submodule, subtree, repository mirror, or reverse update from
the catalog into GuardScan. GuardScan is authoritative; the catalog is a
generated projection.

## npm

- Configure trusted publishing for package `guardscan`.
- Bind it exactly to `ntanwir10/GuardScan`,
  `.github/workflows/release-train.yml`, and environment `npm-publish`.
- Confirm the release job installs its pinned npm version at `11.5.1` or newer
  before the trusted-publishing rehearsal; the npm bundled with Node 22 is not
  sufficient for this contract.
- Do not retain an npm token fallback after OIDC succeeds.

## TestPyPI and PyPI

- Reserve `guardscan-cli`.
- Configure pending trusted publishers for both TestPyPI and PyPI.
- Bind them exactly to `ntanwir10/GuardScan`,
  `.github/workflows/release-train.yml`, and environment `pypi`.

## Apple

Enroll the publisher and provision:

- `APPLE_CERTIFICATE_P12`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_TEAM_ID`
- `APPLE_NOTARY_KEY_ID`
- `APPLE_NOTARY_ISSUER_ID`
- `APPLE_NOTARY_PRIVATE_KEY`

Store them only in `apple-notarization`. Renewals and Apple identity revalidation remain external authority boundaries.

## Azure Artifact Signing

Create a Public Trust signing account/profile and GitHub OIDC federation. Configure these environment variables in `windows-signing`:

- `AZURE_TENANT_ID`
- `AZURE_SUBSCRIPTION_ID`
- `AZURE_CLIENT_ID`
- `AZURE_SIGNING_ACCOUNT`
- `AZURE_SIGNING_PROFILE`
- `AZURE_SIGNING_ENDPOINT`

Grant only the Artifact Signing Certificate Profile Signer role needed by the federated identity.

## WinGet and Chocolatey

- Accept the Microsoft CLA for the submitting identity.
- Store a narrowly scoped `WINGET_GITHUB_TOKEN` in `winget`.
- Create/validate the Chocolatey publisher account.
- Store `CHOCO_API_KEY` in `chocolatey`.

WinGet review and Chocolatey validation, verification, VirusTotal, and moderation are external states. The ledger keeps them `submitted` until public installation passes.

## First `1.1.0` bootstrap exception

The first stable train does not ask Release Please to regenerate `1.1.0`.
The protected `release/1.1.0` pull request is the bootstrap release source
because the previous `main` baseline and the new Release Please seed disagree
about whether `1.1.0` is already prepared. Derive `1.1.0-rc.1` from that exact
PR head, require the normal release gates, and merge/tag it through the release
train. After `v1.1.0` is verified, align the Release Please manifest to `1.1.0`
so subsequent stable release PRs follow the normal automated path.

## Expiry monitoring

Configure provider notifications for:

- GitHub App key age and installation loss;
- Apple certificate/notary key expiry;
- Azure federation/profile health;
- Chocolatey API key validity;
- WinGet token expiry or revoked CLA status.

After all rehearsals pass, set `RELEASE_AUTOMATION_ENABLED=true`. No later
release requires a human promotion click. Only provider-mandated identity, MFA,
legal, certificate-renewal, account verification, or moderator requests remain
human boundaries; automation must report those states rather than claiming
completion.
