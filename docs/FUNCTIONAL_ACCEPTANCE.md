# GuardScan functional acceptance

This document is the launch evidence map for GuardScan `1.1.0`. It separates
implemented behavior from behavior proven in the exact artifact that users will
install. A command appearing in help, compiling successfully, or passing a mock
does not by itself make that command production-verified.

The release ledger is authoritative for a version. Evidence is valid only when
it names the source commit, tag, artifact digest, platform, runtime, test, and
time. Every current-source change invalidates older exact-artifact evidence until
the required jobs rerun against the new commit.

The current launch posture is **closed**: `RELEASE_AUTOMATION_ENABLED` remains
`false` until onboarding is complete. No `1.1.0-rc.1` soak or `1.1.0` public
verification is implied by this matrix.

## Evidence classes

Each command has one primary acceptance class. The class describes the strongest
required proof shape, while the evidence and gate columns state what is and is
not proved today.

- **Offline exact-artifact proven**: a test invokes the packed npm tarball or SEA
  executable in an isolated home with network/telemetry disabled. For SEA, Node
  and package managers are absent from `PATH`.
- **Component/integration proven**: real GuardScan code is exercised from source
  or compiled output, but the behavior is not yet invoked through every public
  distribution artifact.
- **External-tool dependent**: GuardScan orchestration and safety boundaries can
  be tested, but the result also depends on a project-owned tool such as a test
  runner, linter, Lighthouse, k6, or mutation framework.
- **Mocked BYOK boundary**: prompt construction, routing, redaction, parsing, and
  failure behavior are tested with deterministic fake providers. This does not
  prove real credentials, quotas, endpoint compatibility, or model behavior.
- **Live provider rehearsal**: bounded, account-scoped evidence from a real
  provider is required. Secrets and response content must not enter artifacts,
  logs, manifests, telemetry, or the release ledger.

## Command acceptance matrix

| Command | Primary evidence class | Current strongest repository evidence | Install/runtime variants in scope | Current launch gate |
| --- | --- | --- | --- | --- |
| `guardscan init` | Offline exact-artifact proven | Packed npm smoke invokes `init` and verifies provider `none`, offline mode, telemetry disabled, and no client ID; compiled command and config-lifecycle tests cover updates. | npm global on Node 22/24; npm consumers inherit the same tarball. | Rerun the exact candidate tarball on Linux, macOS, and Windows and record its digest-bound result. |
| `guardscan run` | Component/integration proven | Command tests execute the static path, the opt-in AI path, exclusion handling, reports, and safe failure boundaries. | Node package and embedded-runtime channels; AI behavior varies by configured provider. | Add packed/SEA command invocation; separately complete live BYOK and local-provider rehearsals for `--with-ai`. |
| `guardscan scan` | Offline exact-artifact proven | Packed npm, npm/pnpm/Yarn/Bun consumer smoke, compiled end-to-end tests, and SEA smoke exercise offline static scanning and validate `guardscan.scan.v1`. | npm global; pnpm, Yarn Classic/Modern, Bun; all five SEA/wheel targets. | Produce current-tag artifacts, rerun every native/public canary, and bind reports to the release manifest. |
| `guardscan security` | Component/integration proven | Compiled end-to-end tests cover JSON, SARIF, finding-policy exits, partial inventory, and static-safe execution; Docker fixtures exercise installed source builds. | Node package and embedded-runtime channels. | Invoke the exact candidate tarball and each native artifact; retain malicious-input and policy evidence. |
| `guardscan test` | External-tool dependent | Test-runner and process-policy tests cover framework detection, argv-safe execution, timeouts, and failure reporting. | Requires compatible project test/lint commands in the host environment; standalone does not bundle project tools. | Rehearse supported project matrices on each OS and prove missing/hostile tools fail safely. |
| `guardscan sbom` | Offline exact-artifact proven | Packed npm and SEA smoke generate and parse SPDX 2.3 and CycloneDX 1.7; command tests cover deterministic local inventory. | npm/package-manager consumers and all five SEA/wheel targets. | Rerun exact candidate artifacts on all hosts and verify output schemas and manifest-bound artifact SBOMs. |
| `guardscan perf` | External-tool dependent | Load-test components exercise collection and reporting, but host tools and target services remain outside GuardScan's artifact. | Node or embedded runtime plus project-selected performance tools. | Add native command rehearsals with pinned k6/Lighthouse fixtures and explicit unavailable-tool behavior. |
| `guardscan mutation` | External-tool dependent | Mutation components test framework selection, argv-safe process execution, failure handling, and injection resistance. | Node or embedded runtime plus a supported mutation framework. | Run deterministic Stryker, mutmut, PIT, and custom-command fixtures where supported; document unsupported platform results. |
| `guardscan rules` | Component/integration proven | The compiled command/help contract exists; rule evaluation is exercised indirectly by scan-engine tests. Direct command execution is not yet an acceptance proof. | All runtime channels use the same compiled rule implementation. | Add direct list/enable/disable/custom-rule lifecycle tests, then invoke the exact npm and native artifacts. |
| `guardscan config` | Component/integration proven | Direct command and isolated config-lifecycle tests cover show/update, privacy defaults, provider changes, and secret-safe output. | All channels; state is isolated under `GUARDSCAN_HOME`. | Add exact-artifact lifecycle coverage on POSIX and Windows, including corrupt/unreadable configuration. |
| `guardscan status` | Component/integration proven | Compiled command surface and configuration/provider components are covered; direct installed-command state reporting is not yet proved. | All channels, with Node/SEA capability differences. | Add deterministic configured/unconfigured/degraded fixtures and exact npm/SEA invocation. |
| `guardscan reset` | Component/integration proven | Configuration reset behavior is covered through lifecycle components; installed CLI reset and cancellation are not yet separately proved. | All channels; mutates only the selected GuardScan home. | Add isolated confirmation/force tests on POSIX and Windows and prove unrelated files are retained. |
| `guardscan commit` | Mocked BYOK boundary | Provider factories, routing, cost guards, retries, and output parsers have deterministic tests; the command has no live-provider release evidence. | Node and embedded runtime with a user-selected BYOK or local provider. | Add direct command fixtures, then run bounded live rehearsals without committing or logging generated content. |
| `guardscan explain` | Mocked BYOK boundary | Code-explainer tests exercise prompt construction, provider output, file/range handling, and failure behavior with fakes. | Node and embedded runtime with BYOK/local provider access. | Invoke packaged artifacts and complete one bounded rehearsal per supported provider family. |
| `guardscan test-gen` | Mocked BYOK boundary | Compiled help and shared provider boundaries are covered; generated-test correctness is not currently command-level acceptance evidence. | Node and embedded runtime with BYOK/local provider access. | Add deterministic file/language/output fixtures, sandbox generated tests, and complete bounded provider rehearsals. |
| `guardscan docs` | Mocked BYOK boundary | Compiled help and shared provider boundaries are covered; direct documentation-generation behavior lacks a dedicated acceptance fixture. | Node and embedded runtime with BYOK/local provider access. | Add deterministic type/output/path tests, exact-artifact invocation, and bounded provider rehearsals. |
| `guardscan chat` | Live provider rehearsal | Deterministic RAG integration uses fake embeddings/provider responses and proves local retrieval boundaries; it does not prove a real provider session. | Node and embedded runtime; cloud BYOK and local Ollama/LM Studio are separate variants. | Rehearse one bounded conversation per supported provider family, including offline/local operation and signal-safe cancellation. |
| `guardscan refactor` | Mocked BYOK boundary | Refactoring feature tests cover parsing, suggestions, file selection, and malformed provider output using fakes. | Node and embedded runtime with BYOK/local provider access. | Invoke exact artifacts, prove no unapproved file writes, and complete bounded provider rehearsals. |
| `guardscan threat-model` | Mocked BYOK boundary | Compiled help and shared provider/security components are covered; no dedicated command acceptance fixture proves the final threat model. | Node and embedded runtime with BYOK/local provider access. | Add deterministic input/output/redaction fixtures and bounded provider rehearsals. |
| `guardscan migrate` | Mocked BYOK boundary | Compiled help and shared provider/process boundaries are covered; migration correctness is not directly proved. | Node and embedded runtime with BYOK/local provider access and project tooling. | Add dry-run, diff, rollback, and unsupported-language fixtures before any live-provider rehearsal. |
| `guardscan review` | Mocked BYOK boundary | Compiled option syntax and shared scan/provider components are tested; direct review-output acceptance remains incomplete. | Node and embedded runtime with BYOK/local provider access. | Add deterministic file/diff/report fixtures, exact-artifact invocation, and bounded provider rehearsals. |
| `guardscan models` | Component/integration proven | Model-registry, provider-factory, validation, redirect, and token-counter tests cover known model metadata without requiring a live completion. | All runtime channels; availability still depends on the configured provider. | Add exact-artifact list/validation tests and a non-secret live availability probe for each enabled provider family. |
| `guardscan routing` | Component/integration proven | Model-router and decorator tests cover deterministic selection, fallbacks, rate limits, retries, circuits, and observability. | Node and embedded runtime with one or more configured providers. | Add direct command fixtures and live failover rehearsal without exposing prompts or credentials. |
| `guardscan budget` | Component/integration proven | Direct command and cost-guard tests cover limits, usage display, reset, and provider/model accounting. | All channels; local state is scoped to the selected GuardScan home. | Add exact npm/SEA lifecycle tests, clock-boundary coverage, and concurrent-write evidence. |
| `guardscan metrics` | Component/integration proven | Metrics-collector tests cover collection and serialization; the installed command output is not yet an exact-artifact proof. | All channels; local-only unless a user explicitly exports data. | Add exact-artifact status/export fixtures and prove sensitive source/prompt content is excluded. |
| `guardscan cache` | Component/integration proven | Direct cache tests and compiled end-to-end execution cover clear/select/all behavior and prove the telemetry spool is retained. | All channels; paths differ on POSIX and Windows. | Invoke the exact candidate npm/SEA artifacts on all hosts and exercise corrupt, locked, and concurrent entries. |
| `guardscan telemetry` | Offline exact-artifact proven | Packed npm, package-manager consumer, compiled end-to-end, and SEA smoke prove disabled consent/status; unit and contract tests cover queue/delivery boundaries. | All channels; optional synchronization targets the configured service only after consent. | Reprove disabled status for exact artifacts and separately rehearse opt-in HTTPS delivery to a user-authorized endpoint. |
| `guardscan capabilities` | Offline exact-artifact proven | Unit/compiled JSON contracts and the SEA exact-executable smoke contract verify the explicit reduced profile. The current-source five-host SEA run is still required. | Node package reports full/available runtime features; SEA and wheel report `coreScan`/`sbom` true and chart/token extras false. | Pass the current SHA on all five SEA hosts and verify wheels forward byte-identical output. |
| `guardscan vuln` | Component/integration proven | Direct command, OSV client, dependency inventory, CISA KEV, and compiled end-to-end tests cover exact versions, offline snapshot behavior, fail-closed exit 2, and aliases `cve`/`audit`. | All channels; online OSV and offline signed-snapshot modes are distinct. | Invoke exact artifacts; verify signed snapshot refresh/expiry and run a bounded live OSV canary with recorded response metadata only. |

## Major workflow acceptance

| Workflow | Required evidence | Current repository evidence | Launch gate |
| --- | --- | --- | --- |
| Privacy-first initialization | Exact npm artifact on each supported Node/OS pair | Package smoke asserts provider `none`, offline mode, telemetry disabled, and no generated client ID. | Candidate tarball must pass the three-OS, Node 22/24 matrix. |
| Offline scan and policy reporting | Exact npm consumers and all five SEA targets | Package-manager, compiled CLI, and standalone smoke contracts validate static execution, schema, and policy. | Current-tag signed artifacts and public-install canaries must pass. |
| Project-code execution | Component plus hostile-tool integration | Process runner, execution policy, test runner, mutation, and injection tests use argv arrays and constrained policies. | Native fixtures must prove opt-in execution, timeouts, cancellation, and safe failure. |
| Vulnerability intelligence | Component, signed offline snapshot, and bounded live OSV | Inventory/OSV/KEV tests and offline fail-closed CLI behavior exist. | Publish/verify the snapshot chain and run a public OSV canary without persisting dependency names beyond evidence policy. |
| AI-assisted commands | Mocked boundary plus bounded live BYOK/local-provider rehearsal | Factories, routers, decorators, cost controls, explanation/refactor, and RAG tests are deterministic. | OpenAI, Anthropic, Gemini, OpenRouter, Ollama, and LM Studio must each be explicitly supported, skipped with reason, or removed from the release claim. |
| Telemetry | Exact disabled path plus opt-in delivery boundary | Exact artifacts prove disabled status; queue, redaction, endpoint, and collector contracts are tested. | Run an authorized live opt-in delivery rehearsal and prove opt-out leaves no queued/sent event. |
| npm ecosystem | Exact tested tarball, then public-registry install | Three-OS Node 22/24 npm smoke and Linux npm/pnpm/Yarn/Bun consumer contracts are encoded in CI. | Publish RC with OIDC/provenance, redownload it, compare digest, and run public `next` canaries for 24 hours. |
| Native GitHub release | Signed/notarized exact executable and immutable redownload | Five-host unsigned SEA build/smoke, deterministic archive, manifest, checksum, SBOM, signature, and attestation contracts exist. | Provider signing must succeed, every draft asset must redownload identically, and the release must become immutable. |
| PyPI/pip/pipx | Wheel containing the exact signed SEA executable | Wheel construction, platform tags, launcher integrity, and release-manifest binding have contract tests. | TestPyPI then PyPI OIDC publication and pip/pipx install/invoke/uninstall must pass on all supported hosts. |
| Shared Homebrew/Scoop catalog | Generated projection bound to the immutable release manifest | Empty bootstrap and atomic formula/manifest/lock generation and validation are implemented. | The first stable catalog PR must pass native install/upgrade/invoke/uninstall and GuardScan must verify the merged lock callback or reconciliation result. |
| WinGet | Generated portable manifest plus upstream state | Rendering, validation commands, and append-only submitted/accepted/verified states are implemented. | Local manifest install must pass, then upstream PR acceptance and public-catalog install must be observed. |
| Chocolatey | Deterministic `.nupkg` plus moderated public state | Renderer, local validation command, and append-only moderation states are implemented. | Local-feed lifecycle must pass, then validation, verification, VirusTotal, moderation, and public install must complete. |
| RC soak and promotion | Public canaries, unchanged PR head, no incident, 24-hour decision | Promotion policy and reconciliation contracts are tested. | At least 24 hourly green samples per required channel and a complete 24-hour wall-clock window are mandatory. |
| Rollback/forward fix | Append-only recovery evidence | Known-good restoration and first-release withdrawal model supersession, exact catalog correction/removal, provider-owned yanking/deprecation, and recovery incidents without overwriting immutable artifacts. | Rehearse both a partial-publication failure and the no-predecessor first-release path before stable; require a separately reviewed patch when no verified baseline exists. |
| Homebrew Core | Separately authorized submission and public-Core canary | A renderer/validator exists, but Core is not selected by the current release train. | A reviewed enablement change, Core submission/acceptance, and `brew install guardscan` public canary are required. It never blocks `1.1.0`. |

## Install and runtime variants

| Variant | Runtime contract | Current acceptance target | Current launch gate |
| --- | --- | --- | --- |
| Source checkout / `npm link` | Developer-only Node runtime; not a public artifact | Unit, integration, compiled CLI, lint, typecheck, and release contracts | Cannot substitute for packed/public artifact evidence. |
| npm global | Exact tarball; Node 22 or newer | Linux, macOS, Windows on Node `22.23.1` and `24.18.0` | OIDC/provenance publish, digest redownload, and public RC/stable lifecycle. |
| pnpm global/dlx | Same npm tarball and Node requirement | Pinned pnpm `10.34.0` package-consumer smoke | Public registry global/dlx install, invoke, and uninstall. |
| Yarn Classic global / Yarn Modern dlx | Same npm tarball and Node requirement | Yarn `1.22.22` and `4.9.2` package-consumer smoke | Public registry lifecycle for both generations. |
| Bun global/bunx | Same npm tarball; GuardScan still requires Node 22 | Bun `1.3.14` package-consumer smoke | Public registry global/bunx lifecycle with Node present. |
| SEA archives | Embedded pinned Node runtime | Linux glibc x64/arm64, macOS x64/arm64, Windows x64 | Current-SHA signing/notarization, attestation, immutable release, and public redownload. |
| PyPI wheels | Exact signed SEA plus standard-library launcher | `manylinux_2_28_x86_64`, `manylinux_2_28_aarch64`, `macosx_11_0_x86_64`, `macosx_11_0_arm64`, `win_amd64` | TestPyPI/PyPI OIDC and pip/pipx native lifecycles. |
| First-party Homebrew tap | Signed SEA selected by host CPU/OS | Four macOS/Linux targets from the shared catalog | Stable catalog merge and public tap lifecycle. |
| Scoop, WinGet, Chocolatey | Signed Windows x64 SEA | One manifest/package per catalog, all bound to the same release digest | Public catalog acceptance and clean Windows lifecycle. |
| Homebrew Core | Source build with Homebrew `node` dependency | Not selected | Separate reviewed enablement and public-Core verification. |

## Release decision rule

A command is launch-accepted only when its required evidence is present for the
exact selected version and every install/runtime variant that claims it. A
command-specific partial result does not block unrelated development, but it
does block any public claim that the command is verified on that variant.

Stable release completion additionally requires every selected distribution
channel to materialize as `verified` in the append-only ledger. Moderated
channels may remain `submitted`, but the release is then still incomplete.
Homebrew Core is not selected and therefore is neither a current install promise
nor a `1.1.0` completion gate.
