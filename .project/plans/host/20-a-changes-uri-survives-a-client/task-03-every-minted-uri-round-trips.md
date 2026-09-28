---
title: Every URI ahpd mints opens after a client normalises it
status: implemented
depends: [task-02-ahp-edit-reads-by-its-parts.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L71-L73](../../../../packages/sdk/src/host.ts#L71-L73) - `ahp-root://` and `ahp-automations://`"
  - "[code://packages/sdk/src/host.ts#L277](../../../../packages/sdk/src/host.ts#L277) - `startsWith('ahp-root')`, which takes `ahp-root:` as well as `ahp-root://`"
  - "[code://packages/sdk/src/host.ts#L1360](../../../../packages/sdk/src/host.ts#L1360) - `isAutomations`, which takes anything on the `ahp-automations:` scheme"
  - file:///github/externals/vscode - `src/vs/base/common/uri.ts`, the rules a normalising client applies; the clone is sparse, so read it with `git -C /github/externals/vscode show HEAD:src/vs/base/common/uri.ts`, and its imports `charCode.ts`, `marshallingIds.ts`, `path.ts`, `platform.ts` and `process.ts` the same way
  - file:///github/externals/vscode - `src/vs/platform/agentHost/common/state/sessionState.ts` lines 760-777, `isAhpRootChannel`, which takes `ahp-root://` and `ahp-root:` as one channel; read it with `git -C /github/externals/vscode show HEAD:src/vs/platform/agentHost/common/state/sessionState.ts`
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

Built. `packages/sdk/src/host.ts` has one helper, `isRootChannel`, which takes `ahp-root://` and anything on the `ahp-root:` scheme, as VS Code's `isAhpRootChannel` does, and is exported from the module beside `ROOT`.
Every place the host compared a channel against the root uses it: `dispatchNeeds`, the subscribe grant in `capabilityFor`, `seenBy`, `snapshotOf`, `meantBy` (so `subscribe`, `reconnect` and `unsubscribe` alias `ahp-root:` to the root as they alias the catalogue), the `root/configChanged` branch of a client dispatch, and the check that refuses a root command named on another channel.
`initialize` records the same alias for an initial subscription to `ahp-root:` and answers its snapshot under that spelling, because it does not resolve through `meantBy`.

- `changes-uris.test.ts` checks that the normaliser prints `ahp-root://` as `ahp-root:` and `ahp-automations://` as `ahp-automations:`.
- For both root spellings, one case introduces a client subscribed to it, subscribes, calls `listSessions` and `listAutomationTriggerDefinitions`, dispatches `root/configChanged` and sees its echo under the same spelling, then unsubscribes.
- `ahp-automations:` is subscribed and named on `fetchAutomationRuns`; it already resolved through `isAutomations`.
- Every other URI the host mints prints unchanged: `ahp-session:/`, `ahp-chat:/`, `ahp-chat://default/<base64url>`, `ahp-chat://subagent/<base64url>/<call id>`, `ahp-terminal:/`, `ahp-automation:/`, `ahp-automation-run:/`, `ahp-resource-watch:/`, the three `ahp-otlp://` channels and a session's changeset channels.
- Failing first: `initialize` with `initialSubscriptions: ['ahp-root:']` answered no snapshot ("expected [] to deeply equal [ 'ahp-root:' ]"); before the case was written, `subscribe` answered "No agent for session ahp-root:" and `listSessions` answered "listSessions is answered on ahp-root://, not on ahp-root:".
- Gates: `pnpm typecheck` green, `pnpm boundary` green, `pnpm test` 105 files and 1449 tests green on the first full run.
- The by-hand check in VS Code is Softov's and has not been done.
