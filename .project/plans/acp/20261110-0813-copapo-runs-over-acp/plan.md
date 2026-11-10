---
title: copapo runs over ACP
domain: acp
status: planned
priority: medium
created: 2026-11-10
revalidated: 2026-11-10
requires: []
changes: []
creates: []
refs:
  - git://7d76d5895 - the commit of ahpd this plan was checked at
  - git://962cdc23e:.project/briefs/ahpd-runs-copapo-and-names-itself.md - the brief this plan covers, with the names and the app in the two cofold plans
  - "[code://packages/sdk/src/machines/agents.ts#L92](../../../../packages/sdk/src/machines/agents.ts#L92) - `knownAgents`, the name, command, install line and variables of each agent"
  - "[code://packages/sdk/src/machines/agents.ts#L184-L211](../../../../packages/sdk/src/machines/agents.ts#L184-L211) - the `pi` and `dsh` rows, the shape of an npm agent's row"
  - "[code://packages/agent-acp/src/presets.ts#L94-L109](../../../../packages/agent-acp/src/presets.ts#L94-L109) - `stateOf` and `xdgOf`, a machine whose agent reads `$XDG_CONFIG_HOME`"
  - "[code://packages/agent-acp/src/presets.ts#L166-L171](../../../../packages/agent-acp/src/presets.ts#L166-L171) - the `opencode` row, an agent started with `acp` and an XDG machine"
  - "[code://packages/computer/images/versions.json#L115-L131](../../../../packages/computer/images/versions.json#L115-L131) - the `pi` and `dsh` parts, an npm part"
  - npm://@cofold/copapo@0.1.0 - the `copapo` command and `copapo acp`
  - https://github.com/softov/cofold/blob/3551a23/packages/copapo/README.md - copapo's names, `COFOLD_HOME`, and its *ACP* section
---

## Goal

A person adds a copapo agent as they add OpenCode or Goose: from the catalogue, with its install line, its variables and a machine.
ahpd starts `copapo acp` and talks to it over ACP.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `grep -n "args: \['acp'\]" packages/agent-acp/src/presets.ts` - OpenCode and Kilo start with `acp`, as copapo does.
- `npm view @cofold/copapo version` - `0.1.0`, published.
- `grep -n COFOLD_HOME /github/cofold/packages/copapo/README.md` - copapo keeps its sessions under `$COFOLD_HOME`, `~/.cofold` by default.

### Runtime path

```
knownAgents.copapo -> presets.copapo { command: copapo, args: [acp] } -> agent-acp spawns copapo acp
  -> ACP initialize, session/new -> turns; in a machine: part copapo, state /ahpd/copapo
```

### Gaps

- copapo over ACP ignores the `mcpServers` a client sends, so a session that agent-acp gives MCP servers runs without them.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The row is `copapo`: name `copapo`, command `copapo`, install `npm i -g @cofold/copapo` | the brief | 01 |
| The preset starts `copapo` with `args: ['acp']` | the brief; copapo's README | 01 |
| `honoursTrust` stays unset, so a session runs only in a folder the host trusts | Softov, 2026-11-10, chose "Leave honoursTrust unset" | 01 |
| The variables are `COPAPO_BASE_URL`, `COPAPO_API_KEY` (secret), `COPAPO_MODEL` and `COPAPO_CONFIG` | (defaulted: copapo's own variables, as each row lists its agent's) | 01 |
| The machine is `xdgOf('copapo', ['config.json'])`, with `COFOLD_HOME` in its state folder | (defaulted: the `opencode` row's shape, plus copapo's session folder) | 01 |
| The part is an npm part, `@cofold/copapo@0.1.0`, with the bin `copapo` | (defaulted: the `pi` and `dsh` parts' shape) | 01 |
| The site is `https://github.com/softov/cofold` | (defaulted: copapo's repository; Softov may name another) | 01 |

## Proposed architecture

- **Data flow** - a new row in `knownAgents`, a new preset, a new part; agent-acp's code is unchanged.
- **Event flow** - none.
- **State flow** - a machine keeps `config/copapo/config.json` and `COFOLD_HOME` in `/ahpd/copapo`.
- **Layer responsibilities** - sdk: the row. agent-acp: the preset. computer: the part. docs: the agents list and the release notes.
- **Source-of-truth files** - [`code://packages/agent-acp/src/presets.ts`](../../../../packages/agent-acp/src/presets.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - copapo is a shipped ACP agent](task-01-copapo-is-a-shipped-acp-agent.md) | todo | - |

## Risks and tradeoffs

- copapo ignores a client's MCP servers over ACP. The row's description says so, and nothing in ahpd works around it.
- copapo is at `0.1.0`. A later copapo that changes its ACP arguments changes the preset.

## Resume state

- **Done so far:** planned 2026-11-10.
- **Next action:** [task-01-copapo-is-a-shipped-acp-agent.md](task-01-copapo-is-a-shipped-acp-agent.md).
- **Open questions:** none.
- **Watch out for:** the acp catalogue tests count the shipped rows and the parts; a new row changes those counts.

## Final verification checklist

- [ ] The catalogue lists copapo with its install line and variables.
- [ ] A copapo agent answers a turn on this machine, in a trusted folder.
- [ ] A copapo session in a folder the host does not trust is refused.
- [ ] A copapo agent in a machine finds `config/copapo/config.json` and keeps its sessions in `/ahpd/copapo`.
- [ ] `pnpm typecheck` and the sdk, agent-acp and computer suites pass, and Windows CI is green.
