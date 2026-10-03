---
title: A preset declares what its machine needs
status: todo
depends: []
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/plugin.ts#L35-L61](../../../../packages/agent-acp/src/plugin.ts#L35-L61) - the schema and `apply`, which the ACP presets plan turns into one agent per preset"
  - "[code://packages/agent-cofold/src/agent.ts#L561-L572](../../../../packages/agent-cofold/src/agent.ts#L561-L572) - a `machine()` to mirror"
  - "[code://packages/sdk/src/types/machine.ts#L60-L75](../../../../packages/sdk/src/types/machine.ts#L60-L75) - the env and copy need kinds"
  - "[code://packages/agent-claude/src/options.ts#L225-L229](../../../../packages/agent-claude/src/options.ts#L225-L229) - `fromEnvOf`, the `{ fromEnv }` reader to mirror"
---

## Objective

A preset written `{ machine: { env: { CODEX_HOME: "/ahpd/codex", CODEX_API_KEY: { fromEnv: "CODEX_API_KEY" } }, copy: [{ source: "~/.codex/config.toml", target: "/ahpd/codex/config.toml" }] } }` makes that variant's `machine()` answer one env need per `env` key, its value settled at load, and one copy need per `copy` entry.

## Files

- `UPDATE: packages/agent-acp/src/types.ts` - `AcpMachine` and the preset's `machine`, wherever the ACP presets plan puts a preset's options.
- `UPDATE: packages/agent-acp/src/plugin.ts` - read `machine` per preset, refusing a malformed one at load with the preset and the field named.
- `UPDATE: packages/agent-acp/src/agent.ts` - `machine()` from the variant's options; absent when the preset has none.
- `CREATE: packages/agent-acp/test/agent-acp-machine.test.ts` - the cases below.

## Steps

1. Type `AcpMachine = { env?: Record<string, string | { fromEnv: string }>; copy?: { source: string; target: string }[] }`.
2. A `{ fromEnv }` value is read from the daemon's environment at load; a variable the daemon does not have fails the load, naming the preset and the variable, as claude/12 does for the same value.
3. A `{ "$secret" }` value is not read here: the vault resolves it before `apply`, and until the vault lands it is refused as an unknown shape.
4. Need names are `<provider>.<variable>` for env and `<provider>.copy.<n>` for copies, so a profile can fill one by name; the provider is the preset's key.
5. An env need from `machine.env` is `required: false`: a machine made without a value is refused only by the agent, in its own words.

## Validation

- `agent-acp-machine.test.ts`: both kinds come out with their names; a preset with no `machine` has no `machine()`; a `fromEnv` value follows `process.env`, and a missing one fails the load; two presets answer their own needs.
- A host spawn of a preset with `machine.env` carries none of it.
- `pnpm --filter @ahpd/agent-acp test` green.

## Resume
