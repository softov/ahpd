---
title: An agent or connector turns off
domain: plugin
status: active
priority: medium
created: 2026-11-11
revalidated: 2026-11-11
requires:
  - plans/plugin/20261111-0032-agents-and-connectors-list-their-alerts/plan.md
refs:
  - git://6f4ee6ff6 - the commit of ahpd this plan was checked at
  - git://87b48bb6c - the last commit that holds the brief an-agent-or-connector-turns-off-and-lists-its-alerts, which this plan and its sibling cover
  - "[code://packages/sdk/src/tunnels/channel.ts#L524-L541](../../../../packages/sdk/src/tunnels/channel.ts#L524-L541) - a tunnel's `enable` and `disable`, the pattern this plan copies"
  - "[code://packages/sdk/src/types/tunnels.ts#L98-L99](../../../../packages/sdk/src/types/tunnels.ts#L98-L99) - a tunnel record stores `enabled`"
  - "[code://packages/server/src/plugins.ts#L2331](../../../../packages/server/src/plugins.ts#L2331) - `PluginState`, whose `disabled` the two rows copy"
  - "[code://packages/sdk/src/agents/channel.ts#L474-L563](../../../../packages/sdk/src/agents/channel.ts#L474-L563) - `sync`, which ends the sessions of an agent that leaves the open list"
  - "[code://packages/sdk/src/agents/channel.ts#L815-L824](../../../../packages/sdk/src/agents/channel.ts#L815-L824) - `put` builds the record from its fields, so `enabled` must be carried over"
  - "[code://packages/sdk/src/agents/channel.ts#L944-L983](../../../../packages/sdk/src/agents/channel.ts#L944-L983) - `check` and the methods map, the shape of the new methods"
  - "[code://packages/sdk/src/host.ts#L1931-L1938](../../../../packages/sdk/src/host.ts#L1931-L1938) - `runningOn`, which keeps a dropped agent while a session runs on it"
  - "[code://packages/sdk/src/host.ts#L2041-L2051](../../../../packages/sdk/src/host.ts#L2041-L2051) - `replace` keeps a dropped agent that still has an open session"
  - "[code://packages/sdk/src/host/root.ts#L294](../../../../packages/sdk/src/host/root.ts#L294) - `descriptors`, the root's agent list"
  - "[code://packages/sdk/src/host/lifecycle.ts#L2562-L2577](../../../../packages/sdk/src/host/lifecycle.ts#L2562-L2577) - a new session's agent check"
  - "[code://packages/sdk/src/host/lifecycle.ts#L1915](../../../../packages/sdk/src/host/lifecycle.ts#L1915) - `sendTurn`, where a turn reaches the agent"
  - "[code://packages/sdk/src/types/host.ts#L356](../../../../packages/sdk/src/types/host.ts#L356) - `agentOwners`, the host option this plan's option sits beside"
  - "[code://packages/server/src/commands/run.ts#L1288](../../../../packages/server/src/commands/run.ts#L1288) - where the daemon passes `agentOwners` to the host"
  - "[code://packages/sdk/src/connectors/channel.ts#L879-L885](../../../../packages/sdk/src/connectors/channel.ts#L879-L885) - a connector `put` builds the record from its fields"
  - "[code://packages/sdk/src/connectors/channel.ts#L1508-L1534](../../../../packages/sdk/src/connectors/channel.ts#L1508-L1534) - `providers`, which lists open connectors only"
  - "[code://packages/sdk/src/connectors/channel.ts#L1596-L1615](../../../../packages/sdk/src/connectors/channel.ts#L1596-L1615) - `openAll`"
  - https://github.com/microsoft/vscode/blob/1564f100807a/src/vs/platform/agentHost/node/agentService.ts#L2734-L2746 - a disabled agent stays registered, and hosts no new chat or session
  - https://github.com/microsoft/vscode/blob/1564f100807a/src/vs/platform/agentHost/node/agentService.ts#L10056-L10058 - a chat that asks for a disabled agent is refused
---

## Goal

A person turns an agent record or a connector record off, and on again, without removing it.
A disabled record is not opened, so the host reads no key and runs no probe for it.
A session that already uses a disabled agent keeps its history, but takes no new message until the agent is on again.
A disabled connector answers no call and offers no models.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "endSessionsOf" packages` - `sync` ends the sessions of every agent that leaves the open list, and `endSessionsOf` removes them as a dispose does.
- `rg -n "runningOn" packages/sdk/src/host.ts` - `replace` keeps an agent the fold drops while a session runs on it.
- `rg -n "enable|disable" packages/sdk/src/tunnels/channel.ts` - a tunnel's toggle writes `enabled` and calls `stop` or `start`, with the grant `tunnel:put`.
- `rg -n "_isAgentDisabledOnHost" src/vs/platform/agentHost/node/agentService.ts` in VS Code - a disabled agent refuses a new session, a new chat and a chat move.
- `rg -n "providers = " packages/sdk/src/connectors/channel.ts` - only an open connector offers models.

### Runtime path

```
x-ahpd/agents/disable -> record enabled: false -> sync skips the record and does not end its sessions -> refold -> host keeps the backend while a session runs on it -> disabledAgents() -> refused new sessions, chats, moves and turns
x-ahpd/connectors/disable -> record enabled: false -> close -> no calls, no models -> row state disabled
```

### Gaps

- Agent and connector records have no `enabled` field.
- An agent that leaves the open list has its sessions ended and removed, so a toggle through `sync` today would lose the history.
- The host has no way to know that an agent it serves is off.
- `Not found: a test of a message sent to a stored session whose agent is not open - searched agents-channel and host tests for endSessionsOf and noProvider.`

## Answers

| What | Source | Task |
| --- | --- | --- |
| An agent record stores `mode`: `enabled`, `paused` or `disabled`; a record with none is enabled | Softov, 2026-11-11, chose "One `mode` field" over `enabled` | 01, 02 |
| A paused agent opens at start, lists its sessions with their history, and refuses a new session, chat, move or message | Softov, 2026-11-11, proposed a paused state between on and off | 01, 02 |
| A disabled agent is not opened; after a restart its stored sessions are not listed, and they come back when it is enabled | Softov, 2026-11-11 | 01, 02 |
| A connector record stores `enabled`; a record with none is on | Softov, 2026-11-10 | 03 |
| Connectors have no paused state | (defaulted: a connector has no sessions to keep listed) | 03 |
| Disabling an agent with running sessions keeps its backend until the last one ends | (defaulted: `replace` keeps a dropped agent while a session runs on it) | 01, 02 |
| `enable` and `disable` take the grants `agent:put` and `connector:put`, with the owner's rule | Softov, 2026-11-10 | 01, 03 |
| A session on a paused or disabled agent keeps its history and refuses a new message | Softov, 2026-11-10 | 01, 02 |
| The methods are `x-ahpd/agents/enable`, `x-ahpd/agents/pause`, `x-ahpd/agents/disable`, `x-ahpd/connectors/enable` and `x-ahpd/connectors/disable`, each with `{ id }`, and each answers the row | (defaulted: the two channels' own methods are `put`, `remove` and `check` on the same domain) | 01, 03 |
| A disabled record's state is `disabled` and shows no alerts; a paused agent's state is `paused` and shows its alerts | (defaulted: a plugin row is `disabled` with nothing to fix) | 01, 03 |
| The root's agent list omits a paused agent and a disabled agent | (defaulted: ahpd clients offer what the root lists; VS Code's window reads its own setting instead) | 02 |
| One sentence for each: `<id> is paused.` and `<id> is turned off.` | (defaulted: one plain sentence for every refusal) | 02 |
| A disabled connector stays in `refs`, so an agent record that names it stays valid; a call to it fails as one to a closed connector does | (defaulted: a toggle does not make other records `invalid`) | 03 |
| `put` keeps a record's `mode` or `enabled` as it was | (defaulted: an edit is not a toggle) | 01, 03 |

## Proposed architecture

- **Data flow** - an agent record carries `mode`, as a tunnel carries `enabled`; a connector record keeps its boolean `enabled`. `put` carries the stored value over.
- **Agents** - `sync` leaves a disabled record out of the agents it opens, opens a paused one as it opens an enabled one, and ends the sessions of neither. The host's `replace` keeps that backend while a session runs on it, as it does today.
- **Host** - a new option `disabledAgents?: () => ReadonlySet<string>` sits beside `agentOwners`, and a `pausedAgents` option beside it names the paused ids so the refusal sentence differs. The root list, a new session, a new chat, a chat move and `sendTurn` read both.
- **Connectors** - `disable` closes the connector, and `openAll` and `put` skip a disabled one. A closed connector already answers no call and lists no model.
- **Layer responsibilities** - sdk: the field, the methods, the host option and its checks. server: `run.ts` passes the option. ahpw: its own plan.
- **Source-of-truth files** - [`code://packages/sdk/src/agents/channel.ts`](../../../../packages/sdk/src/agents/channel.ts), [`code://packages/sdk/src/connectors/channel.ts`](../../../../packages/sdk/src/connectors/channel.ts), [`code://packages/sdk/src/types/host.ts`](../../../../packages/sdk/src/types/host.ts).

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - An agent record turns off](task-01-an-agent-record-turns-off.md) | done | - |
| [02 - The host refuses a disabled agent](task-02-the-host-refuses-a-disabled-agent.md) | todo | 01 |
| [03 - A connector record turns off](task-03-a-connector-record-turns-off.md) | done | - |

## Risks and tradeoffs

- A backend kept for its sessions still holds the key it read - the host drops it after its last session. A restart does not open it.
- After a restart, a stored session of a disabled agent has no backend - task 02 tests a message to it. The answer is the turned-off sentence.
- ahpw shows no switch until its own plan - the methods work from ahpc and the MCP tools at once.

## Resume state

- **Done so far:** task 01 built 2026-11-11 for the three agent states: `mode` with `enabled`, `paused` and `disabled`, the older `enabled: false` reading as disabled, the `pause` command, and the channel's `disabled()` and `paused()` sets. Task 03 stays `done` from the boolean-`enabled` build.
- **Next action:** task 02: the host's refusals for a paused agent, the root list, and the restart cases.
- **Open questions:** none.
- **Watch out for:**
`sync` ends the sessions of each id in `before` that is no longer open. A paused or disabled id is skipped there, and a paused record is opened as an enabled one is.
A paused record is opened at start, so the host's refusal is the only gate on it. `disabledAgents` names the disabled ids, and the host needs the paused ids too because the sentence differs; task 02 adds a `pausedAgents` option beside it.
The restart test needs a second host with its own backend instance, or it does not test a restart. The disabled case checks the stored session leaves the list and comes back after `enable`.

## Final verification checklist

- [x] A disabled agent leaves the root list, refuses a new session, and its open session refuses a message with `<id> is turned off.`
- [x] Enabling the agent again lets the same session send a message.
- [x] A disabled agent with a missing key raises no alert, and its row is `disabled`.
- [x] A disabled connector lists no models, and an action through it fails.
- [x] `pnpm typecheck` passes, and the sdk and server suites pass, one at a time.
