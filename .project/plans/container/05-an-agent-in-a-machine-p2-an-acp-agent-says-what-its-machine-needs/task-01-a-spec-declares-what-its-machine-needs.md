---
title: A spec declares what its machine needs
status: todo
depends: []
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/plugin.ts#L61-L86](../../../../packages/agent-acp/src/plugin.ts#L61-L86) - where the option is read"
  - "[code://packages/agent-cofold/src/agent.ts#L542-L560](../../../../packages/agent-cofold/src/agent.ts#L542-L560) - a `machine()` to mirror"
  - "[code://packages/sdk/src/types/machine.ts](../../../../packages/sdk/src/types/machine.ts) - the need kinds"
---

## Objective

`{ machine: { env: { CODEX_HOME: "/ahpd/codex" }, secrets: ["CODEX_API_KEY"], copy: [{ source: "~/.codex/config.toml", target: "/ahpd/codex/config.toml" }] } }` makes `machine()` answer one env need per `env` key, one env need per secret with the daemon's own value as default, and one copy need per entry.

## Files

- `UPDATE: packages/agent-acp/src/types.ts` - `AcpMachine` and `AcpOptions.machine`.
- `UPDATE: packages/agent-acp/src/plugin.ts` - read `machine`, refusing a malformed one at load with the field named.
- `UPDATE: packages/agent-acp/src/agent.ts` - `machine()` from the options; absent when the spec has none.
- `CREATE: packages/agent-acp/test/acp-machine.test.ts` - the cases below.

## Steps

1. Type `AcpMachine = { env?: Record<string,string>; secrets?: string[]; copy?: { source: string; target: string }[] }`.
2. Need names are `<provider>.<variable>` for env and secrets and `<provider>.copy.<n>` for copies, so a profile can fill one by name.
3. A secret is `required: false`: a machine made without it is refused only by the agent, in its own words.

## Validation

- `acp-machine.test.ts`: the three kinds come out with their names; a spec with no `machine` has no `machine()`; a secret's default follows `process.env`.
- `pnpm --filter @ahpd/agent-acp test` green.

## Resume
