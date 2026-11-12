---
title: A record lists the operations it offers now - implemented
date: 2026-11-11
---

Each tunnel, client, agent and connector row carries `operations`, the ids it offers now, worked out each time the row is sent.
`x-ahpd/invokeOperation` refuses an id the target does not list.
Agents and connectors serve their own operations lists, beside tunnels and clients.
A tunnel kind gives `offered(record)` for its own operations.

## What was built

- `packages/sdk/src/types/kinds.ts` - `KindOperation.offered(record)`, with the idea file named in its comment, and `OperationScope` gains `agent` and `connector`.
- `packages/sdk/src/kinds/operations.ts` - the optional `OperationChannel.offers`, asked before the input is checked, and the refusal of an id the target record does not list.
- `packages/sdk/src/tunnels/channel.ts` - each row's `operations` from its state and its kind's `when`, and `offers` over the same.
- `packages/sdk/src/clients/channel.ts` - each row carries `operations: ['drop']`.
- `packages/tunnel-devtunnel/src/kind.ts` - Start, Stop and Restart carry `when`; Anonymous access is on every record.
- `packages/sdk/src/agents/channel.ts` - Enable, Pause, Disable, Check and Remove as an `OperationChannel`, each row's ids by mode, and the fixed commands sharing `removeOne` and `checkOne`.
- `packages/sdk/src/connectors/channel.ts` - Enable, Disable and Remove as an `OperationChannel`, each row's ids by state, `offers`, and `removeOne` shared with the fixed command.
- `packages/server/src/commands/run.ts` - the agents and connectors channels join `channels` in `invokeOperation`.
- Tests: `packages/sdk/test/tunnels-channel.test.ts`, `packages/sdk/test/agents-channel.test.ts`, `packages/sdk/test/connectors-channel.test.ts`, `packages/tunnel-devtunnel/test/tunnel-devtunnel-kind.test.ts`.
- Docs: `docs/plugins/PLUGINS.md` and `docs/updates/v0_15.md`.

## Verified

- `pnpm exec tsc -p tsconfig.json --noEmit` at the root passes, after task-02 and again after task-03.
- In review, `pnpm typecheck` passes. `npx vitest run packages/sdk` passes 4760 tests (5 skipped) in 237 files, `packages/tunnel-devtunnel` 58 tests in 5 files, and `packages/server` 1874 tests (3 skipped) in 94 files.
- The docs page read against tasks 01 to 03.

## Departures from the plan

- In review, the kind's host-side function was renamed from `when` to `offered`.
  The name `when` stays free for the condition a client would evaluate, which the idea file keeps.
- Sign in stays `x-ahpd/connectors/signin`, with its own form, and no record lists it, so the connectors list holds three operations. Softov settled this on 2026-11-11, and the plan's Answers table has the row.
- The connectors channel already returned `run` for adapter actions, so its operations contract sits beside it as `operations` rather than replacing it.
- A tunnel kind's `offered` gets the row as a client reads it, with its settings and its state.
  So devtunnel's Start, Stop and Restart read `status`, not the stored record alone.
- `OperationScope` gained `agent` and `connector`, and clients, like agents and connectors, leave `begin` and `settle` empty, so their list carries no running status.
- The per-package typecheck for `packages/tunnel-devtunnel` resolves `@ahpd/sdk` through its unbuilt `dist`, so the root checker, which maps the source, is the one used.

## Left for later

- ahpw and ahpc draw from the operations list in their own repositories, and call the fixed agents and connectors commands until they move.
- A client that evaluates `when` itself is the later idea, [an operation says when it applies](../../../ideas/an-operation-says-when-it-applies.md).
