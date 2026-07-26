# Testing Tools Guide

GuardScan's `perf` and `mutation` commands integrate with optional external tools. These tools are not bundled with GuardScan.

## Performance

- `guardscan perf --load` and `guardscan perf --stress` require `k6`.
- `guardscan perf --web <url>` requires Lighthouse.
- Install k6 from <https://k6.io/docs/get-started/installation/>.
- Install Lighthouse with `npm install -g lighthouse`.

## Mutation Testing

- JavaScript and TypeScript mutation testing uses Stryker when available.
- Install Stryker with `npm install --save-dev @stryker-mutator/core`.

## Offline Behavior

These tools run locally, but the target application or audited URL may require network access. GuardScan passes URLs and generated script paths as process arguments rather than shell-interpolated strings.
