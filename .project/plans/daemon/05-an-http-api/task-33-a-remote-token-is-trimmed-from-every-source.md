---
title: A --remote token is trimmed whichever of the three it came from
status: done
depends: [task-27-blank-values-are-refused-and-the-records-are-true.md]
layer: "server"
refs:
  - "[code://packages/server/src/main.ts#L78-L100](../../../../packages/server/src/main.ts#L78-L100) - `tokenFor`, which trims the chosen value once for all three sources"
  - "[code://packages/server/test/server-cli.test.ts#L364-L375](../../../../packages/server/test/server-cli.test.ts#L364-L375) - the blank-token cases"
  - "[code://packages/server/test/server-cli.test.ts#L385-L406](../../../../packages/server/test/server-cli.test.ts#L385-L406) - the token with space around it, from `--token` and from `AHPD_TOKEN`"
---

## Objective

`--token`, `--token-file` and `AHPD_TOKEN` give the same token for the same secret: space around it is removed from each, as it already is from a file.

## Files

- `UPDATE: packages/server/src/main.ts:78-100` - trim the chosen value once, whichever source it came from.
- `UPDATE: packages/server/test/server-cli.test.ts` - the case below.

## Steps

1. Trim after the source is chosen, and test the trimmed value for blank, so the three sources share one rule.
2. The comment above `tokenFor` says a token is trimmed from each source.

## Validation

- `server-cli.test.ts`: `--remote` against a daemon with token `abc`, given `--token ' abc '`, and separately `AHPD_TOKEN=' abc\n'`, is answered; today both send the spaces and are refused.
- The blank-token cases still pass.
- `node_modules/.bin/vitest run packages/server/test/server-cli.test.ts` green.

## Resume

Implemented 2026-09-27. `tokenFor` reads a token file without trimming it inline and trims the chosen value once after the source is chosen, so `--token`, `--token-file` and `AHPD_TOKEN` share the one rule and the blank test is made against the trimmed value.

Departure: the Validation's premise did not reproduce. `--token ' abc '` and `AHPD_TOKEN=' abc\n'` are answered against a daemon with token `abc` even without this change, because the HTTP layer's `Headers` strips the surrounding whitespace before the daemon reads the header. The new case in `server-cli.test.ts:385-406` was written first and passed on the unmodified source, so no end-to-end case can be watched fail; it stays as a behaviour lock. The source-level defect is real (`tokenFor` returned `' abc '` before and `'abc'` now), and the change is kept because the task's Steps say to trim after the source is chosen. The existing blank-token cases at `:364-375` still pass, and `node_modules/.bin/vitest run packages/server/test/server-cli.test.ts` is green with 48 cases.
