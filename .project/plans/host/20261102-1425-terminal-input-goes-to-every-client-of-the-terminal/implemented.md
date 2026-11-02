---
title: Terminal input goes to every client of the terminal - implemented
date: 2026-11-02
refs:
  - git://56068e6f - the change
  - "[code://packages/sdk/src/host/actions.ts](../../../../packages/sdk/src/host/actions.ts)"
---

Input the terminal takes goes to every client subscribed to the terminal, at the next `serverSeq`, and is held for replay.
Input the terminal cannot take is refused to the same clients, and held for replay.

## What was built

- [`code://packages/sdk/src/host/actions.ts`](../../../../packages/sdk/src/host/actions.ts) - taken input goes through `dispatch`, and its refusal through `no` with the default audience.
- [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - `echoTo` is gone; `emit` and `refuse` say where `serverSeq` moves and which refusal stays with its sender.
- [`code://packages/sdk/src/host/context.ts`](../../../../packages/sdk/src/host/context.ts) - `echoTo` is gone from the context.
- [`code://packages/sdk/test/host-terminals.test.ts`](../../../../packages/sdk/test/host-terminals.test.ts) - input and its refusal reach the other client of the terminal, under the same `serverSeq`.
- [`code://docs/sdk/AHP.md`](../../../../docs/sdk/AHP.md) - the `terminal/input` row, the refusal paragraph, and the paragraph on accepted actions.

## Verified

- On `89ebe4d5`'s `host.ts`, `actions.ts` and `context.ts` both input cases fail: the other client received no input, and no refusal.
- With `56068e6f` the host-terminals, host-output-terminals, users-gate-dispatch, users-gate-names, conformance, host-snapshots and presence files pass, 170 tests.
- `pnpm run typecheck` and `pnpm run boundary` report no errors.

## Departures from the plan

- None.

## Left for later

- Left as it is: input to a shell that has exited is refused.
- VS Code's host emits it and writes it only to a running terminal ([agentHostTerminalManager.ts#L522-L527](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/agentHostTerminalManager.ts#L522-L527)).
- No VS Code window acts on input, taken or refused, so a VS Code client cannot tell.
