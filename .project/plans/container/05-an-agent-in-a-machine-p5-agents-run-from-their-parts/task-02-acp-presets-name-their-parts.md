---
title: ACP presets carry their machine
status: todo
depends: []
layer: "agent-acp"
refs:
  - "[code://.project/plans/acp/05-presets/task-01-the-preset-table.md](../../acp/05-presets/task-01-the-preset-table.md) - the presets, host half"
  - "[code://.project/plans/container/05-an-agent-in-a-machine-p2-an-acp-agent-says-what-its-machine-needs/task-01-a-spec-declares-what-its-machine-needs.md](../05-an-agent-in-a-machine-p2-an-acp-agent-says-what-its-machine-needs/task-01-a-spec-declares-what-its-machine-needs.md) - the `machine` option a preset fills"
---

## Objective

Each preset carries a `machine` block: its part, its config dir variable, and its secrets; `AcpMachine` takes a `part` a hand-written spec can name too.
None of these reach a spawn on the host, only a machine.

| Preset | Part | Env in a machine | Secrets |
| --- | --- | --- | --- |
| codex | codex | `CODEX_HOME=/ahpd/codex` | `CODEX_API_KEY` |
| gemini | gemini | `GEMINI_CLI_HOME=/ahpd/gemini` | `GEMINI_API_KEY` |
| copilot | copilot | `COPILOT_HOME=/ahpd/copilot` | `COPILOT_GITHUB_TOKEN` |
| opencode | opencode | `XDG_CONFIG_HOME=/ahpd/opencode/config`, `XDG_DATA_HOME=/ahpd/opencode/data` | the provider's key, named by the spec |
| kilo | kilo | as opencode under `/ahpd/kilo` | as opencode |
| goose | goose | `GOOSE_PATH_ROOT=/ahpd/goose` | `GOOSE_PROVIDER`, `GOOSE_MODEL`, the provider's key |
| pi | pi | `PI_CODING_AGENT_DIR=/ahpd/pi` | the provider's key |
| dsh | dsh | `DSH_HOME=/ahpd/dsh` | `DEEPSEEK_API_KEY` |
| devin | devin | `XDG_CONFIG_HOME=/ahpd/devin/config`, `XDG_DATA_HOME=/ahpd/devin/data` | `WINDSURF_API_KEY` |
| cursor | cursor | `CURSOR_CONFIG_DIR=/ahpd/cursor` | `CURSOR_API_KEY` |
| amp | amp (holds `amp` and `amp-acp`) | `AMP_CLI_PATH=amp` | `AMP_API_KEY` |
| qwen | qwen | `QWEN_HOME=/ahpd/qwen` | `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL` |

## Files

- `UPDATE: packages/agent-acp/src/types.ts` - `AcpMachine.part`.
- `UPDATE: packages/agent-acp/src/presets.ts` - a `machine` block per row.
- `UPDATE: packages/agent-acp/src/agent.ts` - the part need, named `<provider>.part`.

## Steps

1. Merge a preset's `machine` under the spec's `machine`, by key.
2. Check that a host spawn's env never includes `machine.env`.

## Validation

- `{ preset: "gemini" }` answers a part need `gemini`, an env need `GEMINI_CLI_HOME` and a secret `GEMINI_API_KEY`.
- A host spawn of the same spec has no `GEMINI_CLI_HOME`.

## Resume
