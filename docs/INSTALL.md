# Install, upgrade and uninstall

From 1.1.1, GuardScan is distributed through the channels below. This table is the single source of truth for install-channel status.

| Channel | Status | Platforms |
|---|---|---|
| npm | Available (with npm provenance from 1.1.1) | Any platform with Node.js 22+ |
| pnpm | Available | Any platform with Node.js 22+ |
| Yarn | Available | Any platform with Node.js 22+ |
| Bun | Available | Any platform with Node.js 22+ |
| Homebrew tap | From 1.1.1 | macOS arm64/x64, Linux arm64/x64 (glibc) |
| Scoop | From 1.1.1 | Windows x64 |
| PyPI (`pipx`) | From 1.1.1 | macOS arm64/x64, Linux x86_64/aarch64 (manylinux_2_28), Windows x64 |
| WinGet | From 1.1.1, available once Microsoft's moderation accepts it | Windows x64 |
| Chocolatey | From 1.1.1, available once Chocolatey's moderation accepts it | Windows x64 |
| Standalone binaries (GitHub Releases) | From 1.1.1 | macOS arm64/x64, Linux arm64/x64 (glibc), Windows x64 |

## Requirements

Node.js 22 or newer for npm, pnpm, Yarn and Bun; the other channels install a standalone binary with Node.js bundled. Node.js, npm, pnpm, Yarn and Bun are third-party tools; install them from their own websites.

## Node.js package managers

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

## Native channels

Every artifact carries a SHA256 entry in `SHA256SUMS`, a Sigstore signature and a GitHub build attestation. macOS binaries are ad-hoc signed and not notarized, and Windows binaries are not Authenticode-signed yet, so Gatekeeper and SmartScreen may warn on direct browser downloads; package-manager installs are unaffected. See [Verify a download](#verify-a-download).

| Channel | Install | Upgrade | Uninstall |
|---|---|---|---|
| Homebrew tap | `brew tap ntanwir10/tap`, then `brew trust --formula ntanwir10/tap/guardscan`, then `brew install ntanwir10/tap/guardscan` | `brew upgrade guardscan` | `brew uninstall guardscan` |
| Scoop | `scoop bucket add guardscan https://github.com/ntanwir10/homebrew-tap` then `scoop install guardscan` | `scoop update guardscan` | `scoop uninstall guardscan` |
| PyPI | `pipx install guardscan-cli` | `pipx upgrade guardscan-cli` | `pipx uninstall guardscan-cli` |
| WinGet | `winget install NaumanTanwir.GuardScan` | `winget upgrade NaumanTanwir.GuardScan` | `winget uninstall NaumanTanwir.GuardScan` |
| Chocolatey | `choco install guardscan` | `choco upgrade guardscan` | `choco uninstall guardscan` |
| Standalone binary | download from [GitHub Releases](https://github.com/ntanwir10/GuardScan/releases), [verify](#verify-a-download), put on `PATH` | download the new binary | delete the binary |

Standalone release files are named `guardscan-<version>-darwin-arm64.zip`, `guardscan-<version>-darwin-x64.zip`, `guardscan-<version>-linux-x64-glibc.tar.gz`, `guardscan-<version>-linux-arm64-glibc.tar.gz` and `guardscan-<version>-windows-x64.zip`, alongside `SHA256SUMS`, Sigstore bundles and SBOMs (CycloneDX and SPDX).

Current Homebrew refuses to load formulae from third-party taps until you trust them, which is what `brew trust` does. Tap first, then trust. If your Homebrew has no `brew trust` command, it predates that check: skip that step.

Homebrew, Scoop, pipx, WinGet and Chocolatey are third-party package managers; install them from their own projects.

## Verify a download

Run these against a file downloaded from GitHub Releases.

1. Check the checksum against `SHA256SUMS` from the same release, and confirm the output has an `OK` line for the exact file you downloaded:

   ```bash
   shasum -a 256 -c SHA256SUMS --ignore-missing   # macOS
   sha256sum -c SHA256SUMS --ignore-missing       # Linux
   ```

   On Windows (PowerShell), compare the file's hash with its line in `SHA256SUMS`:

   ```powershell
   (Get-FileHash .\guardscan-<version>-windows-x64.zip -Algorithm SHA256).Hash.ToLower()
   Select-String -Path .\SHA256SUMS -Pattern 'windows-x64.zip'
   ```

2. Verify the GitHub build attestation:

   ```bash
   gh attestation verify <file> -R ntanwir10/GuardScan \
     --signer-workflow ntanwir10/GuardScan/.github/workflows/release-build.yml
   ```

3. For the npm package, `npm audit signatures` checks the registry signatures and SLSA provenance of a project's installed dependencies, not global installs. Run it in a temporary project:

   ```bash
   mkdir guardscan-verify && cd guardscan-verify
   npm init -y
   npm install guardscan@<version>
   npm audit signatures
   ```

   Set `<version>` to the version you installed (`guardscan --version`). This verifies that version as published on the registry; it does not check the files in your global install. Provenance is also shown on npmjs.com.

**macOS.** Binaries are ad-hoc signed and not notarized, so Gatekeeper quarantines a zip downloaded in a browser. After verifying, clear the flag with `xattr -d com.apple.quarantine <path>`. Homebrew, pipx and npm installs are unaffected.

**Windows.** Binaries are not Authenticode-signed yet, so SmartScreen may warn on a direct download.

## Remove local data

Uninstalling the package leaves GuardScan's configuration and caches in `~/.guardscan` (or `GUARDSCAN_HOME`). Remove them first if you want a clean slate:

```bash
guardscan reset --all --force   # clears config, caches, snapshots and the telemetry queue
```

Then uninstall with the same package manager you installed with. `guardscan config --telemetry=false` also deletes queued telemetry without a full reset.

## Check the installation

```bash
guardscan --version
guardscan status
```

## Telemetry notice for old versions

Versions 1.0.5 and earlier with telemetry enabled still try to send telemetry to a retired address. Upgrade to 1.1.0 or later. For version 1.0.5, you can also set `GUARDSCAN_NO_TELEMETRY=true` in the environment of each GuardScan process; this does not delete queued events. See [PRIVACY.md](../PRIVACY.md).

Next: [Getting started](GETTING_STARTED.md) · [Command reference](COMMANDS.md).
