---
title: A bump proposes only what readParts accepts
status: done
depends: []
layer: "scripts"
refs:
  - "[code://scripts/parts-bump.mjs#L30-L39](../../../../scripts/parts-bump.mjs#L30-L39) - `EXACT`, `URL_SAFE` and `SHA256`, mirrored from `parts.ts`"
  - "[code://scripts/parts-bump.mjs#L74-L103](../../../../scripts/parts-bump.mjs#L74-L103) - `newerThan`, which no longer takes a prerelease"
  - "[code://scripts/parts-bump.mjs#L105-L138](../../../../scripts/parts-bump.mjs#L105-L138) - `bumpOf`, where each value is checked before it is proposed"
  - "[code://packages/computer/src/parts.ts#L65-L71](../../../../packages/computer/src/parts.ts#L65-L71) - the patterns, where they are written down"
  - "[code://packages/computer/src/parts.ts#L163-L184](../../../../packages/computer/src/parts.ts#L163-L184) - `readParts`"
  - "[code://packages/computer/test/parts-bump.test.ts](../../../../packages/computer/test/parts-bump.test.ts) - the cases"
---

## Objective

`parts-bump.mjs` skips a prerelease, and before it writes it checks each moved part as `readParts` would; a part that fails is skipped by name and the file it writes always reads.

## Files

- `UPDATE: scripts/parts-bump.mjs:30-39` - `EXACT`, `URL_SAFE` and `SHA256`, mirrored beside the platforms.
- `UPDATE: scripts/parts-bump.mjs:74-138` - `newerThan` refuses a prerelease, and `bumpOf` checks the version, each url and each sum before it proposes a move.
- `CREATE: packages/computer/test/parts-bump.test.ts` - the cases below, over a copy of the script and a registry file given with `--registry`.
- `CREATE: .project/problems/a-parts-file-read-from-elsewhere-reports-the-shipped-one.md` - met while writing the cases.

## Steps

1. Failing cases first, with `--registry <file> --dry-run`: an entry at `1.54.0-rc.1` is skipped; an entry whose archive url is `http://...` is skipped by name. Both were proposed before.
2. The patterns are mirrored, not imported: the bump runs from `parts-bump.yml`, which installs nothing and builds nothing, so there is no built module to import and no `readParts` to run on the result. This is the departure this task records.

## Validation

- All three cases were seen failing on `e1c4ccc` and pass after.
- `pnpm exec vitest run packages/computer/test/parts-bump.test.ts`.

## Resume

Implemented. `newerThan` returns false for any `next` that carries a prerelease tag, before it looks at the numbers, and its doc comment says why: a prerelease is a version somebody is still working on, and moving to one makes every host that took the bump build an agent that may still change under the same version. The comment also lost its old claim that a non-numeric segment is guarded by the string compare, which was not true - `latest` compares as newer than any version, which is what case three shows; `EXACT` is what refuses it now.

`bumpOf` checks every value before it is proposed, in both branches: the version with `EXACT` after `newerThan` has said it is a move, each archive url with `URL_SAFE` before it is fetched or written, and each sum with `SHA256` - the sum the registry ships, and the one `shaOf` downloads for a registry that ships none (always 64 hex, so the check only ever refuses the registry's). A part that fails any of them is skipped by name with the value in the message, so the rest of the file still lands.

The patterns are a second copy rather than an import, which step 2 allowed only if the script cannot import the built package: `parts-bump.yml` runs `node scripts/parts-bump.mjs` with no install and no build, so `@ahpd/computer` is not there to import and its `dist` does not exist. The copy carries a comment naming `packages/computer/src/parts.ts` as where the patterns are written down, and the cases are what hold the two together - they write a file and read it back with the real `readParts`.

The cases are `packages/computer/test/parts-bump.test.ts`, four of them, run over a copy of the script in a directory of its own beside a parts file of its own. That is what makes a case that writes safe: the script's paths are relative to itself, so a copy is a whole checkout to it and the shipped `versions.json` is never the file that lands. The registry is a file, so nothing asks the network or npm.

Failing first, on the script as it was: the prerelease run said `bumped goose 1.53.0 -> 1.54.0-rc.1`, the `http://` run said `bumped goose 1.53.0 -> 1.54.0`, and the `latest` run wrote a file whose goose was at `latest` - `readParts` refuses it with `entry 0 has the version latest, which is a range rather than one version`. The last one was checked against the pre-fix script directly, by running `git show HEAD:scripts/parts-bump.mjs` over the same fixture, because the case writes rather than printing and its failure had to be seen in the file, not only in the output.

Departures: the second copy of the patterns (step 2's own fallback, since the workflow installs nothing); the third case writes rather than running `--dry-run`, because a case that only prints cannot show that the file reads; and the fourth case is not in the task, added so that a run which does move is held to the same read-back - without it every case could pass with the script writing nothing at all.

Gates: `npx tsc -b` clean, `npm run boundary` clean, `npx vitest run packages/computer` 20 files and 335 tests passed.
