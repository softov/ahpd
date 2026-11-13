---
title: The docs say a part is pinned
status: implemented
depends: [task-02-a-host-pulls-a-part-by-its-digest.md, task-03-the-release-carries-the-digests.md]
layer: "docs"
refs:
  - "[code://docs/plugins/COMPUTERS.md#L1000-L1015](../../../../docs/plugins/COMPUTERS.md#L1000-L1015) - *Parts*, where a host pulls a part at its tag"
  - "[code://DEVELOPER.md#L145-L150](../../../../DEVELOPER.md#L145-L150) - the release's parts job"
---

## Objective

The docs say that an installed host pulls each part by the digest its package carries, and that a checkout pulls by tag.

## Files

- `UPDATE: docs/plugins/COMPUTERS.md:1000-1015` - *Parts*: the digest pin, the digests file, and the warning of a checkout.
- `UPDATE: DEVELOPER.md:145-150` - the parts job writes the digests, and the npm stage waits for it.

## Steps

1. In *Parts* of `docs/plugins/COMPUTERS.md`, say that a host pulls each part by the digest in `images/digests.json`.
2. Say that a checkout has no digests file, pulls by tag and logs a warning.
3. In `DEVELOPER.md`, say that the parts job writes `digests.json` and that the release job stages after it.
4. Say that a part which fails stops the npm stage, and that a rerun of the failed job continues.

## Validation

- `pnpm build` and then `pnpm docs:build` pass.
- The two pages name `digests.json` and say what a checkout does.

## Resume
- Implemented on 2026-11-13. [implemented.md](implemented.md) holds what was built, what was verified and the departures.
