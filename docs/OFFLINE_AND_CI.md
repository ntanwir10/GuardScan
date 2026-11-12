# Offline mode and CI

How to run GuardScan with no network access, and how to gate a pipeline on its results.

## Offline mode

Offline mode blocks GuardScan's cloud AI providers, cloud embeddings, advisory lookups, update checks and telemetry. Ollama and LM Studio keep working only at loopback addresses (`127.0.0.0/8` or `::1`).

Apply it to one invocation or persist it:

```bash
guardscan --offline security          # one command
guardscan config --offline=true       # persistent
GUARDSCAN_OFFLINE=true guardscan scan # environment variable
```

`--no-cloud` is a deprecated alias for `--offline`.

### Dependency vulnerabilities offline

The built-in static checks need no network. Dependency CVE scanning needs advisory data. Either skip it, or prepare a snapshot while online and reuse it offline:

```bash
# Static checks only, guaranteed no network
guardscan security --offline --no-cve

# Prepare a snapshot online, then scan offline
guardscan config --offline=false
guardscan vuln db update .
guardscan vuln . --offline
```

An offline CVE scan requires a fresh snapshot matching the repository's dependency inventory. A missing, stale or mismatched snapshot is an operational failure (exit code `2`) unless you pass `--allow-partial`. See [Dependency Vulnerability Scanning](VULNERABILITY_SCANNING.md) for coverage limits, and [PRIVACY.md](https://github.com/ntanwir10/GuardScan/blob/main/PRIVACY.md) for exactly what each mode sends.

## Failing a build

`scan`, `security` and `vuln` accept `--ci`, `--fail-on <severity>` and a count limit:

| Option | Effect |
|---|---|
| `--ci` | CI-friendly output and exit-code policy |
| `--fail-on <severity>` | Fail at or above `critical`, `high`, `medium`, `low` (`info` too for `scan` and `security`) |
| `--max-findings <n>` | `scan` and `security`: fail when the finding count exceeds `n` |
| `--max-vulnerabilities <n>` | `vuln`: fail when the vulnerability count exceeds `n` |
| `--allow-partial` | Accept incomplete scanner or CVE coverage instead of exiting `2` |

Exit codes are `0` (passed), `1` (policy violated) and `2` (a required scanner or coverage step failed). The full [exit-code table](COMMANDS.md#exit-codes) is in the command reference.

## SARIF

```bash
guardscan security --ci --format sarif --output guardscan.sarif --fail-on high
guardscan vuln . --format sarif --output vulns.sarif
```

Formats for `scan` and `security` are `markdown`, `json` and `sarif`. `vuln` supports `table`, `json` and `sarif`.

## GitHub Actions

```yaml
name: GuardScan
on: [push, pull_request]

jobs:
  guardscan:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write   # needed to upload SARIF
      actions: read            # also needed for upload-sarif in private repositories
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Install GuardScan
        run: npm i -g guardscan
      - name: Initialize
        run: guardscan --no-telemetry init
      - name: Scan
        run: >
          guardscan security --offline --no-cve --ci
          --format sarif --output guardscan.sarif --fail-on high
      - name: Upload SARIF
        if: always()
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: guardscan.sarif
```

`actions/*` and `github/codeql-action` are third-party GitHub actions; pin them to commit SHAs if your policy requires it. Pin the GuardScan version too (`npm i -g guardscan@1.1.1`) for reproducible runs.

`guardscan init` in CI persists offline mode, and `security` only scans dependencies with `--cve`. For online CVE coverage, run `guardscan config --offline=false` after `init` and add `--cve` (and drop `--offline --no-cve`). To reuse a snapshot restored from your own cache, keep `--offline` and add `--cve`. SARIF upload also requires code scanning to be enabled for the repository.

## Pre-commit hook

```bash
#!/bin/bash
guardscan security --offline --no-cve --ci --format json --output guardscan.json
case $? in
  0) exit 0 ;;
  1) echo "GuardScan policy failed; review guardscan.json." ; exit 1 ;;
  *) echo "GuardScan could not complete required coverage." ; exit 2 ;;
esac
```

See also [Getting Started](GETTING_STARTED.md) and the [Docker guide](DOCKER_GUIDE.md).
