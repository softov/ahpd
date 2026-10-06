---
title: A bump proposes only what readParts accepts
status: todo
depends: []
layer: "scripts"
refs:
  - "[code://scripts/parts-bump.mjs#L60-L80](../../../../scripts/parts-bump.mjs#L60-L80) - `newerThan`, which takes a prerelease of a higher version"
  - "[code://scripts/parts-bump.mjs#L140-L166](../../../../scripts/parts-bump.mjs#L140-L166) - the values written as the feed gave them"
  - "[code://packages/computer/src/parts.ts#L65-L68](../../../../packages/computer/src/parts.ts#L65-L68) - `EXACT` and `URL_SAFE`"
  - "[code://packages/computer/src/parts.ts#L163-L182](../../../../packages/computer/src/parts.ts#L163-L182) - `readParts`"
---

## Objective

`parts-bump.mjs` skips a prerelease, and before it writes it checks each moved part as `readParts` would; a part that fails is skipped by name and the file it writes always reads.

## Files

- `UPDATE: scripts/parts-bump.mjs:60-80` - a prerelease is never newer; today `newerThan('1.3.0-rc.1', '1.2.0')` is true, so a feed's release candidate is proposed.
- `UPDATE: scripts/parts-bump.mjs:140-166` - check the version with `EXACT`, each url with `URL_SAFE` and each sum as 64 hex digits, and read the written file back with `readParts`; today a feed's `latest`, an `http:` url or a short sum is written, and the next start refuses the whole file.
- `CREATE: scripts/parts-bump.test.mjs` or a case under `packages/computer/test/` - the cases below, against a registry file given with `--registry`.

## Steps

1. Failing cases first, with `--registry <file> --dry-run`: an entry at `9.0.0-rc.1` is skipped; an entry whose archive url is `http://...` is skipped by name. Both are proposed today.
2. Take `EXACT`, `URL_SAFE` and the sum check from where `readParts` has them rather than a second copy, if the script can import the built package; otherwise run `readParts` on the result before writing.

## Validation

- Both cases fail on `e1c4ccc` and pass after.
- The test command the case lives under.

## Resume
