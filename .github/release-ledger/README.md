# Release ledger bootstrap

Use `active-versions.json` as the root file when creating the protected orphan
`release-ledger` branch. Release workflows append `events/vVERSION.jsonl` and
promotion decisions to that branch; application source never belongs there.

The branch is an append-only evidence store. Only the installed
`guardscan-release-bot` GitHub App may write it after bootstrap.
