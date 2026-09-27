---
title: Agents run from their parts and keep their own state, and the host's binary and home become opt-ins
domain: container
status: planned
priority: high
created: 2026-09-26
revalidated: 2026-09-26
requires:
  - plans/container/05-an-agent-in-a-machine-p2-an-acp-agent-says-what-its-machine-needs/plan.md
  - plans/container/05-an-agent-in-a-machine-p4-a-part-is-mounted-into-a-machine/plan.md
  - plans/container/05-an-agent-in-a-machine-p6-an-agents-configuration-lives-in-a-volume/plan.md
  - plans/acp/05-presets/plan.md
changes: []
creates: []
decisions:
  - decisions/a-nested-host-is-used-only-where-a-command-cannot-reach-the-agent.md
  - decisions/a-part-is-mounted-from-its-image-and-a-volume-is-the-fallback.md
refs:
  - "[code://packages/agent-claude/src/claude.ts#L382-L406](../../../../packages/agent-claude/src/claude.ts#L382-L406) - Claude's needs: config dir, `.claude.json`, and the host's binary"
  - "[code://packages/agent-claude/src/claude.ts#L20-L28](../../../../packages/agent-claude/src/claude.ts#L20-L28) - `claudeExecutablePath`, the host binary"
  - "[code://packages/agent-cofold/src/agent.ts#L542-L560](../../../../packages/agent-cofold/src/agent.ts#L542-L560) - cofold's needs"
  - "[code://packages/agent-pi/src/agent.ts#L70-L100](../../../../packages/agent-pi/src/agent.ts#L70-L100) - pi's agent: no `runsNested`, no `machine()`, so a pi session on a computer is refused today"
  - "[code://packages/computer/src/plugin.ts#L40](../../../../packages/computer/src/plugin.ts#L40) - `host: ['ahpd']`, found on the machine's `PATH`"
  - "[code://packages/computer/src/manifest.ts#L66-L73](../../../../packages/computer/src/manifest.ts#L66-L73) - a profile's `host`"
---

## Goal

Claude, every ACP preset, and the nested hosts that cofold and pi run in, run from their parts, so a machine made from any glibc image runs them with nothing installed and nothing of the host's binaries mounted.
Each of them keeps its configuration in a state volume seeded from a few host files, and signs in with a secret that does not refresh.
Mounting the host's `claude` and the host's `~/.claude` stay, as options a person turns on.

## Reconnaissance

### Runtime path

```
claude.machine() -> [changes] claudePart { part: 'claude' } instead of claudeExecutable
acp preset.machine -> [new] { part: '<preset>' }
cofold.machine() -> [new] ahpdPart { part: 'ahpd' } -> nested() runs `ahpd` from /opt/ahpd/ahpd/bin on PATH
pi -> [new] runsNested + ahpdPart, and @ahpd/agent-pi installed in the ahpd part
claude / presets / cofold / pi -> [new] a state need with seeds, host mounts marked when: 'host', secrets as env needs
```

### Gaps

- Claude's binary is the host's.
- A cofold machine's image must carry ahpd and its plugins.
- Claude's machine mounts the host's `~/.claude`, sign-in included.
- `@ahpd/agent-pi` cannot enter a machine at all.

## Decisions locked in

| Decision | Task |
| --- | --- |
| [A nested host is used only for a backend that runs nested and for a machine on another host](../../../decisions/a-nested-host-is-used-only-where-a-command-cannot-reach-the-agent.md) | 03 |
| [A part is mounted from its own image, and a volume filled from that image is the fallback](../../../decisions/a-part-is-mounted-from-its-image-and-a-volume-is-the-fallback.md) | 01, 02, 03 |

| What | Source | Task |
| --- | --- | --- |
| The host binary mount stays as `computerExecutable: "host"` on `@ahpd/agent-claude` | the proposal Softov asked to plan, 2026-09-26: the host mount becomes an opt-in | 01 |
| The `computerConfigDir: false` route, which mounts only the executable, mounts only the part | follows from the option's meaning | 01 |
| Claude seeds `settings.json`, `CLAUDE.md`, `skills/`, `agents/`, `commands/`, and `.claude.json` with `mcpServers` alone; never `.credentials.json` | the proposal Softov asked to plan, 2026-09-26 | 04 |
| `@ahpd/agent-pi` gets into a machine the way cofold does, in this plan | Softov, 2026-09-26, asked "How should @ahpd/agent-pi get into a machine?", answered "Add tasks to p5" | 06, 07 |
| Claude in a state volume signs in with `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` as secret env needs | the proposal: a token from `claude setup-token` does not refresh | 04 |

## Proposed architecture

- **Layer responsibilities** - `@ahpd/agent-claude`: its part, its state and the two options · `@ahpd/agent-acp`: presets name parts and state · `@ahpd/agent-cofold` and `@ahpd/agent-pi`: running nested, the ahpd part and their state.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - Claude runs from its part](task-01-claude-runs-from-its-part.md) | todo | - |
| [02 - ACP presets carry their machine](task-02-acp-presets-name-their-parts.md) | todo | - |
| [03 - A cofold machine runs ahpd from its part](task-03-a-cofold-machine-runs-ahpd-from-its-part.md) | todo | - |
| [04 - Claude keeps its state in a volume](task-04-claude-keeps-its-state-in-a-volume.md) | todo | 01 |
| [05 - ACP presets and cofold declare their state](task-05-acp-and-cofold-declare-their-state.md) | todo | 02, 03 |
| [06 - pi runs nested from the ahpd part](task-06-pi-runs-nested.md) | todo | 03 |
| [07 - pi declares its state](task-07-pi-declares-its-state.md) | todo | 06 |
| [08 - Docs](task-08-docs.md) | todo | 04, 05, 07 |

## Risks and tradeoffs

- A Claude session in a machine now runs the pinned version, not the host's - the docs say so, and `computerExecutable: "host"` gives the old behaviour.
- A Claude profile made before this now needs a token - a profile with `state: "host"` keeps working unchanged, and the refusal names both routes.

## Resume state

- **Done so far:** nothing.
- **Next action:** any of tasks 01 to 03, then 04 to 07.
- **Open questions:** none.
- **Watch out for:** container 04's fix tasks change the nested start; land them first. The pi plans (`pi/01` to `pi/09`) change `@ahpd/agent-pi` too; tasks 06 and 07 touch only its agent object and its plugin list. A resumed pi session in a machine reads its transcript through the inner host, so the open problem that a pi transcript opens empty for a session its process did not watch applies there.

## Final verification checklist

- [ ] A disposable Claude session in `debian:bookworm-slim` answers a turn with no host binary and no host home mounted, signed in by `CLAUDE_CODE_OAUTH_TOKEN`.
- [ ] `{ preset: "codex" }` in a disposable machine answers a turn.
- [ ] A cofold session in a machine made from `debian:bookworm-slim` answers a turn.
- [ ] A pi session in a machine made from `debian:bookworm-slim` answers a turn, with its settings from the state volume and its key by name.
- [ ] `pnpm test`, `pnpm typecheck` green.
- [ ] `docs/COMPUTER.md`, `plans/index.md` updated.
