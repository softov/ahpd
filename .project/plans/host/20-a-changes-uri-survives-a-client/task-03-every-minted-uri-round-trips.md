---
title: Every URI ahpd mints opens after a client normalises it
status: todo
depends: [task-02-ahp-edit-reads-by-its-parts.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L71-L73](../../../../packages/sdk/src/host.ts#L71-L73) - `ahp-root://` and `ahp-automations://`"
  - "[code://packages/sdk/src/host.ts#L277](../../../../packages/sdk/src/host.ts#L277) - `startsWith('ahp-root')`, which takes `ahp-root:` as well as `ahp-root://`"
  - "[code://packages/sdk/src/host.ts#L1360](../../../../packages/sdk/src/host.ts#L1360) - `isAutomations`, which takes anything on the `ahp-automations:` scheme"
  - file:///github/externals/vscode - `src/vs/base/common/uri.ts`, the rules a normalising client applies; the clone is sparse, so read it with `git -C /github/externals/vscode show HEAD:src/vs/base/common/uri.ts`, and its imports `charCode.ts`, `marshallingIds.ts`, `path.ts`, `platform.ts` and `process.ts` the same way
---

## Objective

Each scheme ahpd mints is either shown to survive VS Code's `URI` round trip or fixed to, and a case pins each one.

## Files

- `UPDATE: packages/sdk/test/changes-uris.test.ts` - a normaliser written to VS Code's `uri.ts` rules, and a case per minted scheme.
- `UPDATE: packages/sdk/src/host.ts` - only if a scheme there does not survive.

## Steps

1. List every scheme ahpd mints: `rg "[a-z]+-[a-z]+:" packages/*/src`, and every place a URI is built from a session or a path.
2. Write the normaliser in the test from VS Code's `uri.ts`, read with `git -C /github/externals/vscode show HEAD:src/vs/base/common/uri.ts` because the clone is sparse and has no working copy of it: an empty authority drops `//`, the authority is lowercased with its escapes decoded, the path is decoded and re-encoded with VS Code's own encoder, which keeps `/` literal (so a `%2F` inside a segment becomes a `/`), `#` and `?` split a fragment and a query.
   The normaliser is checked against the outputs listed in the plan's Searches performed, so it does not re-encode what VS Code leaves decoded.
3. For each scheme, a case sends the normalised form to whatever resolves it and expects the same answer as the minted form.
   A scheme that fails is fixed the way the decision says, or, if the fix is not obvious, stop and ask.

## Validation

- `changes-uris.test.ts`: a case per minted scheme, each through the normaliser.
- `ahp-root://` comes back from the normaliser as `ahp-root:`, and `ahp-automations://` as `ahp-automations:`, because their authority is empty; both still resolve.
  [`code://packages/sdk/src/host.ts#L277`](../../../../packages/sdk/src/host.ts#L277) takes `ahp-root:` through `startsWith('ahp-root')`, and [`code://packages/sdk/src/host.ts#L1360`](../../../../packages/sdk/src/host.ts#L1360) takes `ahp-automations:` through `isAutomations`, so the case pins that rather than expecting a fix.
- `pnpm typecheck` and `pnpm test` green.
- By hand, for Softov: in VS Code, a cofold session's modified file opens its diff, and a turn's change opens both sides.

## Resume
