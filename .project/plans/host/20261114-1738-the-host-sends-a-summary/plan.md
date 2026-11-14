---
title: The host sends a summary
domain: host
status: built
priority: medium
created: 2026-11-14
revalidated: 2026-11-14
refs:
  - git://3f11a2751 - the commit of ahpd main the plan was checked at
  - git://76bcb33a7 - the last commit that holds the brief `the-host-sends-a-summary`
  - "[code://packages/sdk/src/resources/recordschannel.ts#L84-L104](../../../../packages/sdk/src/resources/recordschannel.ts#L84-L104) - `RecordsChannel`, which gets the listing the summary reads"
  - "[code://packages/sdk/src/resources/recordschannel.ts#L142-L146](../../../../packages/sdk/src/resources/recordschannel.ts#L142-L146) - `readable`, the one test of whether a reader sees a row"
  - "[code://packages/sdk/src/resources/recordschannel.ts#L285-L296](../../../../packages/sdk/src/resources/recordschannel.ts#L285-L296) - `step`, which reads nothing when the list has no subscriber"
  - "[code://packages/sdk/src/resources/recordschannel.ts#L443-L460](../../../../packages/sdk/src/resources/recordschannel.ts#L443-L460) - `servedRecords`, which serves the daemon's own channels"
  - "[code://packages/sdk/src/tunnels/channel.ts#L449-L457](../../../../packages/sdk/src/tunnels/channel.ts#L449-L457) - the tunnels channel, built by hand over a records channel"
  - "[code://packages/sdk/src/clients/channel.ts#L203-L212](../../../../packages/sdk/src/clients/channel.ts#L203-L212) - the clients channel, which spreads its records channel"
  - "[code://packages/sdk/src/connectors/channel.ts#L669-L678](../../../../packages/sdk/src/connectors/channel.ts#L669-L678) - `scheduleNoteRefresh`, the once a second send this plan copies"
  - "[code://packages/sdk/src/types/plugin.ts#L829-L835](../../../../packages/sdk/src/types/plugin.ts#L829-L835) - `Alert` and its four levels"
  - "[code://packages/server/src/commands/run.ts#L1202-L1206](../../../../packages/server/src/commands/run.ts#L1202-L1206) - where the daemon serves its channels"
  - "[code://docs/plugins/PLUGINS.md#L1891-L1907](../../../../docs/plugins/PLUGINS.md#L1891-L1907) - `x-ahpd-clients`, the section the summary's section follows"
  - https://github.com/microsoft/vscode/blob/1564f100807a/src/vs/platform/agentHost/common/state/protocol/channels-annotations/state.ts#L11-L31 - `AnnotationsSummary`, a channel URI and counts so badge UI renders without a subscribe
---

## Goal

A client shows a badge on an activity bar item when something in that area needs attention.
Examples are a plugin that is down and a connector with an alert.
The host sends one summary on a new channel, `x-ahpd-summary`.
For each area it holds the total, the counts by state and the alerts grouped by text.
Each reader gets counts of only the rows they may read.
Rows keep their own alerts.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.
The brief `the-host-sends-a-summary` holds the research, and this plan replaces it.

### Searches performed

- `rg "recordsChannel\(|\.refresh\(\)" packages/*/src` - each area calls `refresh` when a row changes, and `notify` sends only view data.
- `rg ": RecordsChannel = \{" packages` - the tunnels channel is the one records channel built by hand.
- `git diff --name-only origin/main...<branch>` over the maycxc branches and the local branches - no other branch changes these files.

### Runtime path

```
row change -> area refresh -> listing tells the summary -> one second -> rows read -> counts per reader -> x-ahpd-summary/changed -> badge
```

### Gaps

- A refresh tells only that channel's readers.
- A refresh with no subscriber reads nothing, so the summary reads the rows itself.
- No channel or command answers a count for an area.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A client subscribes to the summary | Softov, 2026-11-14: "a client need to subscribe" | 02 |
| The host sends one second after a change, so a burst is one send | Softov, 2026-11-14: "the server send it with a delay after something changes. like 1 second. so multiple changes can be batched" | 02 |
| The areas are plugins, connectors, agents, tunnels and clients | Softov, 2026-11-14: "Plugins, Connectors, Agents, Tunnels, clients" | 03 |
| Each reader gets counts of the rows they may read | Softov, 2026-11-14: "Counts per reader" | 01, 02 |
| Rows keep their own alerts, and the summary groups them | Softov, 2026-11-14: "its not to replace things" | 02 |
| The alerts are one group for each level and text, with the count and the rows | Softov, 2026-11-14: "Grouped by text, with rows" | 02 |
| The summary is not in root `_meta` | Softov, 2026-11-14: "sending the full root when just something changed?" | 02 |
| The channel is `x-ahpd-summary://` | (defaulted: the name follows the other `x-ahpd-` channels) | 02 |
| An area the reader may not open is absent, not zero | (defaulted: a zero says the area is empty) | 02 |
| Each send carries the whole summary | (defaulted: it is a few numbers for each area) | 02 |
| A constant stream of changes sends once a second | (defaulted: as the connectors channel sends a call's changes) | 02 |
| The groups take the levels `error`, `warning`, `info` and `notice`, worst first | [code://packages/sdk/src/types/plugin.ts#L831](../../../../packages/sdk/src/types/plugin.ts#L831) | 02 |
| A reader is sent the summary only when their counts changed | (defaulted: the clients list refreshes each 5 seconds for its counters) | 02 |
| Every connection may subscribe, and the areas narrow what it sees | (defaulted: the `x-ahpd/me` command lets every connection in the same way) | 02 |
| The channel names `summary:read`, and the daemon lists a `summary` subject for it | (defaulted: a grant no entry of `ahpd.grants` lists is said at each start, as `client` and `tunnel` are listed) | 03 |

## Proposed architecture

- **Data flow** - each records channel gets a `listing`. It answers the rows, who opens the list and who sees a row, and it calls a listener on each refresh.
- **Event flow** - a refresh calls the listeners. The summary marks the area changed and starts a one second timer if none runs.
- **State flow** - the summary keeps the last rows of each area and the last summary sent to each reader. When the timer ends, it reads the changed areas again and sends each reader whose counts moved.
- **Layer responsibilities** - sdk: the listing and the summary channel · server: the five areas and the serve · docs: the channel's section.
- **Source-of-truth files** - [`code://packages/sdk/src/summary/channel.ts`](../../../../packages/sdk/src/summary/channel.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - a-records-channel-has-a-listing](task-01-a-records-channel-has-a-listing.md) | done | - |
| [02 - the-summary-channel](task-02-the-summary-channel.md) | done | 01 |
| [03 - the-daemon-serves-the-summary](task-03-the-daemon-serves-the-summary.md) | done | 02 |

## Risks and tradeoffs

- A change to a reader's grants is not a refresh, so their summary waits for the next change. The next refresh of any area sends it again.
- The plugins rows read their manifests, so a summary read costs one more read of the plugins list. It happens at most once a second, and only while the summary has a subscriber.

## Resume state

- **Done so far:** tasks 01 to 03 done on 2026-11-14, as [implemented.md](implemented.md) says. Softov validated the build with the ahpw badges.
- **Next action:** none.
- **Open questions:** none.
- **Watch out for:** the tunnels channel lists the records channel's fields by hand, so it must pass `listing` on.

## Final verification checklist

- [x] `pnpm typecheck` passes.
- [x] The sdk suite passes, with the new summary cases.
- [x] The server suite passes.
- [x] A daemon from this branch answers a subscribe to `x-ahpd-summary://` with the five areas.
