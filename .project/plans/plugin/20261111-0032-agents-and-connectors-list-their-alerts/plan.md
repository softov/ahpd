---
title: Agents and connectors list their alerts
domain: plugin
status: planned
priority: medium
created: 2026-11-11
revalidated: 2026-11-11
refs:
  - git://6f4ee6ff6 - the commit of ahpd this plan was checked at
  - git://87b48bb6c - the last commit that holds the brief an-agent-or-connector-turns-off-and-lists-its-alerts, which this plan and its sibling cover
  - "[code://packages/sdk/src/types/plugin.ts#L788-L809](../../../../packages/sdk/src/types/plugin.ts#L788-L809) - `Alert`: a level, a text and a `ref`, with no time"
  - "[code://packages/server/src/plugins.ts#L1925-L1980](../../../../packages/server/src/plugins.ts#L1925-L1980) - `addAlert` and `dropAlert`, the list a plugin's row keeps, which the two channels reuse"
  - "[code://packages/server/src/pluginschannel.ts#L314-L342](../../../../packages/server/src/pluginschannel.ts#L314-L342) - how a plugin row serves its alerts, the shape these rows copy"
  - "[code://packages/sdk/src/channels/owners.ts#L386-L441](../../../../packages/sdk/src/channels/owners.ts#L386-L441) - `resolved`, which throws at the first missing variable or secret"
  - "[code://packages/sdk/src/types/agents.ts#L175-L186](../../../../packages/sdk/src/types/agents.ts#L175-L186) - `AgentState` and `AgentHealth`"
  - "[code://packages/sdk/src/agents/channel.ts#L299-L306](../../../../packages/sdk/src/agents/channel.ts#L299-L306) - an agent's state, where a failed open reads as `invalid`"
  - "[code://packages/sdk/src/agents/channel.ts#L326-L338](../../../../packages/sdk/src/agents/channel.ts#L326-L338) - the agent row, which carries `health`"
  - "[code://packages/sdk/src/agents/channel.ts#L526-L542](../../../../packages/sdk/src/agents/channel.ts#L526-L542) - a failed open writes the health slot"
  - "[code://packages/sdk/src/agents/channel.ts#L944-L980](../../../../packages/sdk/src/agents/channel.ts#L944-L980) - `check` writes the same slot with the probe's answer"
  - "[code://packages/sdk/src/types/connectors.ts#L258-L266](../../../../packages/sdk/src/types/connectors.ts#L258-L266) - `ConnectorHealth`: the last check, the last call and the last failed call"
  - "[code://packages/sdk/src/connectors/channel.ts#L392-L400](../../../../packages/sdk/src/connectors/channel.ts#L392-L400) - a connector's state, which reads the last check"
  - "[code://packages/sdk/src/connectors/channel.ts#L416-L431](../../../../packages/sdk/src/connectors/channel.ts#L416-L431) - the connector row, which carries `health`"
  - "[code://packages/sdk/src/connectors/channel.ts#L553-L645](../../../../packages/sdk/src/connectors/channel.ts#L553-L645) - `checkOne`, `note`, `close` and `openOne`, the four writers of a connector's health"
  - "[code://packages/server/src/proxy/listener.ts#L834](../../../../packages/server/src/proxy/listener.ts#L834) - the model proxy notes each call through the connectors channel, and does not change"
  - "[code://docs/plugins/PLUGINS.md#L1740-L1832](../../../../docs/plugins/PLUGINS.md#L1740-L1832) - the connectors channel's page, with `health`"
  - "[code://docs/plugins/PLUGINS.md#L1915-L1987](../../../../docs/plugins/PLUGINS.md#L1915-L1987) - the agents channel's page, with `health`"
---

## Goal

An agent row and a connector row list each of their problems as its own alert, in place of one `health`.
A person sees every problem at once: a missing key, a probe that failed and a call that failed, each with its time.
A record that fits its schema but does not open is `failed`, so `invalid` means only a config that does not fit.
ahpw's agent and connector pages read `health` today, and change to `alerts` in the same release.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "health" packages/sdk/src packages/server/src` - the agents and connectors channels write it, and the model proxy notes calls through the connectors channel.
- `rg -n "'invalid'" packages --glob '!**/test/**'` - only the two channels set or read the states.
- `rg -n "the environment holds no" packages` - `resolved` in `owners.ts` throws the first gap and stops.
- `rg -n "health" /github/ahpw/src` - ahpw reads `health` in its agent and connector bridges and pages; ahpc does not read it.
- `rg -n "quotaSnapshots" packages` - no ahpd code writes a quota or an account into `health`.

### Runtime path

```
open, probe, check, call -> channel's alert list for the record (by ref) -> row.alerts -> client page
resolved -> every gap of the record -> one alert per gap -> row.alerts
```

### Gaps

- One `health` slot per agent: a second problem writes over the first.
- A failed open and a config that does not fit are both `invalid`.
- `resolved` reports only the first missing variable or secret.
- `Alert` has no time, so a client cannot say when a problem was raised.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Rows carry `alerts`, a list of `Alert`, in place of `health` | Softov, 2026-11-10 | 02, 03 |
| `Alert` gets an optional `at`, so plugin alerts carry it too | Softov, 2026-11-10 | 01 |
| A record that fits its schema but does not open is `failed` | Softov, 2026-11-10 | 02, 03 |
| Connectors get `failed` too | (defaulted: the connectors channel mixes the same two cases) | 03 |
| The alert list logic of plugin rows moves to the sdk, and the three lists share it | (defaulted: one list with replace-by-ref, written once) | 01 |
| The host sets `at` when an alert arrives, and keeps one a plugin set | (defaulted: health's `at` was the host's clock) | 01 |
| A gap is an alert with ref `env:<VARIABLE>` or `secret:<name>`, level `error`; any other open failure is ref `open`, level `error` | (defaulted: one alert per thing a person fixes) | 02, 03 |
| A probe or a check that is not `ok` is ref `probe` for an agent and `check` for a connector, level `warning`, and `denied` is level `error` | (defaulted: `denied` makes the connector `unauthorized`) | 02, 03 |
| A failed call is ref `call`, level `warning`; the next call that works clears it | (defaulted: the list holds what is wrong now) | 03 |
| The last call that worked leaves the row | (defaulted: no client draws it) | 03 |
| Alerts are in memory only, as health was | (defaulted: a restart runs the opens and the checks again) | 02, 03 |

## Proposed architecture

- **Data flow** - each channel keeps an alert list per record id, built with the shared sdk list. A row serves `alerts` when the list is not empty.
- **Gaps** - `resolved` walks every field and throws one `RecordGaps` error that holds every gap. The channels turn each gap into its own alert.
- **State flow** - each channel keeps the ids whose open failed. `stateOf` answers `failed` for them. A connector keeps its last check result apart from its alerts, so `unauthorized` reads the result and not an alert.
- **Layer responsibilities** - sdk: `Alert.at`, the shared list, `RecordGaps`, both channels. server: plugin alerts use the shared list. ahpw: its own plan.
- **Source-of-truth files** - [`code://packages/sdk/src/types/plugin.ts`](../../../../packages/sdk/src/types/plugin.ts), [`code://packages/sdk/src/agents/channel.ts`](../../../../packages/sdk/src/agents/channel.ts), [`code://packages/sdk/src/connectors/channel.ts`](../../../../packages/sdk/src/connectors/channel.ts).

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - An alert says when, and a record says each gap](task-01-an-alert-says-when-and-each-gap.md) | todo | - |
| [02 - An agent row lists its alerts](task-02-an-agent-row-lists-its-alerts.md) | todo | 01 |
| [03 - A connector row lists its alerts](task-03-a-connector-row-lists-its-alerts.md) | todo | 01 |

## Risks and tradeoffs

- ahpw shows no problem of an agent or a connector until it reads `alerts` - ahpw's own plan ships in the same release. The release notes say so under *Upgrading*.
- A plugin that reads `health` from a row - none in this repository; the release notes name the change.
- A check in a loop could fill a list - each source has one `ref`. A list holds at most one alert per source and gap.

## Resume state

- **Done so far:** the plan, 2026-11-11.
- **Next action:** [task-01-an-alert-says-when-and-each-gap.md](task-01-an-alert-says-when-and-each-gap.md).
- **Open questions:** none.
- **Watch out for:**
The tunnels channel also calls `resolved`. The gap error's `message` stays the first gap's sentence, so a tunnel says what it says today.
When the vault fails, the agents channel keeps the last good view of an open record. That path raises no alert today; keep it that way.
`openFailures` exists in both channels already; it becomes the set `stateOf` reads for `failed`.

## Final verification checklist

- [ ] An agent record with two missing variables shows two `env:` alerts and the state `failed`.
- [ ] A probe that fails beside a missing key shows both alerts.
- [ ] A connector call that fails shows a `call` alert, and the next call that works clears it.
- [ ] No row carries `health`.
- [ ] `pnpm typecheck` passes, and the sdk and server suites pass, one at a time.
