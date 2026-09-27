---
title: ACP presets and cofold declare their state
status: todo
depends: [task-02-acp-presets-name-their-parts.md, task-03-a-cofold-machine-runs-ahpd-from-its-part.md]
layer: "agent-acp, agent-cofold"
refs:
  - "[code://.project/plans/container/05-an-agent-in-a-machine-p5-agents-run-from-their-parts/task-02-acp-presets-name-their-parts.md](task-02-acp-presets-name-their-parts.md) - the presets' config dirs"
  - "[code://packages/agent-cofold/src/agent.ts#L542-L560](../../../../packages/agent-cofold/src/agent.ts#L542-L560) - cofold's config file need"
  - "[code://.project/decisions/cofold-config-reaches-a-machine-at-a-fixed-target.md](../../../decisions/cofold-config-reaches-a-machine-at-a-fixed-target.md) - the target it keeps"
---

## Objective

Each preset declares a state need at its config dir with its seeds, and cofold's configuration becomes a state need at its fixed target, with the file mount kept under `when: 'host'`.

| Preset | Seeds, from the host's own dir |
| --- | --- |
| codex | `config.toml`, `AGENTS.md`, `skills/` |
| gemini | `.gemini/settings.json` without `security.auth`, `.gemini/GEMINI.md` |
| copilot | `settings.json`, `mcp-config.json`, `copilot-instructions.md`, `agents/`, `skills/`; never `config.json` |
| opencode, kilo | `opencode.json` or `kilo.json`, `agent/`, `command/` |
| goose | `config/config.yaml` |
| pi | `settings.json`, `models.json` |
| dsh | `profiles/acp/` |
| devin | `config.json`, `mcp_config.json` |
| cursor | `cli-config.json` |
| amp | `settings.json` |
| qwen | `settings.json` |

## Files

- `UPDATE: packages/agent-acp/src/types.ts` - `AcpMachine.seed`.
- `UPDATE: packages/agent-acp/src/presets.ts` - the seeds.
- `UPDATE: packages/agent-cofold/src/agent.ts:542-560` - the state need.

## Steps

1. A seed whose host source is missing is skipped, not refused: a person who never configured the agent on the host still gets a machine.
2. Gemini's seed is `{ source: '~/.gemini/settings.json', target: '.gemini/settings.json', drop: ['security.auth'] }`.

## Validation

- Each preset in mode `volume` has a state need with its seeds.
- Cofold in mode `volume` has its state at the fixed target and no file mount.

## Resume
