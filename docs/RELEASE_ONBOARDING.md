# One-time release provider onboarding

The repository contains the zero-touch release implementation. The following provider-owned identity and account steps must be completed once before `1.1.0-rc.1`. Automation must not fabricate or bypass them.

## GitHub

- Reauthenticate `gh` as `ntanwir10`.
- Create `ntanwir10/homebrew-tap` and `ntanwir10/scoop-bucket` as public repositories.
- Create `guardscan-release-bot` as a GitHub App.
- Grant the App GuardScan contents/pull-request/workflow access and contents/pull-request access on the tap and bucket.
- Store `RELEASE_APP_ID` as a repository variable and `RELEASE_APP_PRIVATE_KEY` as a secret.
- Create and protect `release-ledger`; require the App identity for writes.
- Protect `v*` tags so only the release App can create them.
- Enable immutable releases for GuardScan.
- Require the full `Release gate` status on the stable release PR.

Create environments without manual reviewers:

- `release-rc`
- `release-stable`
- `npm-publish`
- `pypi`
- `apple-notarization`
- `windows-signing`
- `winget`
- `chocolatey`

Restrict them to the release workflows and protected candidate/stable tags. Fork pull requests must not receive environment secrets or OIDC tokens.

## npm

- Configure trusted publishing for package `guardscan`.
- Bind it exactly to `ntanwir10/GuardScan`, `.github/workflows/release-publish.yml`, and environment `npm-publish`.
- Do not retain an npm token fallback after OIDC succeeds.

## TestPyPI and PyPI

- Reserve `guardscan-cli`.
- Configure pending trusted publishers for both TestPyPI and PyPI.
- Bind them exactly to `ntanwir10/GuardScan`, `.github/workflows/release-publish.yml`, and environment `pypi`.

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

## Expiry monitoring

Configure provider notifications for:

- GitHub App key age and installation loss;
- Apple certificate/notary key expiry;
- Azure federation/profile health;
- Chocolatey API key validity;
- WinGet token expiry or revoked CLA status.

No later release requires a human promotion click. Only provider-mandated identity, MFA, legal, certificate-renewal, or moderator requests remain human boundaries.
