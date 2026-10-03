---
title: ACP presets carry their machine
status: todo
depends: []
layer: "agent-acp"
refs:
  - "[code://.project/plans/container/05-an-agent-in-a-machine-p2-an-acp-agent-says-what-its-machine-needs/task-01-a-spec-declares-what-its-machine-needs.md](../05-an-agent-in-a-machine-p2-an-acp-agent-says-what-its-machine-needs/task-01-a-spec-declares-what-its-machine-needs.md) - the `machine` block a preset fills"
  - "[code://.project/decisions/a-plugin-loads-once-and-each-preset-is-a-variant.md](../../../decisions/a-plugin-loads-once-and-each-preset-is-a-variant.md) - each preset is an agent of its own"
---

## Objective

`AcpMachine` takes a `part`, and each known agent's preset, as the ACP presets plan defines presets, carries a `machine` block: its part and its config dir variable.
Its secret is a variable a person fills with `{ "fromEnv" }` or `{ "$secret" }` in their own preset; a preset never carries a value.
None of these reach a spawn on the host, only a machine.

| Agent | Part | Env in a machine | Secret a person fills |
| --- | --- | --- | --- |
| codex | codex | `CODEX_HOME=/ahpd/codex` | `CODEX_API_KEY` |
| gemini | gemini | `GEMINI_CLI_HOME=/ahpd/gemini` | `GEMINI_API_KEY` |
| copilot | copilot | `COPILOT_HOME=/ahpd/copilot` | `COPILOT_GITHUB_TOKEN` |
| opencode | opencode | `XDG_CONFIG_HOME=/ahpd/opencode/config`, `XDG_DATA_HOME=/ahpd/opencode/data` | the provider's key |
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
- `UPDATE: packages/agent-acp/src/agent.ts` - the part need, named `<provider>.part`.
- `UPDATE:` the file the ACP presets plan keeps its shipped presets in - a `machine` block per row.

## Steps

1. Merge a shipped preset's `machine` under the person's own, by key.
2. Check that a host spawn's env never includes `machine.env`.

## Validation

- A Gemini preset answers a part need `gemini` and an env need `GEMINI_CLI_HOME`.
- A Gemini preset with `GEMINI_API_KEY: { fromEnv: "GEMINI_API_KEY" }` answers that env need too.
- A host spawn of the same preset has no `GEMINI_CLI_HOME`.

## Resume
