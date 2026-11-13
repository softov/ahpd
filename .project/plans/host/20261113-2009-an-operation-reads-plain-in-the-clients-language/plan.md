---
title: An operation reads plain, in the client's language
domain: host
status: planned
priority: high
created: 2026-11-13
revalidated: 2026-11-13
requires: []
changes: []
creates: []
refs:
  - git://045197d4f - the commit of ahpd this plan was checked at
  - "[code://.project/briefs/the-text-a-person-reads-is-plain.md](../../../briefs/the-text-a-person-reads-is-plain.md) - the brief; its *Operations* section is this plan's source, with Softov's edits to the text table"
  - "[code://packages/sdk/src/agents/channel.ts#L1235-L1241](../../../../packages/sdk/src/agents/channel.ts#L1235-L1241) - an agent row's operations"
  - "[code://packages/sdk/src/connectors/channel.ts#L1737-L1766](../../../../packages/sdk/src/connectors/channel.ts#L1737-L1766) - a connector row's operations"
  - "[code://packages/sdk/src/tunnels/channel.ts#L315-L366](../../../../packages/sdk/src/tunnels/channel.ts#L315-L366) - a tunnel row's operations, with the label and the question that name the kind"
  - "[code://packages/sdk/src/tunnels/channel.ts#L390-L393](../../../../packages/sdk/src/tunnels/channel.ts#L390-L393) - `publishOperations`, one action to every subscriber"
  - "[code://packages/sdk/src/clients/channel.ts#L112-L122](../../../../packages/sdk/src/clients/channel.ts#L112-L122) - a client row's Drop operation"
  - "[code://packages/sdk/src/clients/channel.ts#L164-L169](../../../../packages/sdk/src/clients/channel.ts#L164-L169) - the clients snapshot, which lists the operations beside the records"
  - "[code://packages/sdk/src/resources/recordschannel.ts#L69-L77](../../../../packages/sdk/src/resources/recordschannel.ts#L69-L77) - `translate`, a record in the locale of the client it is sent to"
  - "[code://packages/sdk/src/types/plugin.ts#L394-L399](../../../../packages/sdk/src/types/plugin.ts#L394-L399) - `ChannelHandle.localeOf`, the last locale a client sent"
  - "[code://packages/sdk/src/i18n.ts#L48-L70](../../../../packages/sdk/src/i18n.ts#L48-L70) - `translated`, a field path in the plugin's catalogs and then the host's"
  - "[code://packages/sdk/src/plugins/plugins.ts#L504](../../../../packages/sdk/src/plugins/plugins.ts#L504) - an agent keeps its plugin's catalogs, the pattern a tunnel kind copies"
  - "[code://packages/sdk/src/plugins/plugins.ts#L658-L669](../../../../packages/sdk/src/plugins/plugins.ts#L658-L669) - the fold of the tunnel kinds"
  - "[code://packages/tunnel-devtunnel/src/kind.ts#L121-L152](../../../../packages/tunnel-devtunnel/src/kind.ts#L121-L152) - the Dev Tunnel's own operations"
---

## Goal

Every button on a record row reads as plain text, in the language the client sent, before 0.15.0.
The label is the button, the description is its tooltip, and the confirmation is the question before it runs.
Today most descriptions tell how the code works, and four tunnel buttons have no tooltip.
The tunnel's remove question says "tunnel" twice, and all of the text is English.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "operationsOf" packages/sdk/src` - agents, connectors, tunnels and clients declare operations. Only tunnels and clients put the list in their snapshot.
- `rg "and answers its row" packages/sdk/src` - the agent and connector toggles' method descriptions. ahpw shows them as the tooltip because the agent and connector snapshots list no operations.
- ahpw at `c9120aa`, `src/resources/agents/Explorer.tsx` and `src/resources/connectors/Explorer.tsx`: when the channel's state has `operations`, ahpw draws the host's label and description. It keeps its own words only for a host that lists none.
- `rg "localeOf" packages/sdk/src` - a plugin channel reads a client's locale through its handle, and the records channel already translates a record with it.

### Runtime path

```
subscribe x-ahpd-<list>:// -> snapshot(asked, reader, client) -> { records, operations } -> ahpw draws a button per row id
```

### Gaps

- The agent and connector snapshots list no operations, so ahpw falls back to its own words and to the method descriptions.
- No operation text is in a catalog, and no channel translates an operation.
- `x-ahpd-tunnels/operations` is one action for every subscriber, so it cannot carry two languages.
- A tunnel kind does not keep its plugin's catalogs, so the tunnel channel cannot translate a kind's own operations.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The text is fixed before 0.15.0 | Softov, 2026-11-12 | 01, 02 |
| A tunnel's labels are the plain verb, "Edit" and "Remove" | Softov, 2026-11-13 | 01 |
| A plugin kind's own operations are in scope, through the plugin's catalogs | Softov, 2026-11-13 | 02 |
| The English and Portuguese text is the brief's table, with Softov's edits of 2026-11-13 | the brief's *The text, for Softov's review* | 01, 02 |
| The Spanish is the text in this plan's tasks | `(defaulted: the brief puts the Spanish in the plan)` | 01, 02 |
| A key is `operations.<row>.<id>.<field>`, such as `operations.agent.disable.description`. A tunnel's host operation uses the name after the kind, such as `operations.tunnel.remove.label` | `(defaulted: a catalog is keyed by field path)` | 01 |
| A plugin kind's operation is keyed `operations.<id>.<field>` in its plugin's catalog | `(defaulted: the same field path, in the plugin's own catalog)` | 02 |
| The agent and connector snapshots list their operations, as the tunnel and client snapshots do | `(defaulted: ahpw draws the host's text when the list is there, so no ahpw change is needed)` | 01 |
| The method titles and descriptions of `x-ahpd/agents/*` and `x-ahpd/connectors/*` stay as they are | `(defaulted: command text is a later slice of the brief, and ahpw stops reading them once the operations are listed)` | 01 |
| The English labels stay, other than the tunnel's | `(defaulted: Softov's table changes descriptions and questions only)` | 01 |

## Proposed architecture

- **Data flow** - each channel builds its operations in English, as now. On the way out, a function puts each label, description and confirmation in the reader's locale, from the plugin's catalogs and then `HOST_CATALOGS`.
- **Event flow** - `x-ahpd-tunnels/operations` goes to each subscriber with `to`, in that subscriber's locale.
- **State flow** - unchanged. The channel keeps English, and only what it sends is translated.
- **Layer responsibilities** - the sdk's four channels and the fold; the Dev Tunnel plugin's catalogs.
- **Source-of-truth files** - [`code://packages/sdk/src/kinds/operations.ts`](../../../../packages/sdk/src/kinds/operations.ts) for the shared function.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The host's operations read plain, in the reader's language](task-01-the-hosts-operations-read-plain.md) | implemented | - |
| [02 - A tunnel kind's own operations read plain](task-02-a-tunnel-kinds-operations-read-plain.md) | implemented | 01 |

## Risks and tradeoffs

- ahpw stops showing its own Portuguese words for the agent buttons on a host with this change, and shows the host's. The host's words are the ones in this plan.
- A client that sent no locale gets English, as for every other translated text.
- A field path keeps its translation when the English changes, so a later English edit must update `pt` and `es` in the same commit.

## Resume state

- **Done so far:** tasks 01 and 02 implemented, 2026-11-13; see [implemented.md](implemented.md).
- **Next action:** Softov reviews the PR. The plan closes as `built` on his word.
- **Open questions:** none.
- **Watch out for:** the clients snapshot is not a records channel snapshot alone; it adds `operations` itself. The tunnel list's `servedOperations` adds connector choices to `create` and `update`, which must survive the translation.

## Final verification checklist

- [x] A snapshot of each of the four lists, for a client that sent `pt`, has every label, description and confirmation in Portuguese.
- [x] The same for `es`, and English for a client that sent no locale.
- [x] The agent and connector snapshots list their operations.
- [x] A tunnel's labels are "Edit" and "Remove", and its remove question names no kind.
- [x] The Dev Tunnel's four operations are in Portuguese for a `pt` client.
- [x] `pnpm typecheck`, and the sdk, server and tunnel-devtunnel suites, pass.
