---
title: The preset table, merged under a spec
status: todo
depends: []
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/plugin.ts#L61-L92](../../../../packages/agent-acp/src/plugin.ts#L61-L92) - the merge point"
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

`packages/agent-acp/src/presets.ts` holds the table below, `{ preset }` merges it under the spec, and an unknown preset is refused at load with the list.

| Preset | Command | Env | Sign-in |
| --- | --- | --- | --- |
| codex | `codex-acp` | - | `api-key` when `CODEX_API_KEY` or `OPENAI_API_KEY` is set |
| gemini | `gemini --acp` | - | - |
| copilot | `copilot --acp` | `COPILOT_AUTO_UPDATE=false` | - |
| opencode | `opencode acp` | `OPENCODE_DISABLE_AUTOUPDATE=1` | - |
| kilo | `kilo acp` | as opencode | - |
| goose | `goose acp` | `GOOSE_DISABLE_KEYRING=1` | - |
| pi | `pi-acp` | - | - |
| dsh | `dsh --profile acp` | - | - |
| devin | `devin acp` | - | - |
| cursor | `agent acp` | - | the key method, when `CURSOR_API_KEY` is set |
| amp | `amp-acp` | - | - |
| qwen | `qwen --acp` | - | - |

## Files

- `CREATE: packages/agent-acp/src/presets.ts` - the table, each row with the date it was checked.
- `UPDATE: packages/agent-acp/src/plugin.ts` - `preset` read and merged; `env` merged by key.
- `CREATE: packages/agent-acp/test/acp-presets.test.ts`.

## Steps

1. `provider` defaults to the preset id and `displayName` to the agent's name.
2. A sign-in that depends on a variable is decided at load from the daemon's environment.
3. Kimi, Cline and Junie are in the registry but unchecked; a row is added only once checked.

## Validation

- `{ preset: "codex", env: { X: "1" } }` has the preset's command and both envs.
- `{ preset: "nope" }` is refused naming the presets.

## Resume
