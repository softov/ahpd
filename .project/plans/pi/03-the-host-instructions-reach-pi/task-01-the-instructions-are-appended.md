---
title: The instructions are appended
status: implemented
depends: []
layer: "agent-pi"
refs:
  - "[code://packages/agent-pi/src/backend.ts#L65-L96](../../../../packages/agent-pi/src/backend.ts#L65-L96) - `BackendOptions` and `openPi`"
  - "[code://packages/agent-pi/src/session.ts#L243-L248](../../../../packages/agent-pi/src/session.ts#L243-L248) - the options `opened` passes"
---

## Objective

`Start.instructions` reach pi's system prompt, after whatever pi appended on its own.

## Files

- `UPDATE: packages/agent-pi/src/backend.ts:65-96` - `BackendOptions.instructions?: string[]`; `openPi` passes `resourceLoaderOptions: { appendSystemPromptOverride: (base) => [...base, ...instructions] }` when there are any.
- `UPDATE: packages/agent-pi/src/session.ts:243-248` - pass `start.instructions` with the empty ones dropped.
- `UPDATE: test/agent-pi.test.ts` - the case below.

## Steps

1. Filter `start.instructions` to non-blank entries in `opened`.
2. In `openPi`, pass the override only when the list is not empty, so a session with none builds services exactly as today.
3. Join nothing here: pi joins its append list itself; check in `dist/core/system-prompt.js` that entries are separated, and join with a blank line as the sibling does only if they are not.

## Validation

- `test/agent-pi.test.ts`: a session started with `instructions: ['one', ' ', 'two']` hands the fake's `open` `['one', 'two']`.
- By hand, once: a real pi session in a directory with `.pi/APPEND_SYSTEM.md` keeps that text and adds the host's after it.
- `pnpm test`, `pnpm typecheck` green.

## Resume

Built.
`BackendOptions.instructions` reaches `createAgentSessionServices` through `resourceLoaderOptions.appendSystemPromptOverride`, which adds to what pi discovered rather than replacing it, so a project's or a user's `APPEND_SYSTEM.md` keeps its place.
pi joins the entries itself with a blank line in `dist/core/agent-session.js`, so nothing is joined here.
`session.ts` drops blank entries and passes the rest, and passes nothing when there are none.

- `test/agent-pi.test.ts` covers instructions reaching the fake's `open` with the blank entry dropped, and a session with none passing none.
- By hand, for Softov: a real pi session in a directory with `.pi/APPEND_SYSTEM.md` keeps that text and adds the host's after it.
- `pnpm test` 102 files, 1366 tests; `pnpm typecheck` and `pnpm boundary` green.
