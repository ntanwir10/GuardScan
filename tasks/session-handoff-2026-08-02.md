# GuardScan 1.1.0 Release Session Handoff

Checkpoint date: 2026-08-02

Branch: `release/1.1.0`

Starting commit before this work: `d94a07a`

## Purpose

This checkpoint preserves the in-progress implementation of the zero-touch
GuardScan `1.1.0-rc.1` to `1.1.0` release train. It is intentionally a WIP
checkpoint: do not publish, enable release automation, or create release tags
from this commit until the remaining security fixes and full verification gate
are complete.

## Completed in this session

- Added the detailed execution plan and working checklist in `tasks/plan.md`
  and `tasks/todo.md`.
- Tightened changelog and release-train channel contracts.
- Added real deterministic RAG end-to-end acceptance tests.
- Added a public `guardscan capabilities --json` contract and standalone
  reduced-capability evidence.
- Hardened standalone artifact validation and release-manifest capability
  metadata.
- Added cross-platform package-manager, TestPyPI, pip, pipx, native artifact,
  and exact-version canary coverage.
- Added deterministic WinGet tooling pinning and stronger WinGet/Chocolatey
  submission evidence.
- Added functional acceptance documentation and corrected public command
  examples.
- Marked ADR 006 accepted while retaining signing/notarization launch gates.
- Added a credential-health workflow and its contract tests.
- Began executable rollback and forward-fix orchestration.

## Verification completed before the final WIP edits

- `release-workflows.test.ts`: 14/14 passing after the canary and publisher
  hardening changes.
- Standalone focused tests: 33/33 passing.
- Release-contract suite: 86/86 passing before the final credential-health and
  rollback edits.
- Documentation command contracts: 7/7 passing.
- Typecheck passed before the final workflow/recovery edits.

These results are historical evidence only. The entire gate must be rerun from
this checkpoint because later edits were not covered.

## Critical blockers found by the final audit

1. Privileged workflow shell injection: `workflow_dispatch` inputs such as
   `release_pr`, `version`, and `known_good` are interpolated directly into
   shell in `release-train.yml`; the manual version path in
   `release-canary.yml` has the same pattern. Move inputs through `env`, validate
   them before privileged steps, and quote variables.
2. Stable publication is not resumable after the release PR has merged. Add an
   idempotent resume path bound to the persisted promotion decision, merge SHA,
   and stable tag.
3. Rollback/recovery can deadlock the train. Finish channel recovery,
   active-version removal, forward-fix creation, and protected-ledger evidence.
4. The release ledger currently substitutes one manifest digest for provider
   identities that actually have distinct npm tarball and PyPI wheel digests.
   Persist and validate per-provider evidence.
5. WinGet/Chocolatey moderation can remain pending forever after rejection or
   closure. Model rejected, corrected, and resubmitted states explicitly.
6. Promotion verifies the release PR head but not the soaked base/tree. Record
   the base SHA and require the stable merge tree to equal the approved RC tree,
   or force a new RC when `main` changes during the soak.

## Work interrupted at checkpoint

- The rollback/forward-fix workflow implementation was interrupted while being
  edited. Review `release-train.yml`, release event/state schemas,
  `events.js`, `reconcile.js`, `index.js`, and `recovery-source.js` as one unit.
- The credential-health workflow implementation and its five focused tests were
  reported green, but the worker's final audit was interrupted.
- A read-only whole-release audit was interrupted after reporting the six
  blockers above.
- Four placeholder assertions remain in
  `cli/__tests__/integration/ai-providers-enhanced.test.ts` and should be
  replaced with deterministic decorator-composition tests.
- `cli/src/core/cost-guard.ts` contains a `resetDailyBudget()` placeholder; its
  product and command behavior still need review.

## Required next sequence

1. Read this handoff, `tasks/plan.md`, and `tasks/todo.md`; inspect `git status`
   and the checkpoint diff.
2. Fix all six audit blockers before running or enabling privileged workflows.
3. Review and complete the interrupted rollback/forward-fix implementation.
4. Finish the placeholder-functionality review.
5. Run from `cli/`:
   - `npm run typecheck`
   - `npm run build`
   - `npm run test:release`
   - `npm test -- --coverage --runInBand`
   - `npm run lint:ratchet`
   - `git diff --check`
   - `npm audit --omit=dev --audit-level=high`
   - `npm run test:package`
   - `npm run test:package-manager`
   - `npm pack --dry-run` using a temporary npm cache if needed
6. Split the verified WIP checkpoint into reviewable implementation commits if
   desired; never publish from a dirty or unverified source tree.
7. Reauthenticate GitHub CLI. At checkpoint time `gh auth status` reported an
   invalid token for `ntanwir10`.
8. Bootstrap inert release automation on the default branch with automation
   disabled, then complete the provider-owned onboarding steps.
9. Only after all gates and onboarding are verified, create and soak
   `v1.1.0-rc.1`; promote stable from the exact approved tree after 24 hours.

## External boundaries still outstanding

- GitHub App installation and protected environments.
- npm and PyPI trusted publishers.
- Apple Developer signing and notarization identity.
- Azure Artifact Signing OIDC resources.
- Chocolatey publisher credentials and moderation.
- WinGet credential/CLA and upstream acceptance.
- First-party Homebrew/Scoop shared-catalog publication and hosted native
  validation.

The release is not published, the 24-hour RC soak has not started, and no
public channel should be considered verified at this checkpoint.
