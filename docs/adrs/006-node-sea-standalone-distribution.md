# ADR 006: Node.js SEA for standalone GuardScan distribution

## Status

Proposed

## Date

2026-07-25

## Context

GuardScan's npm package requires Node.js. Homebrew, Scoop, WinGet, Chocolatey, and an optional `pipx` channel need an immutable executable that runs when Node and npm are absent from `PATH`. Those channels must install the same GuardScan implementation and may not bootstrap through npm, `npx`, or an unversioned download.

The CLI currently has characteristics that constrain the builder:

- TypeScript compiles to CommonJS and the entry point uses dynamic imports for command modules.
- Package metadata is imported at runtime in several modules.
- TypeScript is a runtime dependency for AST-backed features.
- `tiktoken` and chart rendering are optional. Chart rendering includes native bindings and must degrade cleanly when unavailable.
- Node.js SEA executes one embedded script. Its injected `require()` loads built-ins only, so all required JavaScript dependencies must be bundled into that script.
- SEA code cache and V8 snapshots are platform-specific. They cannot be used for a cross-platform build.
- macOS and Windows executable mutation affects platform signatures, so final signing must happen after SEA blob injection.

## Decision

Use a two-stage host-native build:

1. Bundle the compiled CLI and required JavaScript dependencies into one CommonJS file with a pinned `esbuild`.
2. Generate a Node.js SEA blob with `useCodeCache: false` and `useSnapshot: false`, copy the exact CI Node executable, inject the blob with a pinned `postject`, smoke-test it with Node absent from `PATH`, and only then archive and sign it.

Each target is built on its native hosted runner:

- macOS arm64 and x64 on macOS runners;
- Linux x64 and arm64 glibc on Linux runners;
- Windows x64 on a Windows runner.

The first prototype is host-platform only. It emits explicitly non-publishable prototype metadata and cannot be consumed by adapter rendering. Production artifact metadata is generated only after archive reproducibility, platform signing, provenance, and the full standalone smoke contract pass.

`tiktoken` and `chartjs-node-canvas` remain external optional capabilities. The standalone executable reports token estimates and omits chart images when those modules are unavailable. Core static scanning, dependency inventory, vulnerability snapshot use, and SPDX/CycloneDX SBOM generation remain required capabilities.

Python wheels, if approved, bundle the exact already-tested platform executable. The Python package contains only a small launcher and metadata; it does not contain a second GuardScan implementation and does not download a runtime during installation or first use.

## Rationale

Node SEA keeps the runtime aligned with the implementation and avoids an unsupported JavaScript-runtime fork. A one-file CommonJS bundle satisfies SEA's module-loading constraint and lets the existing CLI remain the source of behavior.

Host-native builds make signing and smoke testing explicit and avoid platform-specific code-cache or snapshot hazards. Disabling both features trades some startup optimization for portability and lower release risk.

The alternatives were rejected for the initial implementation:

- `pkg` and similar archived bundlers introduce a second runtime patch set and uncertain support for current Node releases.
- `bun build --compile` would make Bun runtime compatibility a product contract that the current Node-oriented test suite does not establish.
- Shipping a shell, Python, or PowerShell bootstrapper that downloads Node/npm violates offline, immutability, and install-time execution requirements.
- Reimplementing the CLI in Python for PyPI would create divergent behavior and release identities.

## Consequences

### Positive

- Native package managers can eventually install one immutable executable without Node.
- npm and standalone channels retain one implementation and version.
- Every target is built and tested where its signing and runtime behavior can be observed.
- Optional native modules cannot block core standalone startup.
- PyPI can remain a thin transport for the same executable.

### Negative

- The executable includes a Node runtime and will be materially larger than the npm package.
- Bundling the TypeScript compiler increases artifact size.
- Optional accurate tokenization and chart rendering are unavailable in the initial standalone capability profile.
- Five host-native builds, notarization, Authenticode, and provenance add release cost.
- `postject` is an additional release-critical dependency and must remain exactly pinned, lockfile-verified, and covered by artifact smoke tests.

## Implementation details

- Builder dependencies are development-only, exact-version pinned, and never installed by end users.
- The bundle target is the minimum supported runtime (`node22`), CommonJS, one output file, no code splitting.
- The builder fails on unresolved required imports and externalizes only an explicit allowlist of optional native packages.
- Prototype output includes source version, commit, platform, architecture, Node runtime, bundle and executable SHA-256, size, capabilities, and `productionReady: false`.
- Smoke tests run `--version`, `--help`, an offline static-only scan, SBOM generation, and telemetry status in an isolated home. `PATH` excludes Node and package managers.
- Release archives are generated in a later work item with normalized paths, modes, ownership, timestamps, and ordering.
- Production manifests require exact versioned GitHub Release URLs, checksums, signature evidence, and provenance. Adapters cannot render from prototype metadata.
- macOS signing/notarization and Windows signing happen after injection. Release publication fails if signature verification is unavailable or incomplete.

## Acceptance before status changes to Accepted

- The exact prototype passes on every supported OS/architecture target.
- Required CLI commands pass with Node absent from `PATH`.
- Bundle analysis confirms there are no undeclared runtime filesystem dependencies.
- Optional modules degrade according to the documented capability profile.
- Production archive reproducibility and archive extraction safety are proven.
- macOS notarization, Authenticode, checksums, SBOMs, and provenance are verified against exact release artifacts.

## Related decisions

- [ADR 003: Privacy-First Architecture](./003-privacy-first-architecture.md)
- [ADR 005: BYOK AI Model](./005-byok-ai-model.md)

## References

- Node.js 22 single executable applications documentation
- esbuild JavaScript build API
- GuardScan multi-channel distribution and launch plan

## Review

Review after the host-native CI feasibility matrix completes.

**Next review date**: 2026-08-15
