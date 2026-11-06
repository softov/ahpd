---
title: Each agent has a host tools switch
domain: plugin
status: planned
priority: medium
created: 2026-11-05
revalidated: 2026-11-05
refs:
  - git://ad89aa2d - the commit of ahpd the facts were checked at, after the merges of #240, #241 and #242
  - "[code://packages/agent-acp/src/plugin.ts#L118](../../../../packages/agent-acp/src/plugin.ts#L118) - acp's record field `hostTools`: the pattern to copy"
  - "[code://packages/agent-acp/src/plugin.ts#L184-L189](../../../../packages/agent-acp/src/plugin.ts#L184-L189) - acp's plugin option, read once"
  - "[code://packages/agent-acp/src/plugin.ts#L353](../../../../packages/agent-acp/src/plugin.ts#L353) - the record's value wins over the plugin's"
  - "[code://packages/agent-acp/src/session/opening.ts#L167](../../../../packages/agent-acp/src/session/opening.ts#L167) - with it off, a session gets no host tools"
  - "[code://packages/agent-claude/src/session/clienttools.ts#L545-L592](../../../../packages/agent-claude/src/session/clienttools.ts#L545-L592) - `declaring`, `buildClientMcpServers` and `rebindForClientTools`: a session's tools reach the CLI on a `client` and a `host` server"
  - "[code://packages/agent-cofold/src/session.ts#L215](../../../../packages/agent-cofold/src/session.ts#L215) - cofold takes `start.tools`"
  - "[code://packages/agent-pi/src/session.ts#L173](../../../../packages/agent-pi/src/session.ts#L173) - pi takes `start.tools`"
---

## Goal

Claude, cofold and pi can turn the host's tools off for one plugin or one agent, as acp can.
Today only the daemon's `sessionTools` and `sessionToolsProviders` gate them.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Runtime path

```
host -> start.tools -> session wires them in; acp: hostTools ?? plugin hostTools -> toolsServer or none
```

### Gaps

- Claude, cofold and pi take `start.tools` whatever their configuration says.
- Claude offers the host's tools on its `host` server, and a client's tools on its `client` server.
- cofold and pi hold both kinds in one list, and a client's tool names its owner.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Plan `hostTools` for Claude, cofold and pi | Softov, 2026-11-05, chose "Model and host tools" | 01, 02, 03 |
| Each plugin checks its own switch, as acp does | Softov, 2026-11-05, chose "In each plugin, like acp" | 01, 02, 03 |
| `hostTools` is a plugin option and a record field, and the record's value wins | (defaulted: acp's shape) | 01, 02, 03 |
| On by default | (defaulted: the host's tools reach every session today) | 01, 02, 03 |
| Off, a session gets no host tools at its start and none on a later change | (defaulted: a later change would give back what the switch took) | 01, 02, 03 |
| Off drops only the host's own tools, and a client's tools still reach the agent | Softov, 2026-11-05, chose "Only the host's tools" | 01 |
| cofold and pi drop the tools with no owner, and keep each client's | (defaulted: the same split as Claude's, read from each tool's owner) | 02, 03 |
| The option text is "Offer the host's tools to each session. On by default. Each agent can override it.", with es and pt | (defaulted: the style of the copy PR) | 01, 02, 03 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - Claude has a host tools switch](task-01-claude-has-a-host-tools-switch.md) | implemented | - |
| [02 - cofold has a host tools switch](task-02-cofold-has-a-host-tools-switch.md) | implemented | - |
| [03 - pi has a host tools switch](task-03-pi-has-a-host-tools-switch.md) | todo | - |

## Resume state

- **Done so far:** task 01, Claude's switch; task 02, cofold's switch.
- **Next action:** task 03.
- **Open questions:** none.
- **Watch out for:** the copy PR edits each plugin's `package.json` and `i18n` files. Build on main after it merges.

## Final verification checklist

- [ ] `pnpm --filter @ahpd/agent-claude test`, `pnpm --filter @ahpd/agent-cofold test` and `pnpm --filter @ahpd/agent-pi test` pass, each run alone.
- [ ] `pnpm typecheck` and `pnpm boundary` pass.
