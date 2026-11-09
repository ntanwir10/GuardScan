# Install, upgrade and uninstall

GuardScan 1.1.0 is currently published **only to npm**. Every other channel below is planned for 1.1.1 and is **not yet available**: the commands shown for those channels do not work today.

| Channel | Status |
|---|---|
| npm | Available now |
| pnpm | Available now |
| Yarn | Available now |
| Bun | Available now |
| Homebrew tap | Planned for 1.1.1, not yet available |
| Scoop | Planned for 1.1.1, not yet available |
| PyPI (`pipx`) | Planned for 1.1.1, not yet available |
| WinGet | Planned for 1.1.1, not yet available |
| Chocolatey | Planned for 1.1.1, not yet available |
| Standalone binaries | Planned for 1.1.1, not yet available |

## Requirements

Node.js 22 or newer for the npm-based channels. Node.js, npm, pnpm, Yarn and Bun are third-party tools; install them from their own websites. The planned standalone binaries are intended to bundle Node.js.

## Available now

### npm

```bash
npm install -g guardscan        # install
guardscan --version
npm install -g guardscan@latest # upgrade
npm uninstall -g guardscan      # uninstall
```

### pnpm

```bash
pnpm add -g guardscan
pnpm update -g guardscan
pnpm remove -g guardscan
```

### Yarn

Yarn Classic (1.x):

```bash
yarn global add guardscan
yarn global upgrade guardscan
yarn global remove guardscan
```

Yarn Berry (2+) has no global installs; use `npm install -g guardscan`, or run it once with `yarn dlx guardscan`.

### Bun

```bash
bun add -g guardscan
bun update -g guardscan
bun remove -g guardscan
```

### From source

```bash
git clone https://github.com/ntanwir10/GuardScan.git
cd GuardScan/cli
npm ci && npm run build && npm link   # install
git pull && npm ci && npm run build   # upgrade
npm unlink -g guardscan               # uninstall
```

### Run without installing

```bash
npx guardscan@latest security --offline --no-cve
```

## Planned for 1.1.1 (not yet available)

> **None of these channels is live.** The names below are the intended identifiers. Do not rely on them until the 1.1.1 release notes announce each channel. macOS binaries will be ad-hoc signed and Windows binaries unsigned; every artifact will carry a Sigstore signature and a GitHub build attestation. Gatekeeper and SmartScreen will warn on direct browser downloads; package-manager installs are unaffected.

| Channel | Install | Upgrade | Uninstall |
|---|---|---|---|
| Homebrew tap | `brew install ntanwir10/tap/guardscan` | `brew upgrade guardscan` | `brew uninstall guardscan` |
| Scoop | `scoop bucket add guardscan https://github.com/ntanwir10/homebrew-tap` then `scoop install guardscan` | `scoop update guardscan` | `scoop uninstall guardscan` |
| PyPI | `pipx install guardscan-cli` | `pipx upgrade guardscan-cli` | `pipx uninstall guardscan-cli` |
| WinGet | `winget install NaumanTanwir.GuardScan` | `winget upgrade NaumanTanwir.GuardScan` | `winget uninstall NaumanTanwir.GuardScan` |
| Chocolatey | `choco install guardscan` | `choco upgrade guardscan` | `choco uninstall guardscan` |
| Standalone binary | download from GitHub Releases, verify, put on `PATH` | download the new binary | delete the binary |

Homebrew, Scoop, pipx, WinGet and Chocolatey are third-party package managers; install them from their own projects.

## Remove local data

Uninstalling the package leaves GuardScan's configuration and caches in `~/.guardscan` (or `GUARDSCAN_HOME`). Remove them first if you want a clean slate:

```bash
guardscan reset --all --force   # clears config, caches, snapshots and the telemetry queue
```

Then uninstall with the same package manager you installed with. `guardscan config --telemetry=false` also deletes queued telemetry without a full reset.

## Verify

```bash
guardscan --version
guardscan status
```

## Telemetry notice for old versions

Versions 1.0.5 and earlier still try to send telemetry to a retired address. Upgrade to 1.1.0 or later, or run `guardscan config --telemetry=false`. See [PRIVACY.md](../PRIVACY.md).

Next: [Getting started](GETTING_STARTED.md) · [Command reference](COMMANDS.md).
