---
title: Presets for the ACP agents
status: dropped
depends: [task-01-a-spec-declares-what-its-machine-needs.md, task-02-a-spec-may-sign-in.md]
layer: "agent-acp"
refs:
  - npm://@agentclientprotocol/codex-acp - `codex-acp`; `CODEX_HOME`, `CODEX_API_KEY`, `DEFAULT_AUTH_REQUEST`
  - npm://@google/gemini-cli - `gemini --acp`; `GEMINI_CLI_HOME`, `GEMINI_API_KEY`
  - npm://@github/copilot - `copilot --acp`; `COPILOT_HOME`, `COPILOT_GITHUB_TOKEN`, `COPILOT_AUTO_UPDATE`
  - npm://opencode-ai - `opencode acp`; `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `OPENCODE_DISABLE_AUTOUPDATE`
  - npm://@kilocode/cli - `kilo acp`; XDG as opencode
  - npm://pi-acp - `pi-acp`; `PI_CODING_AGENT_DIR`
  - npm://@qwen-code/qwen-code - `qwen --acp`; `QWEN_HOME`
  - npm://@deepseek-ai/dsh - `dsh --profile acp`; `DSH_HOME`, `DEEPSEEK_API_KEY`
  - npm://@sourcegraph/amp - the Amp CLI that `amp-acp` drives; `AMP_API_KEY`
---

## Objective

`{ preset: "<id>" }` is a whole spec for each agent below, and a spec field overrides the preset's.

| Preset | Command | Env | Secrets | Sign-in |
| --- | --- | --- | --- | --- |
| codex | `codex-acp` | `CODEX_HOME=/ahpd/codex` | `CODEX_API_KEY` | `api-key` |
| gemini | `gemini --acp` | `GEMINI_CLI_HOME=/ahpd/gemini` | `GEMINI_API_KEY` | - |
| copilot | `copilot --acp` | `COPILOT_HOME=/ahpd/copilot`, `COPILOT_AUTO_UPDATE=false` | `COPILOT_GITHUB_TOKEN` | - |
| opencode | `opencode acp` | `XDG_CONFIG_HOME=/ahpd/opencode/config`, `XDG_DATA_HOME=/ahpd/opencode/data`, `OPENCODE_DISABLE_AUTOUPDATE=1` | the provider's key, named by the spec | - |
| kilo | `kilo acp` | as opencode under `/ahpd/kilo` | as opencode | - |
| goose | `goose acp` | `GOOSE_PATH_ROOT=/ahpd/goose`, `GOOSE_DISABLE_KEYRING=1` | `GOOSE_PROVIDER`, `GOOSE_MODEL`, the provider's key | - |
| pi | `pi-acp` | `PI_CODING_AGENT_DIR=/ahpd/pi` | the provider's key | - |
| dsh | `dsh --profile acp` | `DSH_HOME=/ahpd/dsh` | `DEEPSEEK_API_KEY` | - |
| devin | `devin acp` | `XDG_CONFIG_HOME=/ahpd/devin/config`, `XDG_DATA_HOME=/ahpd/devin/data` | `WINDSURF_API_KEY` | - |
| cursor | `agent acp` | `CURSOR_CONFIG_DIR=/ahpd/cursor` | `CURSOR_API_KEY` | the key method, if the agent lists one |
| amp | `amp-acp` | `AMP_CLI_PATH=amp` | `AMP_API_KEY` | - |
| qwen | `qwen --acp` | `QWEN_HOME=/ahpd/qwen` | `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL` | - |

## Files

- `CREATE: packages/agent-acp/src/presets.ts` - the table as data, each entry with the version it was checked against.
- `UPDATE: packages/agent-acp/src/plugin.ts` - `preset` merged under the spec; an unknown preset refused with the list.
- `CREATE: packages/agent-acp/test/acp-presets.test.ts` - merging and refusal.

## Steps

1. Put the table in `presets.ts`; `provider` and `displayName` default to the preset id and the agent's name.
2. Merge: preset, then spec, field by field; `machine.env` and `machine.secrets` merge by key.
3. The copy sets are left empty here; p6 seeds configuration by volume, and a person adds copies by spec.

## Validation

- `{ preset: "codex", env: { X: "1" } }` has the preset's command and both envs.
- `{ preset: "nope" }` is refused at load, naming the presets.

## Resume

Dropped 2026-09-26 before it started: moved to [acp 05 task 01](../../acp/05-presets/task-01-the-preset-table.md) for the host half, and [p5 task 02](../05-an-agent-in-a-machine-p5-agents-run-from-their-parts/task-02-acp-presets-name-their-parts.md) for the machine half, by Softov's answer that sign-in lives in the acp domain.
