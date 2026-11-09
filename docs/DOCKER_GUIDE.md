# Running GuardScan in Docker

GuardScan is a Node.js CLI. This guide shows how to run it inside a container, including Alpine Linux.

> **No official GuardScan image is published.** There is no GuardScan image on Docker Hub or GHCR and no `docker pull` target. Every example here runs the public npm package inside a third-party base image such as `node:22-alpine`. If GuardScan ever publishes an image, this page and the [install guide](INSTALL.md) will say so.

## Third-party prerequisites

GuardScan does not install or maintain any of these. Follow each project's own instructions:

| Prerequisite | Needed for | Where to get it |
|---|---|---|
| Docker Engine or Docker Desktop | Running containers | <https://docs.docker.com/get-started/get-docker/> |
| A Node.js base image (`node:22-alpine`, `node:22-slim`) | GuardScan needs Node.js 22 or newer | <https://hub.docker.com/_/node> |
| WSL 2 (Windows only) | Linux containers on Docker Desktop | <https://learn.microsoft.com/windows/wsl/install> |
| Package managers (`apt`, `apk`, Homebrew, Chocolatey) | Installing Docker or build tools on the host | The vendor's documentation |

Installing Docker, Homebrew or Chocolatey is outside the scope of this guide.

## Quick start

Scan the current directory with a throwaway container:

```bash
docker run --rm -v "$PWD":/workspace -w /workspace \
  -e GUARDSCAN_HOME=/tmp/guardscan \
  node:22-alpine sh -c "npm install -g guardscan && guardscan init && guardscan security --offline --no-cve"
```

PowerShell:

```powershell
docker run --rm -v "${PWD}:/workspace" -w /workspace `
  -e GUARDSCAN_HOME=/tmp/guardscan `
  node:22-alpine sh -c "npm install -g guardscan && guardscan init && guardscan security --offline --no-cve"
```

`GUARDSCAN_HOME` points GuardScan's state (config, caches, vulnerability snapshots) at a writable path, which avoids home-directory problems in minimal containers. The container path always uses forward slashes; mount the project from a path Docker Desktop can share.

## Choosing a base image

| Image | Notes |
|---|---|
| `node:22-alpine` | Smallest. Uses musl libc. Recommended for CI. |
| `node:22-slim` | Debian-based; choose it if an Alpine-specific problem appears. |
| `node:22` | Largest; includes build tools. |

Any Node.js 22+ tag works; GuardScan requires `node >= 22`.

## Alpine notes

Native build tools are only needed if npm tries to compile an optional native dependency (for example the optional chart renderer `chartjs-node-canvas`). If installation reports native build errors, add the toolchain first:

```bash
apk add --no-cache python3 make g++ pkgconfig cairo-dev pango-dev \
  libjpeg-turbo-dev giflib-dev pixman-dev freetype-dev build-base git
npm install -g guardscan
```

## Persist state between runs

GuardScan stores configuration and caches under `~/.guardscan`, or under `GUARDSCAN_HOME` when set. Use a named volume to keep them:

```bash
docker volume create guardscan-state
docker run --rm -v guardscan-state:/guardscan -e GUARDSCAN_HOME=/guardscan \
  -v "$PWD":/workspace -w /workspace node:22-alpine \
  sh -c "npm install -g guardscan && guardscan init && guardscan vuln db update . && guardscan vuln . --offline"
```

Never bake API keys into an image. Pass provider keys at run time with `-e`, or use your CI system's secret store.

## Docker Compose

```yaml
services:
  guardscan:
    image: node:22-alpine
    working_dir: /workspace
    volumes:
      - .:/workspace:ro
      - guardscan-state:/guardscan
    environment:
      GUARDSCAN_HOME: /guardscan
    command: sh -c "npm install -g guardscan && guardscan init && guardscan security --ci --offline --no-cve --format sarif --output /guardscan/guardscan.sarif"

volumes:
  guardscan-state:
```

Mounting the source read-only is enough for scanning; write reports to the state volume or another writable path.

## A reusable Dockerfile

Build your own image if you scan often (this is your image, not a GuardScan release):

```dockerfile
FROM node:22-alpine
RUN npm install -g guardscan && addgroup -g 1000 scanner && adduser -D -u 1000 -G scanner scanner
USER scanner
ENV GUARDSCAN_HOME=/home/scanner/.guardscan
WORKDIR /workspace
ENTRYPOINT ["guardscan"]
```

```bash
docker build -t my-guardscan .
docker run --rm -v "$PWD":/workspace my-guardscan security --offline --no-cve
```

Pin a GuardScan version (`npm install -g guardscan@1.1.0`) when you need reproducible builds. Run `guardscan init` once (for example in the image build or as a first step) if the container has no configuration yet.

## CI

Containers work well in CI because the exit codes are stable. See [Offline mode and CI](OFFLINE_AND_CI.md) for GitHub Actions, SARIF upload and `--fail-on`, and the [exit-code table](COMMANDS.md#exit-codes). In GitLab CI, the same pattern applies:

```yaml
guardscan:
  image: node:22-alpine
  script:
    - npm install -g guardscan
    - guardscan init
    - guardscan security --ci --offline --no-cve --format sarif --output guardscan.sarif --fail-on high
  artifacts:
    when: always
    paths: [guardscan.sarif]
```

## Hardening

```bash
docker run --rm --read-only --tmpfs /tmp --network none \
  --memory 1g --cpus 2 \
  -v "$PWD":/workspace:ro -w /workspace \
  -e GUARDSCAN_HOME=/tmp/guardscan \
  my-guardscan security --offline --no-cve
```

`--network none` only works with a pre-built image (the install step needs network access) and with `--offline` runs that use `--no-cve` or a prepared vulnerability snapshot.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `Configuration not found. Run "guardscan init" first.` | Run `guardscan init` in the same container, and keep `GUARDSCAN_HOME` identical between runs. |
| `Permission denied` writing state | The container user cannot write the home directory. Set `GUARDSCAN_HOME=/tmp/guardscan` or mount a writable volume. |
| Native build errors during `npm install -g` on Alpine | Install the toolchain shown in [Alpine notes](#alpine-notes), or use `node:22-slim`. |
| `Cannot find module 'typescript'` | The install was interrupted. Re-run `npm install -g guardscan`; `typescript` is a regular dependency. |
| Slow bind mounts on macOS or Windows | Mount only the project directory. |
| Unclear failure | Re-run with `GUARDSCAN_DEBUG=true` or `--debug` (on `security`). |

More help: [GitHub issues](https://github.com/ntanwir10/GuardScan/issues).
