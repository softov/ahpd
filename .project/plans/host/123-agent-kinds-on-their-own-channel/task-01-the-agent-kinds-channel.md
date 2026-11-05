---
title: The agent kinds channel
status: done
depends: []
layer: "sdk, server, docs"
refs:
  - "[code://packages/sdk/src/connectors/adapters.ts](../../../../packages/sdk/src/connectors/adapters.ts) - the channel to copy"
  - "[code://packages/server/src/commands/run.ts#L754](../../../../packages/server/src/commands/run.ts#L754) - where the adapters channel is made and listed"
---

## Objective

`x-ahpd-agent-kinds` lists one row for each agent kind the loaded plugins register, and a load or unload sends the new list.

## Files

- `CREATE: packages/sdk/src/agents/kinds.ts` - `agentKindsChannel`, built on `recordsChannel` like `adaptersChannel`.
- `UPDATE: packages/sdk/src/index.ts:110-111` - export `agentKindsChannel` and its types next to the adapters channel.
- `UPDATE: packages/sdk/src/agents/channel.ts:8` - the doc comment points at `agents/kinds.ts`.
- `UPDATE: packages/server/src/commands/run.ts:754` - make the kinds channel over `() => agentKinds`, list it in the served channels, and refresh it where `adapterLists.refresh()` runs.
- `CREATE: packages/sdk/test/agent-kinds-channel.test.ts` - the channel tests.
- `UPDATE: docs/plugins/PLUGINS.md:1292` - a `x-ahpd-agent-kinds` section before `x-ahpd-agents`.
- `UPDATE: docs/sdk/HOST.md:173` - a grant row for the kinds channel.

## Steps

1. Copy `packages/sdk/src/connectors/adapters.ts` to `packages/sdk/src/agents/kinds.ts` with the scheme `x-ahpd-agent-kinds`.
2. Read the kinds through `kinds(): Record<string, ServedAgentKind>`, at each call.
3. Send `name`, `title`, `description`, `schema` and `plugin` on every row.
4. Send `icons`, `templates`, `hostOnly` and `keyVariables` only when the kind has a non-empty value.
5. Never send `open`.
6. Gate the channel with `agent:list`, and describe it as "Agent kinds".
7. Make the channel in run.ts next to `adapterLists`, and add its channel to the served list.
8. Refresh it at each place that refreshes `adapterLists`.
9. Write the tests, then the two docs entries.

## Validation

- `packages/sdk/test/agent-kinds-channel.test.ts` tests two kinds listed by name, and a kind with templates and icons.
- It also tests a kind with neither, no `open` on a row, and a refusal without `agent:list`.
- `pnpm -r typecheck` and `pnpm test` pass.
- A subscribe to `x-ahpd-agent-kinds://` on a test daemon with agent-claude and agent-cofold lists both kinds.

## Resume

`agentKindsChannel` is in `packages/sdk/src/agents/kinds.ts` and `run.ts` serves it after the adapters channel.
`pnpm typecheck` passes, and the four channel tests pass.
The full `pnpm test` fails eight docker and agent-acp tests on timeouts; the same files time out on main.
A daemon from this tree lists `claude` and `cofold` on `x-ahpd-agent-kinds://`.
