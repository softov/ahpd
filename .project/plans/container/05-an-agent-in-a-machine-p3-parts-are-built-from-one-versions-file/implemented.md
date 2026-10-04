---
title: Parts are built from one versions file, and the joined image from the same file - implemented
date: 2026-10-04
refs:
  - git://4b16d32
  - "[code://packages/computer/src/parts.ts](../../../../packages/computer/src/parts.ts) - the parts, built on first use, and the joined image"
  - "[code://packages/computer/images/versions.json](../../../../packages/computer/images/versions.json) - every agent CLI pinned in one file"
---

Every agent CLI is pinned in `packages/computer/images/versions.json`, each part is an image built from it on first use, and the joined image is the parts together.

## What was built

- [`code://packages/computer/images/versions.json`](../../../../packages/computer/images/versions.json) - the versions file, with a url and sha256 per platform for an archive part.
- [`code://packages/computer/src/parts.ts`](../../../../packages/computer/src/parts.ts) - a part image per kind, built once when first asked for, one build for two sessions asking at once, and the joined image; from a checkout the ahpd part's tag covers the packed tarballs.
- `.github/workflows/parts-bump.yml` and `scripts/parts-bump.mjs` - the bump job.
- `docs/COMPUTER.md` - the parts, the versions file and building ahead.

## Verified

- `computer-parts.test.ts` and `computer-parts-build.test.ts` against the fake Docker, and every part kind built against real Docker in the build.
- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` passed at merge.

## Departures from the plan

- Added in review: a part's url must be a plain https url and its sha256 64 hex digits, since both land in a shell line in the Dockerfile.

## Left for later

- The joined image `ahpd-agents:<hash>` was not built on a real Docker, for lack of disk; its line in the checklist is open.
- The tasks stay `implemented` until Softov reviews them.
