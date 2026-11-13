---
title: A piece takes its host mark
status: todo
depends: []
layer: "activepieces"
refs:
  - "[code://packages/activepieces/src/logos.ts#L136-L149](../../../../packages/activepieces/src/logos.ts#L136-L149) - `logoOf`, where the table is read first"
  - "[code://packages/activepieces/src/mapping.ts#L38-L43](../../../../packages/activepieces/src/mapping.ts#L38-L43) - `nameOf`, the adapter name the table is keyed by"
  - "[code://packages/activepieces/test/logos.test.ts](../../../../packages/activepieces/test/logos.test.ts) - the logo cases"
  - "[code://packages/server/src/icons.ts#L114-L124](../../../../packages/server/src/icons.ts#L114-L124) - the names a mark may have, and `markOf`"
---

## Objective

`logoOf` answers the host mark of a piece in `MARKS`, with no read of the cache or the CDN.
The host ships a Postgres mark, and a case fails when the table names a mark the host does not ship.

## Files

- `UPDATE: packages/activepieces/src/logos.ts:136-149` - add `MARKS`, and answer the mark before the cache.
- `UPDATE: packages/activepieces/test/logos.test.ts` - the cases for a marked piece, and for each mark file.
- `CREATE: packages/server/icons/postgres.svg` - the PostgreSQL mark of Simple Icons, in `#4169E1`.
- `UPDATE: docs/plugins/activepieces.md:15-21` - the six pieces show a host mark.
- `UPDATE: .project/pending/plugin-58-icon-curation.md` - a Postgres row, and the five marks stay.

## Steps

1. Export a `MARKS` table from `logos.ts`, from adapter name to mark name, for the six pieces of *Answers*.
2. In the comment on `MARKS`, say that a mark wins because these CDN logos are over 32 KB.
3. In `logoOf`, answer `{ icon: { src: "mark:<name>" } }` for a piece in `MARKS`, before the configuration folder check.
4. Copy the SVG from https://cdn.simpleicons.org/postgresql into `packages/server/icons/postgres.svg`.
5. Check that the file has no script, no event attribute and is under 32 KB.
6. Add a case: a piece in `MARKS`, with a cached logo and a fetcher that throws, answers its mark.
7. Add a case: each mark in `MARKS` has a file in `packages/server/icons/`.
8. Keep the case that a piece with no mark fetches its CDN logo, with a piece not in `MARKS`.
9. Say in *Each piece shows its logo* of `docs/plugins/activepieces.md` that the six pieces show a host mark.
10. Add the Postgres row to the curation file, and replace its line on `1ea68fcb8` with Softov's answer.

## Validation

- `packages/activepieces/test/logos.test.ts`: a marked piece answers its mark and makes no read.
- The same file: each mark in `MARKS` is a file in `packages/server/icons/`.
- `TMPDIR=/home/softov/tmp/ahpd-test flock /home/softov/tmp/ahpd-test/vitest.lock npx vitest run packages/activepieces` passes.
- The same command for `packages/server` passes.
- By hand, on the test daemon of `.project/pending/test-daemon.sh`: the adapters of the six pieces carry a `data:image/svg+xml` icon.

## Resume
