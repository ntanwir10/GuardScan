# One-time release provider onboarding

The repository contains the zero-touch release implementation. The following provider-owned identity and account steps must be completed once before `1.1.0-rc.1`. Automation must not fabricate or bypass them.

The release remains closed until the evidence in
[`FUNCTIONAL_ACCEPTANCE.md`](./FUNCTIONAL_ACCEPTANCE.md) is satisfied for the
candidate commit and artifacts.

## Activation order while automation is off

Use this order for the first train:

1. Reauthenticate the maintainer and set the GuardScan repository variable
   `RELEASE_AUTOMATION_ENABLED=false` and the independent variable
   `RELEASE_PLEASE_ENABLED=false`, plus
   `RELEASE_PROVIDER_REHEARSAL_ENABLED=false` and
   `RELEASE_PROVIDER_ONBOARDING_ATTESTATION=false`, **before** merging release
   automation to the default branch.
2. Land a reviewed bootstrap PR on `main` containing the inert release
   workflows, schemas, renderer, and ledger seed. It must not change a public
   version, create a tag, or publish an artifact.
3. Confirm GitHub lists the workflows from `main`, CI passes, Release Please is
   skipped, scheduled train jobs are skipped, and publication jobs reject the
   disabled state. A manual canary validation may run read-only checks, but it
   cannot authorize publication or a ledger transition.
4. Complete the GitHub App, branch/tag protections, environments, catalog, OIDC
   publishers, signing identities, moderated-registry accounts, and monitoring
   below. Keep the automation variable false throughout.
5. Temporarily enable `RELEASE_PROVIDER_REHEARSAL_ENABLED`, dispatch
   `release-provider-rehearsal.yml` with the exact reviewed PR head, require
   Apple and Azure evidence with `productionReady=false`, and turn the rehearsal
   flag off again. This operation signs and notarizes transient bytes but cannot
   create a tag, release, package publication, catalog update, or ledger event.
6. Recheck that the protected `release/1.1.0` PR head is unchanged and that its
   complete release gate passes. The bootstrap merge to `main` is not release
   approval.
7. After every provider-owned binding and account check below is complete, run
   `node .github/scripts/provider-onboarding-attestation.js --attestation` from the reviewed
   bootstrap on `main` and set `RELEASE_PROVIDER_ONBOARDING_ATTESTATION` to the
   exact printed value. This authority is bound to the reviewed provider
   control-plane bytes and expires after 30 days; it never changes monitoring
   evidence from `unknown`. Then set
   `RELEASE_AUTOMATION_ENABLED=true` and dispatch exactly the candidate command
   in `RELEASE_AUTOMATION.md`.

GitHub only accepts manual and scheduled workflow execution from workflow files
present on the default branch. Keeping the implementation solely on the release
PR would therefore leave the orchestrator unavailable; the inert bootstrap is a
required first-release exception.

## GitHub

- Reauthenticate `gh` as `ntanwir10` and verify the active host/account before
  any repository mutation.
- Create or verify `ntanwir10/homebrew-tap` as the public shared Homebrew/Scoop
  catalog.
- Create `guardscan-release-bot` as a GitHub App owned by `ntanwir10`.
- Grant the App Actions, Contents, Pull requests, Issues, and Workflows
  **write** permission plus Metadata **read** permission.
- Install the App only on GuardScan and `ntanwir10/homebrew-tap`; do not grant
  organization-wide or all-repository access.
- Store `RELEASE_APP_ID` as a repository variable and
  `RELEASE_APP_PRIVATE_KEY` as a secret in each installed repository. The key is
  exchanged only for short-lived installation tokens; there is no PAT fallback.
- Seed the orphan `release-ledger` branch from
  `.github/release-ledger/active-versions.json`, then protect the branch and
  require the App identity for writes. Do not copy application source onto the
  ledger branch. Before merging the bootstrap, refetch this branch and require
  its complete tree to contain only `active-versions.json` with an empty
  `trains` array. The first source-bound and moderated event contracts have no
  migration path from experimental pre-release ledger records; any unexpected
  `events/` path is a launch blocker, not data to coerce.
- Protect `v*` tags so only the release App can create them.
- Enable immutable releases for GuardScan.
- Enable squash merge and auto-merge, and require the full `Release gate`
  status on the stable release PR.
- Require code-owner review for release control-plane changes, including
  workflows, release tooling, schemas, package-toolchain pins, catalog
  verification, and release governance documentation. Protect `CODEOWNERS`
  through the same branch rule, dismiss stale approvals, and require the latest
  push to be approved by someone other than its author. Before activation,
  `CODEOWNERS` must name an independent maintainer or team in addition to the
  change author; the bootstrap's single-owner seed is not sufficient when that
  owner authors the change. This approval guards changes to publication
  authority and is the immutable control used for production PyPI OIDC. It does
  not require a per-release promotion click after an exact reviewed workflow
  revision and candidate have passed every automated gate.
- Keep repository variables `RELEASE_AUTOMATION_ENABLED=false` and
  `RELEASE_PLEASE_ENABLED=false` until their separate activation gates pass.
  Keep `RELEASE_PROVIDER_REHEARSAL_ENABLED=false` except for an explicitly
  authorized non-publishing rehearsal window. Keep
  `RELEASE_PROVIDER_ONBOARDING_ATTESTATION=false` until the full provider
  checklist and rehearsal have passed.
  Scheduled reconciliation and automatic canaries remain dormant while release
  automation is false; Release Please remains dormant until its own flag is
  deliberately enabled after the first train is aligned.

Create environments without manual reviewers:

- `release-rc`
- `release-stable`
- `npm-publish`
- `testpypi`
- `pypi`
- `apple-notarization`
- `windows-signing`
- `winget`
- `chocolatey`

Allow protected branch `main` in these environments because the authorized
`workflow_dispatch` caller runs from `main`; add protected candidate/stable tags
where an environment needs them. Fork pull requests must not receive
environment secrets or OIDC tokens.

The reusable build and publication workflows run in the security context of
their caller. For npm, enter the workflow **filename** `release-train.yml` (not
a path), which identifies the caller; do not register the reusable
`release-publish.yml`. The TestPyPI and PyPI publishing jobs live directly in
`release-train.yml`, because PyPI does not accept a reusable workflow as the
trusted-publisher workflow. See the current
[npm trusted-publisher fields](https://docs.npmjs.com/trusted-publishers/) and
[PyPI reusable-workflow limitation](https://docs.pypi.org/trusted-publishers/troubleshooting/#reusable-workflows-on-github).

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
- Bind it exactly to GitHub user `ntanwir10`, repository `GuardScan`, workflow
  filename `release-train.yml`, environment `npm-publish`, and allowed action
  `npm publish`. Do not allow staged publication unless the release train is
  separately changed to use it.
- Confirm the release job installs and verifies exactly npm `11.5.2` before the
  trusted-publishing rehearsal; the npm bundled with Node 22 is not the release
  identity.
- Confirm the publisher receives an OIDC identity token only in the
  `npm-publish` job and publishes the previously tested tarball with
  `--provenance`. The job must redownload registry metadata and reject a digest
  conflict before recording success.
- Do not retain an npm token fallback after OIDC succeeds.

## TestPyPI and PyPI

- Reserve `guardscan-cli`.
- Configure pending trusted publishers for both TestPyPI and PyPI.
- Bind them exactly to GitHub owner `ntanwir10`, repository `GuardScan`, and
  workflow filename `release-train.yml`. Bind TestPyPI to environment
  `testpypi` and production PyPI to environment `pypi`; never share their OIDC
  subjects.
- Do not activate the production PyPI trusted publisher until the protected
  workflow paths have an independent code-owner approval and the branch rule
  requires approval of the latest push by someone other than its author. If an
  independent reviewer cannot be configured, add required reviewers to the
  `pypi` environment and accept the per-release approval instead; never remove
  both controls to preserve zero-touch behavior.
- Confirm both publishers accept the PEP 440 identity `1.1.0rc1` derived from
  tag `v1.1.0-rc.1`. TestPyPI must converge to all five tested wheels and pass
  pip/pipx native lifecycles before the production PyPI job can run.
- Do not configure passwords or API-token fallbacks in the `pypi` environment.

## Apple

Enroll the publisher and provision:

- `APPLE_CERTIFICATE_P12`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_TEAM_ID`
- `APPLE_NOTARY_KEY_ID`
- `APPLE_NOTARY_ISSUER_ID`
- `APPLE_NOTARY_PRIVATE_KEY`

Store them only in `apple-notarization`. Renewals and Apple identity revalidation remain external authority boundaries.

Import the certificate into an ephemeral keychain during the macOS job. Verify
the Developer ID Application subject includes `APPLE_TEAM_ID`; submit with
`notarytool`, inspect the accepted log, staple, and require both `codesign` and
`spctl` verification before archiving. Delete the keychain and temporary key
material at job cleanup.

## Azure Artifact Signing

Create a Public Trust signing account/profile and GitHub OIDC federation.
Configure these GitHub environment **variables** (not secrets) in
`windows-signing`:

- `AZURE_TENANT_ID`
- `AZURE_SUBSCRIPTION_ID`
- `AZURE_CLIENT_ID`
- `AZURE_SIGNING_ACCOUNT`
- `AZURE_SIGNING_PROFILE`
- `AZURE_SIGNING_ENDPOINT`

Grant only the Artifact Signing Certificate Profile Signer role needed by the federated identity.

Create the federated credential from the exact `sub` claim observed during a
non-publishing rehearsal. Prefer an immutable workflow identity template when
GitHub and Azure both support the selected claim shape; do not hard-code a
legacy subject assumption. The `windows-signing` environment's protected-branch
policy and the repository's protected workflows constrain the caller
separately. The job must verify Authenticode status and timestamp before the
executable is archived. Do not add an Azure client secret fallback.

## WinGet and Chocolatey

- Accept the Microsoft CLA for the submitting identity.
- Store an expiry-bounded classic PAT named `WINGET_CREATE_GITHUB_TOKEN` in
  `winget`, with only the `public_repo` scope required by `winget-create`.
  Fine-grained tokens are not supported by the tool. Accept and monitor the
  residual access to public repositories explicitly; the identity must have no
  GuardScan administration or release authority. The workflow supplies this
  token only through the documented environment variable, never a command-line
  argument.
- Create/validate the Chocolatey publisher account.
- Store `CHOCO_API_KEY` in `chocolatey`.

Rehearse WinGet local-manifest install before submission and Chocolatey
install/upgrade/invoke/uninstall from a local feed before `choco push`. A
successful submission is not deployment.

WinGet review and Chocolatey validation, verification, VirusTotal, and moderation are external states. The ledger keeps them `submitted` until public installation passes.

## Optional Homebrew Core

Homebrew Core is **not selected** for the current release train. Do not submit a
Core formula and do not advertise `brew install guardscan` during `1.1.0`.
Users install from the first-party tap until a separate reviewed enablement is
merged and verified.

Enabling Core later requires all of the following:

1. a reviewed change that explicitly adds `homebrew-core` to the selected
   stable channels and ledger policy;
2. a source-building formula that meets current Homebrew Core policy and passes
   local style, audit, build, test, and uninstall checks;
3. submission to Homebrew Core, external acceptance, and a clean public install
   canary for the one-part command; and
4. documentation changes only after the public canary reports `verified`.

Core remains nonblocking for first-party release completion even after an
optional submission is tracked.

## First `1.1.0` bootstrap exception

The first stable train does not ask Release Please to regenerate `1.1.0`.
The protected `release/1.1.0` pull request is the bootstrap release source
because the previous `main` baseline and the new Release Please seed disagree
about whether `1.1.0` is already prepared. Derive `1.1.0-rc.1` from that exact
PR head, require the normal release gates, and merge/tag it through the release
train. After `v1.1.0` is verified, align the Release Please manifest to `1.1.0`
so subsequent stable release PRs follow the normal automated path.

Because v1.0.5 predates the protected release ledger, it is not a valid
automated rollback target for this train. Before enabling automation, rehearse
the first-release withdrawal contract: an empty `known_good` must be accepted
only when the protected ledger proves there is no completed predecessor; it
must retain immutable assets, remove or verify the exact empty shared catalog,
open a recovery incident, record provider-owned actions, and avoid generating
a forward-fix branch. A separately reviewed v1.1.1 is required after such a
withdrawal. Later releases must supply a verified ledger-backed `known_good`.
Repository withdrawal is not provider withdrawal: the protected state remains
`provider-actions-pending`, with the recovery incident open, until the recorded
npm, PyPI, WinGet, Chocolatey, or optional Core authorities complete their
actions. Retrying the workflow re-verifies the empty catalog and closes the
exact stale catalog publication PR; it does not turn pending provider work into
success.

## Expiry monitoring

Credential health is a launch gate, not an informal maintainer reminder.
Configure alerts to a monitored release-owner destination and record only
status/expiry metadata, never secret values.

| Identity/binding | Automated signal | Alert/rehearsal policy |
| --- | --- | --- |
| GitHub App | Installation exists on exactly both repositories; required permissions remain; token mint succeeds | Check daily and before every candidate. Alert immediately on installation/permission drift and at the configured private-key age limit. |
| npm trusted publisher | Repository, caller workflow, and `npm-publish` environment match; no token fallback exists | Check before every candidate and monthly. A mismatch keeps automation off. |
| TestPyPI/PyPI trusted publishers | Project, repository, caller workflow, and the distinct `testpypi`/`pypi` environments match | Check both services before every candidate and monthly; rehearse TestPyPI before production. |
| Apple certificate/notary identity | Certificate subject/team, expiry, and notary authentication are valid | Check daily; alert at 60, 30, 14, and 7 days. Renewal/identity revalidation requires the publisher. |
| Azure federation/signing profile | Federated subject, signer role, account/profile state, and timestamp service are healthy | Check weekly and before every candidate with a non-secret signing preflight. Alert immediately on role or federation drift. |
| WinGet submitter | Token expiry/scope and Microsoft CLA state are valid | Check weekly; alert at 30, 14, and 7 days. CLA or account challenges remain external authority boundaries. |
| Chocolatey publisher | Account/package ownership and API-key authentication remain valid | Check weekly with a non-publishing endpoint; alert at 30, 14, and 7 days when expiry metadata is available. |
| Shared catalog connection | App installation, required check, dispatch permission, and scheduled reconciliation are healthy | Check daily. A missed dispatch is recovered by reconciliation; an invalid lock/digest is an integrity incident. |

If the provider does not expose expiry metadata, use a bounded authentication
preflight and record `unknown` rather than inventing a date. Monitoring is not
complete until at least one alert path has been tested.

The credential workflow keeps those unobservable fields `unknown`. For a
release preflight only, it separately requires
`RELEASE_PROVIDER_ONBOARDING_ATTESTATION` to match the SHA-256 subject computed
from the exact trusted control plane and rejects every machine-observed
`warning` or `unhealthy` provider status. Only the documented Azure,
Chocolatey, trusted-publisher, and WinGet visibility boundaries may remain
`unknown`. Keep the attestation false until all provider configuration and
rehearsal steps above have passed; set it false again whenever a binding,
account, environment, publisher identity, or attested control-plane file
changes. A control-plane edit changes the computed subject and therefore blocks
release eligibility until the provider bindings are rechecked. Re-run the
onboarding checks and issue a new attestation at least every 30 days; the
workflow rejects future-dated, expired, or longer-lived attestations.

After every onboarding item, functional acceptance prerequisite, and monitoring
rehearsal passes, set `RELEASE_AUTOMATION_ENABLED=true` and immediately dispatch
the first candidate. No later release requires a human promotion click. Only
provider-mandated identity, MFA, legal, certificate-renewal, account
verification, or moderator requests remain human boundaries; automation must
report those states rather than claiming completion.
