# Install, upgrade and uninstall

From 1.1.1, GuardScan is distributed through the channels below. This table is the single source of truth for install-channel status.

| Channel | Status | Platforms |
|---|---|---|
| npm | Available (with npm provenance from 1.1.1) | Any platform with Node.js 22+ |
| pnpm | Available | Any platform with Node.js 22+ |
| Yarn | Available | Any platform with Node.js 22+ |
| Bun | Available | Any platform with Node.js 22+ |
| npx | Run without installing; see [Run without installing](#run-without-installing) | Any platform with Node.js 22+ |
| Homebrew tap | Available from 1.1.1 | macOS arm64/x64, Linux arm64/x64 (glibc) |
| Scoop | Available from 1.1.1 | Windows x64 |
| PyPI (`pipx`) | Available from 1.1.1 | macOS arm64/x64, Linux x86_64/aarch64 (manylinux_2_28), Windows x64 |
| Standalone binaries (GitHub Releases) | Available from 1.1.1 | macOS arm64/x64, Linux arm64/x64 (glibc), Windows x64 |

## Requirements

Node.js 22 or newer for npm, pnpm, Yarn and Bun; the other channels install a standalone binary with Node.js bundled. Node.js, npm, pnpm, Yarn and Bun are third-party tools; install them from their own websites.

## Update and uninstall from GuardScan

```bash
guardscan update --dry-run        # list detected copies and preview the update
guardscan config --offline false  # allow network access for updates
guardscan update --check          # list installed copies and check the latest stable version
guardscan --update                # same as guardscan update
guardscan update --manager npm    # select a manager when several copies exist
guardscan uninstall --dry-run     # preview removal; preserve local data
guardscan uninstall --yes         # confirm removal using the detected owner
```

GuardScan checks its running executable and GuardScan launchers on `PATH` against package-manager ownership metadata. It uses the manager that owns the selected copy, even if you launched it through another manager. Multiple copies require `--manager`; multiple copies owned by the same manager require fixing `PATH` and that manager's global configuration first. Unrecognized, source, and directly downloaded installations show manual instructions instead of guessing which global package to change. Detection does not search every Node version or directory on your machine.

Commands such as `npm uninstall -g guardscan` only affect npm's installation. They cannot remove a copy owned by pipx, Homebrew, or another manager. Use `guardscan uninstall` to detect the owner, or use the matching command below. GuardScan does not intercept third-party install or uninstall commands; check existing installations before switching channels.

GuardScan cannot warn while a package manager installs it, so it warns the first time a new copy runs. In an interactive terminal, when it sees a new set of `guardscan` commands on `PATH`, it checks for more than one installation. If it finds several, it lists each copy with its owning manager and the `guardscan uninstall --manager <manager>` command that removes it, then runs your command as usual. It warns again only when the set of copies changes. It stays silent in CI and when output is redirected, ignores copies run through `npx` or a project's `node_modules/.bin`, and never changes the command's result. A copy listed as `unknown` may be a different tool that is also named `guardscan`.

On Windows, close GuardScan and run the displayed Scoop or pipx command directly: Windows keeps their running executable open. Standalone downloads and source checkouts continue to use the manual upgrade and removal instructions below.

### Automatic updates

```bash
guardscan update --auto on
guardscan update --auto status
guardscan update --auto off
guardscan security --no-auto-update  # skip automatic updates for one command
```

Automatic updates are off by default. When enabled, GuardScan checks the stable npm version (cached for 24 hours) after successful interactive commands and updates through the detected owner. Automatic updates require exactly one recognized, active installation, work independently of telemetry consent, and are skipped in CI, noninteractive sessions, redirected output, and offline mode. Help, version, configuration, reset, update, and uninstall commands never trigger automatic updates. The package manager determines which stable version is available in its channel; a native channel can lag behind npm. GuardScan attempts each new version automatically at most once every 24 hours, so a lagging channel or a failed update does not rerun the package manager on every command. Errors leave the original command's exit status intact and display update guidance.

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
| Standalone binary | download from [GitHub Releases](https://github.com/ntanwir10/GuardScan/releases), [verify](#verify-a-download), put on `PATH` | download the new binary | delete the binary |

Standalone release files are named `guardscan-<version>-darwin-arm64.zip`, `guardscan-<version>-darwin-x64.zip`, `guardscan-<version>-linux-x64-glibc.tar.gz`, `guardscan-<version>-linux-arm64-glibc.tar.gz` and `guardscan-<version>-windows-x64.zip`, alongside `SHA256SUMS`, Sigstore bundles and SBOMs (CycloneDX and SPDX).

Current Homebrew refuses to load formulae from third-party taps until you trust them, which is what `brew trust` does. Tap first, then trust. If your Homebrew has no `brew trust` command, it predates that check: skip that step.

Homebrew, Scoop and pipx are third-party package managers; install them from their own projects. WinGet and Chocolatey are not supported; Windows users should use Scoop, pipx, npm or npx.

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

Then use `guardscan uninstall --yes`, or uninstall with the same package manager you installed with. `guardscan config --telemetry=false` also deletes queued telemetry without a full reset.

## Check the installation

```bash
guardscan --version
guardscan status
guardscan update --dry-run
```

## Telemetry notice for old versions

Versions 1.0.5 and earlier with telemetry enabled still try to send telemetry to a retired address. Upgrade to 1.1.0 or later. For version 1.0.5, you can also set `GUARDSCAN_NO_TELEMETRY=true` in the environment of each GuardScan process; this does not delete queued events. See [PRIVACY.md](../PRIVACY.md).

Next: [Getting started](GETTING_STARTED.md) · [Command reference](COMMANDS.md).
