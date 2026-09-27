---
title: A scheduled job proposes a bump
status: todo
depends: [task-01-the-versions-file.md]
layer: "ci"
refs:
  - "[code://.github/workflows/ci.yml](../../../../.github/workflows/ci.yml) - the workflow style"
  - https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json - the feed
---

## Objective

A weekly workflow compares `versions.json` with the registry and npm, and opens one pull request with every newer version and each archive's new sha256.

## Files

- `CREATE: scripts/parts-bump.mjs` - reads both, writes the file, prints what moved and what was skipped.
- `CREATE: .github/workflows/parts-bump.yml` - weekly and by hand; opens the pull request.

## Steps

1. A registry entry is matched by id; an npm part not in the registry is checked with `npm view <package> version`.
2. An archive's sha256 is computed from the downloaded file.
3. Nothing moved: no pull request.

## Validation

- `node scripts/parts-bump.mjs --dry-run` against a saved registry file prints the expected moves.

## Resume
