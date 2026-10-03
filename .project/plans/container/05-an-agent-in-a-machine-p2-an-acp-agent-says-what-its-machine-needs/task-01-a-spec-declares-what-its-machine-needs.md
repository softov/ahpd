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
  - "[code://packages/sdk/src/types/machine.ts#L19-L38](../../../../packages/sdk/src/types/machine.ts#L19-L38) - `Need.default`, a string today"
  - "[code://packages/computer/src/secrets.ts#L53-L78](../../../../packages/computer/src/secrets.ts#L53-L78) - `revealed`, which reads a `$secret` need value for the machine's owner at create"
  - "[code://.project/plans/claude/16-a-preset-that-fails-skips-only-itself/plan.md](../../claude/16-a-preset-that-fails-skips-only-itself/plan.md) - a preset that fails is skipped with one line and the others register"
---

## Objective

A preset written `{ machine: { env: { CODEX_HOME: "/ahpd/codex", CODEX_API_KEY: { fromEnv: "CODEX_API_KEY" } }, copy: [{ source: "~/.codex/config.toml", target: "/ahpd/codex/config.toml" }] } }` makes that variant's `machine()` answer one env need per `env` key, its value settled at load, and one copy need per `copy` entry.

## Files

- `UPDATE: packages/agent-acp/src/types.ts` - `AcpMachine` and the preset's `machine`, wherever the ACP presets plan puts a preset's options.
- `UPDATE: packages/agent-acp/src/plugin.ts` - read `machine` per preset; a malformed one, or a missing `fromEnv` variable, skips that preset with one `host.log` line naming `options.presets.<key>.machine` and the field, and every other preset registers, as claude/16 does.
- `UPDATE: packages/agent-acp/src/plugin.ts` - a preset's `machine.env` value is declared `secretAtUse: true` in the schema, so the loader hands a `{ "$secret" }` through as written.
- `UPDATE: packages/sdk/src/types/machine.ts:27` - `Need.default` may be a `SecretRef` for an env need.
- `UPDATE: packages/computer/src/secrets.ts:53-78` and `packages/computer/src/plugin.ts` - `revealed` also reads a `$secret` default of a declared env need, for the machine's owner and team, as it reads a need value.
- `UPDATE: packages/agent-acp/src/agent.ts` - `machine()` from the variant's options; absent when the preset has none.
- `CREATE: packages/agent-acp/test/agent-acp-machine.test.ts` - the cases below.

## Steps

1. Type `AcpMachine = { env?: Record<string, string | { fromEnv: string }>; copy?: { source: string; target: string }[] }`.
2. A `{ fromEnv }` value is read from the daemon's environment at load; a variable the daemon does not have skips that preset with one line naming `options.presets.<key>.machine.env.<NAME>` and the variable, and the other presets register, as claude/16 does for the same value.
3. A `{ "$secret" }` value is not read at load: it is `secretAtUse`, the variant's env need carries it as its default, and the computer plugin reads it with `revealed` when the machine is made, as it does a computer need. A secret that cannot be read fails that machine's create only, with the need and the name in the sentence.
4. Need names are `<provider>.<variable>` for env and `<provider>.copy.<n>` for copies, so a profile can fill one by name; the provider is the preset's key.
5. An env need from `machine.env` is `required: false`: a machine made without a value is refused only by the agent, in its own words.

## Validation

- `agent-acp-machine.test.ts`: both kinds come out with their names; a preset with no `machine` has no `machine()`; a `fromEnv` value follows `process.env`; two presets answer their own needs.
- The same file: with the variable unset, a preset whose `machine.env` reads it with `fromEnv` is not registered and one line names it, and a second preset in the same load registers.
- The same file: a `{ "$secret": "host:codex" }` value comes out as the env need's default as written.
- `packages/computer/test/computer-needs.test.ts`: an agent env need whose default is a `$secret` is read for the machine's owner at create; one that cannot be read refuses that create naming the need.
- A host spawn of a preset with `machine.env` carries none of it.
- `pnpm --filter @ahpd/agent-acp test` green.

## Resume
