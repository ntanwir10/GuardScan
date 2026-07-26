# GuardScan channel catalog

This directory is the canonical bootstrap scaffold for
[`ntanwir10/homebrew-tap`](https://github.com/ntanwir10/homebrew-tap).
The public catalog repository contains both supported first-party package-manager
adapters:

- `Formula/guardscan.rb` for Homebrew
- `bucket/guardscan.json` for Scoop
- `channel-lock.json`, which binds both generated files to one immutable
  GuardScan release manifest and source commit

GuardScan release automation owns catalog contents. Do not edit generated
formulae, manifests, or the lock by hand. Catalog pull requests must reproduce
byte-for-byte from the exact GuardScan commit named in `channel-lock.json`.

The catalog is a generated projection, not a source mirror or a second release
authority. Its verification workflow is also sourced from this scaffold so that
catalog policy changes are reviewed with the release generator.
