---
title: An agent or connector turns off, and lists its alerts
created: 2026-11-10
refs:
  - git://6f4ee6ff6 - the commit of ahpd the facts were checked at
  - git://1564f100807a - VS Code main, the reference checked
  - "[code://packages/sdk/src/types/agents.ts#L175-L186](../../packages/sdk/src/types/agents.ts#L175-L186) - `AgentState` and `AgentHealth`: three states and one health slot"
  - "[code://packages/sdk/src/agents/channel.ts#L299-L306](../../packages/sdk/src/agents/channel.ts#L299-L306) - an agent's state: an agent that did not open is `invalid`, as a config that does not fit is"
  - "[code://packages/sdk/src/agents/channel.ts#L326-L338](../../packages/sdk/src/agents/channel.ts#L326-L338) - the agent row, which carries `health`"
  - "[code://packages/sdk/src/agents/channel.ts#L526-L542](../../packages/sdk/src/agents/channel.ts#L526-L542) - a failed open writes over the health slot"
  - "[code://packages/sdk/src/agents/channel.ts#L944-L980](../../packages/sdk/src/agents/channel.ts#L944-L980) - `check` writes over the same slot with the probe's answer"
  - "[code://packages/sdk/src/types/connectors.ts#L258-L266](../../packages/sdk/src/types/connectors.ts#L258-L266) - `ConnectorHealth`: the last check, the last call and the last failure"
  - "[code://packages/sdk/src/connectors/channel.ts#L392-L400](../../packages/sdk/src/connectors/channel.ts#L392-L400) - a connector's state, which reads the health's check"
  - "[code://packages/sdk/src/connectors/channel.ts#L416-L431](../../packages/sdk/src/connectors/channel.ts#L416-L431) - the connector row, which carries `health`"
  - "[code://packages/sdk/src/types/plugin.ts#L788-L809](../../packages/sdk/src/types/plugin.ts#L788-L809) - `Alert`: a level, a text and a `ref` that replaces and clears"
  - "[code://packages/server/src/plugins.ts#L2331](../../packages/server/src/plugins.ts#L2331) - `PluginState`, which has `disabled`"
  - "[code://packages/sdk/src/types/tunnels.ts#L98-L99](../../packages/sdk/src/types/tunnels.ts#L98-L99) - a tunnel record stores `enabled`"
  - "[code://packages/sdk/src/tunnels/channel.ts#L20-L30](../../packages/sdk/src/tunnels/channel.ts#L20-L30) - the tunnels channel's `enable` and `disable`"
  - https://github.com/microsoft/vscode/blob/1564f100807a/src/vs/platform/agentHost/common/agentHostSchema.ts#L892-L897 - `codexAgentEnabled`, the root key that turns the Codex agent on and off
  - https://github.com/microsoft/vscode/blob/1564f100807a/src/vs/platform/agentHost/node/agentService.ts#L2734-L2742 - a disabled agent stays registered and hosts no new chat or session
---

# An agent or connector turns off, and lists its alerts

Softov wants to turn an agent record off and on, and a connector record too.
He also wants each problem of an agent or a connector reported on its own.
Today a row has one `health`, so a second problem writes over the first.
The plugins channel already reports problems as a list of alerts, and that is the model to follow.

## What others do

- **VS Code** turns the Codex agent on and off with the root key [`codexAgentEnabled`](https://github.com/microsoft/vscode/blob/1564f100807a/src/vs/platform/agentHost/common/agentHostSchema.ts#L892-L897), default `false`.
- A Codex agent that is turned off after the host starts stays registered and [hosts no new chat or session](https://github.com/microsoft/vscode/blob/1564f100807a/src/vs/platform/agentHost/node/agentService.ts#L2734-L2742).
- VS Code has one key per agent kind. It has no record per agent, so it has no switch per record.

## What ahpd has today

### Turning a record off

- Agent and connector records have no `enabled` field. The only way to stop one is to remove it.
- A tunnel record stores `enabled` ([`code://packages/sdk/src/types/tunnels.ts`](../../packages/sdk/src/types/tunnels.ts#L98-L99)).
- The tunnels channel has `enable` and `disable`: `disable` stops the tunnel and sets `enabled` false, and `enable` sets it true and starts it ([`code://packages/sdk/src/tunnels/channel.ts`](../../packages/sdk/src/tunnels/channel.ts#L20-L30)).
- A plugin row has the state `disabled`, and the plugins channel has `enable` and `disable` with the grants `plugin:enable` and `plugin:disable` ([`code://packages/server/src/plugins.ts`](../../packages/server/src/plugins.ts#L2331)).
- A removed agent record ends every session on that agent first, through `endSessionsOf` ([`code://packages/sdk/src/agents/channel.ts`](../../packages/sdk/src/agents/channel.ts#L120-L121)).
- The agents channel's grants are `agent:list`, `agent:put` and `agent:remove`. The connectors channel's grants are `connector:list`, `connector:put`, `connector:remove` and `connector:all`.

### One health slot

- An agent's state is `ready`, `invalid` or `unavailable` ([`code://packages/sdk/src/types/agents.ts`](../../packages/sdk/src/types/agents.ts#L175-L186)).
- An agent whose open failed is `invalid`, the same state as an agent whose config does not fit its engine's schema ([`code://packages/sdk/src/agents/channel.ts`](../../packages/sdk/src/agents/channel.ts#L299-L306)).
- `AgentHealth` is one `result`, one `message` and one `at`. A failed open writes it ([`code://packages/sdk/src/agents/channel.ts`](../../packages/sdk/src/agents/channel.ts#L526-L542)), and `check` writes over it with the probe's answer ([`code://packages/sdk/src/agents/channel.ts`](../../packages/sdk/src/agents/channel.ts#L944-L980)).
- So an agent with a missing key and a failed probe shows one of the two.
- `ConnectorHealth` has three slots: the last `check`, the last call and the last failed call ([`code://packages/sdk/src/types/connectors.ts`](../../packages/sdk/src/types/connectors.ts#L258-L266)).
- A connector's state is `unauthorized` when its last check was `denied` ([`code://packages/sdk/src/connectors/channel.ts`](../../packages/sdk/src/connectors/channel.ts#L392-L400)).
- Health is in memory only, for agents and connectors. A restart clears it.

### Alerts

- A plugin reports a problem as an `Alert`: a `level` (`notice`, `info`, `warning` or `error`), a `text` of one sentence, and an optional `ref` ([`code://packages/sdk/src/types/plugin.ts`](../../packages/sdk/src/types/plugin.ts#L788-L809)).
- An alert with the same `ref` replaces the one before it, and clearing a `ref` removes it. An alert with no `ref` is never replaced.
- An `Alert` has no time.
- ahpw draws a plugin's alerts in `src/resources/plugins/Overview.tsx` and `src/resources/plugins/rows.ts`.

### Clients

- ahpw reads `health` in `src/bridges/agents.ts` and `src/bridges/connectors.ts`, and draws it in `src/resources/agents/Overview.tsx`, `src/resources/agents/Page.tsx`, `src/resources/connectors/Overview.tsx` and `src/resources/connectors/SignInStep.tsx`.
- ahpw's connector pages draw `health.check` and `health.lastFailure`. No page draws `health.lastCall`.
- ahpw's `ConnectorHealth` also declares `quotaSnapshots` and `account`. No ahpd code writes them into `health`: the Claude login draws its quota in its own view ([`code://packages/agent-claude/src/views.ts`](../../packages/agent-claude/src/views.ts#L115)).
- ahpc does not read `health`.

## Who writes

- **MayCXC's fork.** `maycxc/plugin/54-webhook-real-senders` changes `packages/sdk/src/connectors/channel.ts` and `packages/sdk/src/types/connectors.ts`, and is not merged. `maycxc/union-2026-10-30-0c75e15c` and `maycxc/union-2026-10-30-69c27900` change `packages/sdk/src/connectors/channel.ts`. Whichever lands later merges the other.
- **ahpw.** Its agent and connector pages read `health`. The change removes `health`, so ahpw changes in the same release.
- No open branch of `softov/ahpd` changes these files at `6f4ee6ff6`.

## The change

### Turning a record off

- An agent record and a connector record store `enabled`. A record with no `enabled` is on.
- The agents and connectors channels each get `enable` and `disable`, as the tunnels channel has.
- `enable` and `disable` take the grants `agent:put` and `connector:put` (Softov, 2026-11-10).
- A disabled record is not opened: the host builds no backend, runs no probe and reads no secret.
- A disabled record's row has the state `disabled`, as a plugin row has.
- A new session cannot choose a disabled agent.
- A session that already uses a disabled agent keeps its history (Softov, 2026-11-10).
- A new message in that session is refused with one line that says the agent is off. Turning the agent on again lets the session continue.
- A disabled connector answers no call, and offers no models.

### Alerts in place of health

- An agent row and a connector row carry `alerts`, a list of `Alert`, in place of `health` (Softov, 2026-11-10).
- Each problem is its own alert with its own `ref`, such as `open`, `probe`, `check`, `call` or `env:<VARIABLE>`.
- A fixed problem clears its `ref`, so the list holds only what is wrong now.
- A connector's last failed call becomes the alert `call`, which the next call that works clears. The last call that worked leaves the row, because no client draws it (defaulted: no client reads it).
- ahpw drops `quotaSnapshots` and `account` from its `ConnectorHealth`, because ahpd never sends them there.
- `Alert` gets an optional `at`, the time it was raised, so plugin alerts carry it too (Softov, 2026-11-10).
- A record that fits its schema but does not open gets the state `failed`, and its alert says why (Softov, 2026-11-10).
- `invalid` then means only a config that does not fit its schema.
- The connectors channel gets `failed` too, because its state mixes the same two cases (defaulted: the sibling channel follows).
- `state` is `ready`, `invalid`, `failed`, `unavailable` or `disabled`, and `unauthorized` for a connector.
- One brief covers both parts, because both change the row shape of the same two channels, and ahpw's pages change once (Softov, 2026-11-10).

## Open points

- What a session on an agent that is not open shows today, when a person sends a message in it. The plan checks it with a test, because `disable` must keep the session.
