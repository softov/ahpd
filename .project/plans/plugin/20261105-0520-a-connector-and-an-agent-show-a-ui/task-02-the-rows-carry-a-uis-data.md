---
title: The rows carry a ui's data
status: implemented
depends: [task-01-a-ui-capability-with-bindings.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/connectors.ts#L444](../../../../packages/sdk/src/types/connectors.ts#L444) - `Adapter.open(connector)`, which gains the handle"
  - "[code://packages/sdk/src/types/agents.ts#L151](../../../../packages/sdk/src/types/agents.ts#L151) - `Engine.open(record)`, which gains the same handle"
  - "[code://packages/sdk/src/connectors/channel.ts#L335-L392](../../../../packages/sdk/src/connectors/channel.ts#L335-L392) - the connector health map and the connector row, the pattern the data copies"
  - "[code://packages/sdk/src/agents/channel.ts#L233-L309](../../../../packages/sdk/src/agents/channel.ts#L233-L309) - the agent health map and the agent row, the same pattern"
  - "[code://packages/sdk/src/plugins/view.ts#L22-L28](../../../../packages/sdk/src/plugins/view.ts#L22-L28) - `MAX_VIEW_BYTES`, the limit the data takes"
---

## Objective

`open` hands an adapter and an engine a handle that sends and clears the data of that one connector or agent.
The channel keeps the data in memory by id, and the connector row and the agent row carry it as `ui`.

## Files

- `UPDATE: packages/sdk/src/types/plugin.ts` - add `UiHandle`, `{ show(data): void; clear(): void }`, beside `UiSchema`.
- `UPDATE: packages/sdk/src/types/connectors.ts:444` - `open(connector, ui: UiHandle)`.
- `UPDATE: packages/sdk/src/types/agents.ts:151` - `open(record, ui: UiHandle)`.
- `UPDATE: packages/sdk/src/connectors/channel.ts:335-392` - keep the data by connector id beside `healths`; the row carries `ui`; close, remove and unload take it away.
- `UPDATE: packages/sdk/src/agents/channel.ts:233-309` - the same for an agent, by agent id.
- `UPDATE: packages/sdk/test/connectors-channel.test.ts` - the connector cases.
- `UPDATE: packages/sdk/test/agents-channel.test.ts` - the agent cases.

## Steps

1. Add `UiHandle` to `types/plugin.ts`, and write that it names one record only.
2. Pass a `UiHandle` as the second argument of `Adapter.open` and of `Engine.open`.
3. In the connectors channel, build one handle for each opened connector, bound to its id.
4. In `show`, refuse data that is not a JSON object or is more than `MAX_VIEW_BYTES`.
5. Log each refusal through `onProblem`.
6. In `show`, keep the data by id and send the changed row to subscribers.
7. In `clear`, take the data away and send the changed row.
8. Put the data on the connector row as `ui` when the channel holds some.
9. Take the data away when the connector closes, when a person removes it, or when its plugin unloads.
10. Ignore a `show` or a `clear` from a handle whose connector has closed.
11. Do steps 3 to 10 in the agents channel, for an agent, by agent id.
12. Keep the two channels' code the same shape, so a reader of one reads the other.

## Validation

- `connectors-channel.test.ts`: `show` puts `ui` on the row, and a subscriber gets it.
- `connectors-channel.test.ts`: a second `show` replaces the data, and `clear` takes it away.
- `connectors-channel.test.ts`: close and remove take the data away.
- `connectors-channel.test.ts`: a handle used after close changes nothing.
- `connectors-channel.test.ts`: `show` refuses data over the limit and data that is not an object, and the row stays.
- `agents-channel.test.ts`: the same cases for an agent.
- `pnpm --filter @ahpd/sdk test` and `pnpm typecheck` pass, with every existing `open` still compiling.

## Resume

Done. `UiHandle` is in `types/plugin.ts` beside `UiSchema`, and both `Adapter.open` and `Engine.open` take one as an optional second argument, so every plugin that opens a record without a ui still compiles. Each channel makes one handle per opening before it calls the plugin, keeps the data in memory by id in a map beside `healths`, and the connector row and the agent row carry it as `ui`. `show` keeps a copy of the data and refreshes the subscribers, and `clear` takes it away. Data that is not a JSON object or is more than 64 KiB of JSON is refused through `onProblem`, and the row keeps what it held. A handle whose opening closed, was removed, was replaced by a put, or whose plugin unloaded writes nothing, because the entry it holds is no longer the map's. The connectors channel drops data whose adapter is no longer served in its `refresh`, and the agents channel drops it in `sync` and in its `refresh`, so an unload takes it away. The two channels' `uiProblem`, `uiFor` and the `Shown` entry have the same shape.

Verified: `pnpm exec tsc -p tsconfig.json --noEmit` printed nothing, `pnpm boundary` reported every package with none undeclared, and `pnpm exec vitest run packages/sdk/` passed 226 files with 4290 tests and 4 skipped. `pnpm -s schema` ran first, because the wire cases read `tools/ahp.strict.schema.json`.

Found: `open`'s handle is optional (`ui?: UiHandle`) rather than required. The task writes `ui: UiHandle`, but its Validation says every existing `open` still compiles, and `packages/server/src/agents/handed.ts` and the tests of agent-acp, agent-claude and tunnel-devtunnel call `open` with a record alone; a required handle would break them outside this task's Files.

Left: nothing.
