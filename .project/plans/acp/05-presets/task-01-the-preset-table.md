---
title: One load, a presets map, and the shipped table
status: done
depends: []
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/plugin.ts#L35-L87](../../../../packages/agent-acp/src/plugin.ts#L35-L87) - `optionsSchema`, `optionsOf`, `apply`"
  - "[code://packages/agent-claude/src/plugin.ts#L89-L158](../../../../packages/agent-claude/src/plugin.ts#L89-L158) - `variantsOf`, `bagOf`, `named`, `optionsOf`, `apply`: the shape to mirror"
  - "[code://packages/agent-acp/package.json](../../../../packages/agent-acp/package.json) - `ahpd.options`, which marks `command` required"
  - "[code://packages/agent-acp/test/agent-acp-plugin.test.ts#L166-L237](../../../../packages/agent-acp/test/agent-acp-plugin.test.ts#L166-L237) - the one-spec cases to rewrite"
  - "[code://packages/computer/src/plugin.ts#L57-L61](../../../../packages/computer/src/plugin.ts#L57-L61) - `needValue`, the `secretAtUse` pattern"
  - npm://@agentclientprotocol/codex-acp - `codex-acp`
  - npm://@google/gemini-cli - `gemini --acp`
  - npm://@github/copilot - `copilot --acp`, `COPILOT_AUTO_UPDATE`
  - npm://opencode-ai - `opencode acp`, `OPENCODE_DISABLE_AUTOUPDATE`
  - npm://@kilocode/cli - `kilo acp`
  - npm://pi-acp - `pi-acp`
  - npm://@qwen-code/qwen-code - `qwen --acp`
  - npm://@deepseek-ai/dsh - `dsh --profile acp`
  - npm://@sourcegraph/amp - the Amp CLI `amp-acp` drives
---

## Objective

One load of `@ahpd/agent-acp` registers one agent per key of `presets`.
A key that names a row below, or whose `base` names one, takes that row with the preset's own fields over it; any other key is a spec of its own.
A preset that cannot be resolved is skipped with one log line, and the rest register.

| Preset | Name | Command | Env | Sign-in |
| --- | --- | --- | --- | --- |
| codex | Codex | `codex-acp` | - | `api-key` when `CODEX_API_KEY` or `OPENAI_API_KEY` is set |
| gemini | Gemini | `gemini --acp` | - | - |
| copilot | Copilot | `copilot --acp` | `COPILOT_AUTO_UPDATE=false` | - |
| opencode | OpenCode | `opencode acp` | `OPENCODE_DISABLE_AUTOUPDATE=1` | - |
| kilo | Kilo | `kilo acp` | as opencode | - |
| goose | Goose | `goose acp` | `GOOSE_DISABLE_KEYRING=1` | - |
| pi | Pi | `pi-acp` | - | - |
| dsh | dsh | `dsh --profile acp` | - | - |
| devin | Devin | `devin acp` | - | - |
| cursor | Cursor | `agent acp` | - | the key method, when `CURSOR_API_KEY` is set |
| amp | Amp | `amp-acp` | - | - |
| qwen | Qwen Code | `qwen --acp` | - | - |

## Files

- `CREATE: packages/agent-acp/src/presets.ts` - the table, each row with the date it was checked; a row is the per-agent fields of `AcpOptions` less `provider`, plus the sign-in rule as the variable names it reads.
- `UPDATE: packages/agent-acp/src/plugin.ts` - `optionsSchema` keeps `hostTools` at top level and adds `presets`: an object whose `additionalProperties` is an object holding `base`, `name`, `command`, `args`, `env`, `cwd`, `description`, `model`, `authenticate` and `hostTools`. `env` values are `{ type: 'string', writeOnly: true, secretAtUse: true }`. `optionsOf` becomes async and returns one `AcpOptions` per preset that resolved; `apply` registers one `acpAgent` each. The header comment says one load serves every preset.
- `UPDATE: packages/agent-acp/package.json` - `ahpd.options` lists `presets` (required) and `hostTools`, and drops the per-agent keys, so a listing with no presets says `unconfigured` naming `presets`.
- `CREATE: packages/agent-acp/test/agent-acp-presets.test.ts` - the merge, skip and sign-in cases below.
- `UPDATE: packages/agent-acp/test/agent-acp-plugin.test.ts:166-237` - the specs become one load with a `presets` map; the "nothing to spawn" case becomes an unknown key with no `command`, skipped while another preset loads.

## Steps

1. In `optionsOf`, refuse a top-level `command`, `args`, `env`, `cwd`, `provider`, `displayName`, `description`, `model` or `authenticate` with a message naming `presets.<id>.<key>`, as agent-claude does.
2. For each key in written order, build the variant: the row named by the key, else the row named by `base`, else none; then the preset's fields over it, `env` merged by key; `provider` is the key and `displayName` is `name`, else the row's name, else the key.
3. Skip the preset, with one `host.log` line naming `options.presets.<id>` and why, when: `base` names no row; there is no row and no `command`; `authenticate` carries no `methodId` (today's check, per preset); an `env` value written `{ "$secret": "<name>" }` cannot be read with `host.secret(name)`, or names a `user:` or `team:` scope. A secret read replaces the reference in the variant's `env`. An unknown key's line lists the shipped presets.
4. Decide a row's sign-in after step 3: the variable counts as set when the daemon's environment has it, else the preset's `env` has it, else a `$secret` there resolved to it. When set, the row's `authenticate` applies unless the preset wrote its own; when not, the agent registers with no `authenticate`, and a session the server refuses ends with acp/04's sentence.
5. With no preset left, throw one error naming every skipped preset's line; an empty or absent `presets` throws saying so.
6. Once host/41 task 03 lands `host.problem`, the skip line goes through it too; until then `host.log` only.
7. Kimi, Cline and Junie are in the registry but unchecked; a row is added only once checked.

## Validation

- `agent-acp-presets.test.ts`: `{ codex: { env: { X: '1' } } }` registers provider `codex`, name `Codex`, command `codex-acp`, and both envs.
- The same file: `{ work: { base: 'copilot', name: 'Copilot work' } }` has Copilot's command and env under provider `work`.
- The same file: `{ codex: {}, nope: {} }` registers `codex` and logs one line naming `options.presets.nope` and the shipped presets.
- The same file: `{ codex: { env: { OPENAI_API_KEY: { $secret: 'host:oa' } } } }` registers with the value and `authenticate: { methodId: 'api-key' }` when the vault holds it, and skips only `codex` when the secret is missing and when the host has no vault.
- The same file: with `CODEX_API_KEY` and `OPENAI_API_KEY` unset in the daemon's environment and no preset `env`, `codex` registers with no `authenticate`; with the variable only in the preset's `env`, it registers with it.
- The same file: a top-level `command` fails the load naming `presets`; every preset skipped fails the load naming each.
- The test's `load` passes a `log` that records lines, so each skip line is asserted.
- `agent-acp-plugin.test.ts`: one load with `presets: { copilot: {...}, codex: {...} }` lists both providers and serves a turn on each.
- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass.

## Resume
