---
title: A preset's secrets and environment references are read by the sdk
status: done
depends: []
layer: "sdk, agent-acp, agent-claude"
refs:
  - "[code://packages/sdk/src/vault.ts#L55-L68](../../../../packages/sdk/src/vault.ts#L55-L68) - `secretRef`, the sibling and the one-key rule"
  - "[code://packages/agent-acp/src/plugin.ts#L96-L130](../../../../packages/agent-acp/src/plugin.ts#L96-L130) - `secretsOf` and `fromEnvOf`"
  - "[code://packages/agent-claude/src/plugin.ts#L115-L138](../../../../packages/agent-claude/src/plugin.ts#L115-L138) - `secretsOf`"
  - "[code://packages/agent-claude/src/options.ts#L243-L247](../../../../packages/agent-claude/src/options.ts#L243-L247) - `fromEnvOf`, which allows other keys"
  - "[code://packages/agent-claude/src/claude.ts#L46-L51](../../../../packages/agent-claude/src/claude.ts#L46-L51) - `baseUrlOf`, reading `fromEnv` inline"
  - "[code://packages/agent-claude/test/agent-claude-presets.test.ts](../../../../packages/agent-claude/test/agent-claude-presets.test.ts) - claude's preset cases"
  - "[code://packages/agent-acp/test/agent-acp-presets.test.ts](../../../../packages/agent-acp/test/agent-acp-presets.test.ts) - acp's preset cases"
---

## Objective

`readSecrets(host, env, by)` and `fromEnvRef(value)` are exported from `@ahpd/sdk` beside `secretRef`, and acp and claude read a preset's `env` and `{ fromEnv }` values through them.

## Files

- `UPDATE: packages/sdk/src/vault.ts` - `fromEnvRef` after `secretRef`, and `readSecrets`, acp's `secretsOf` answering `Record<string, unknown>` (claude's type; acp narrows at its call).
- `UPDATE: packages/sdk/src/index.ts:59` - exported.
- `UPDATE: packages/sdk/test/vault.test.ts` - the helper's cases.
- `UPDATE: packages/agent-acp/src/plugin.ts:96-130` - `secretsOf` and `fromEnvOf` go.
- `UPDATE: packages/agent-claude/src/plugin.ts:115-138`, `options.ts:243-247`, `claude.ts:46-51` - `secretsOf` and `fromEnvOf` go; `baseUrlOf` reads through `fromEnvRef`.
- `UPDATE: packages/agent-claude/test/agent-claude-presets.test.ts` - one case.

## Steps

1. `fromEnvRef`: an object whose only key is `fromEnv`, holding a non-empty string, as the plan's second table records.
2. `readSecrets` keeps the refusal `<by>.<name> names <ref>: <reason>` word for word.

## Validation

- `vault.test.ts`, a new helper's cases: `fromEnvRef({ fromEnv: 'X' })` is `X`; `{ fromEnv: '' }`, `{ fromEnv: 'X', other: 1 }` and `'X'` are `undefined`; `readSecrets` reads a `$secret`, passes a plain value through and words a failed read.
- Written first and seen failing (today claude reads it as a reference): a claude preset whose `env` holds `{ fromEnv: 'X', other: 1 }` is refused for that preset, as acp refuses it.
- acp's preset tests stay green unchanged.
- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test packages/sdk packages/agent-acp packages/agent-claude`.

## Resume

- **Implemented** 2026-10-10 on `build/agents/167a4a60`.
- `packages/sdk/src/vault.ts` holds `fromEnvRef` after `secretRef` and `readSecrets` beside `readSecret`.
- Both are exported from `@ahpd/sdk`.
- `fromEnvRef` takes `secretRef`'s rule: an object whose only key is `fromEnv`, holding a non-empty string.
- `{ fromEnv: '' }`, `{ fromEnv: 'X', other: 1 }` and a bare `'X'` all answer nothing.
- `readSecrets(host, env, by)` answers `Record<string, unknown>` and reads each `$secret` through the host.
- Anything that is not a reference passes through whole.
- The refusal `<by>.<name> names <ref>: <reason>` is kept word for word.
- acp's `secretsOf` and `fromEnvOf` are gone.
- Its preset `env` comes from `readSecrets`, narrowed to `Record<string, string>` at that call.
- The schema has already said those values are strings.
- `machineOf` reads its `{ fromEnv }` through `fromEnvRef`.
- claude's `secretsOf` and its local `fromEnvOf` in `options.ts` are gone.
- `heldTo`, `variablesOf` and `baseUrlOf` all read through `fromEnvRef`.
- claude now refuses the shape acp refuses: a variant `env` value of `{ fromEnv: 'X', other: 1 }`.
- That preset fails with `options.presets.<id>.env.<NAME> is not a string`.
- The case was written first and seen failing.
- `packages/sdk/test/vault.test.ts` has 4 new cases over the two readers.
- acp's preset and machine tests are unchanged.
- One `fromEnv` read is left as it was: `agent-claude/src/models.ts` reads a model entry's `key.fromEnv`.
- That one allows other keys beside it.
- The plan's refs count three reads and do not name this fourth one.
- Its shape is a model's fetch key rather than an `env` value.
- Gates: `pnpm install`, `node tools/schema.mjs`, `pnpm build`, `pnpm typecheck` and `pnpm boundary` all pass.
- The full suite passes 4869 of 4870 tests over 272 files.
- The one failure is `changes-refresh.test.ts`, the load flake, which passes 29 of 29 alone.
