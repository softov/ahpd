---
title: Black marks get a dark file, and GitHub gets a mark
status: done
depends: [task-03-a-piece-shows-its-mark.md]
layer: "server, activepieces"
refs:
  - "[code://packages/server/icons/resend.svg](../../../../packages/server/icons/resend.svg) - the Resend mark, in black"
  - "[code://packages/activepieces/src/logos.ts](../../../../packages/activepieces/src/logos.ts) - `MARKS`, the table from piece to mark"
  - https://cdn.simpleicons.org/github - the GitHub mark, under CC0 1.0
---

## Objective

The Resend and GitHub pieces show a mark that reads on a dark background.

## Files

- `CREATE: packages/server/icons/resend-dark.svg` - the Resend mark in `#E6EDF3`.
- `CREATE: packages/server/icons/github.svg` - the GitHub mark from Simple Icons, in `#181717`.
- `CREATE: packages/server/icons/github-dark.svg` - the GitHub mark in `#E6EDF3`.
- `UPDATE: packages/activepieces/src/logos.ts` - map `ap-github` to `github`.
- `UPDATE: packages/server/test/plugin-icons.test.ts` - a case for the Resend and GitHub dark files.
- `UPDATE: packages/activepieces/test/logos.test.ts` - a case for the GitHub piece's mark.
- `UPDATE: docs/plugins/PLUGINS.md` - add `github` to the list of marks.
- `UPDATE: .project/pending/plugin-58-icon-curation.md` - the Resend dark file and a GitHub row.

## Steps

1. Copy the Resend mark into `resend-dark.svg`, with the fill `#E6EDF3`.
2. Copy the GitHub mark from Simple Icons into `github.svg` and `github-dark.svg`.
3. Add `ap-github` to `MARKS`.
4. Add the test cases, the docs line and the curation rows.

## Validation

- The new loader and logo cases pass.
- `pnpm -s typecheck && pnpm -s build && pnpm -s boundary && pnpm -s test` passes.
- By hand: the Resend and GitHub connectors show a light mark in ahpw's dark theme.

## Resume

- **Done so far:** all steps.
- **Next action:** Softov reviews the PR and curates the two rows.
- **Files:** the Files list.
- **Open questions:** none.
- **Departures:** none.
- **Watch out for:** none.
