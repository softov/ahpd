---
title: A plugin names a brand mark the host ships
domain: plugin
status: built
priority: medium
created: 2026-10-26
revalidated: 2026-10-26
requires:
  - plans/plugin/58-plugins-and-adapters-carry-icons/plan.md
changes: []
creates: []
refs:
  - "[code://packages/server/src/icons.ts#L82](../../../../packages/server/src/icons.ts#L82) - `resolveIcons`, which turns a file, an `https:` URL or a `data:` URI into a `data:` icon"
  - "[code://packages/server/src/proxy/adapters.ts#L268-L282](../../../../packages/server/src/proxy/adapters.ts#L268-L282) - the pattern: the proxy adapters read their marks from `packages/server/icons/`, with a dark file for OpenRouter"
  - "[code://packages/server/src/plugins.ts#L1515-L1521](../../../../packages/server/src/plugins.ts#L1515-L1521) - where an adapter's icons are resolved at load"
  - "[code://packages/sdk/src/connectors/adapters.ts#L51-L60](../../../../packages/sdk/src/connectors/adapters.ts#L51-L60) - `rowOf`, which sends no `icons` for an adapter with none"
  - "[code://packages/sdk/src/agents/engines.ts#L56-L66](../../../../packages/sdk/src/agents/engines.ts#L56-L66) - the pattern: an engine with no icons is sent with its plugin's"
  - "[code://packages/activepieces/src/logos.ts#L96](../../../../packages/activepieces/src/logos.ts#L96) - `logoOf`, which reads the cache and then the CDN"
  - "[code://packages/activepieces/src/plugin.ts#L383-L390](../../../../packages/activepieces/src/plugin.ts#L383-L390) - where each piece's logo is asked for and given to its adapter"
  - "[code://packages/sdk/src/types/agents.ts#L28-L40](../../../../packages/sdk/src/types/agents.ts#L28-L40) - `AgentTemplate`, with one `icon`"
  - "[code://packages/sdk/src/agents/channel.ts#L265](../../../../packages/sdk/src/agents/channel.ts#L265) - the agents channel row, which sends a record's own `icon`"
  - "[code://packages/agent-acp/src/presets.ts#L272-L291](../../../../packages/agent-acp/src/presets.ts#L272-L291) - `templates`, which give an ACP row no icon"
  - "[code://.project/pending/plugin-58-icon-curation.md](../../../pending/plugin-58-icon-curation.md) - the curation table the new marks join"
  - https://simpleicons.org - brand marks under CC0 1.0
  - file:///github/ahp-review/briefs/shared-marks.md - the brief, with the answers this plan builds
  - file:///github/ahp-review/briefs/acp-agent-icons.md - the brief for the ACP agents, merged into this plan
---

## Goal

One WhatsApp mark serves every plugin that needs it: an Activepieces piece, a native WhatsApp plugin and a bot channel show the same icon.
The host ships a small set of brand marks, and a plugin names one with `mark:<name>` instead of shipping a file.
Each ACP agent shows its vendor's mark, and Softov's existing ACP records get it with no edit.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "mark:" packages/server/src packages/sdk/src` - no scheme for a host mark.
- `rg -n "icon" packages/agent-acp/src` - no ACP template carries an icon.
- `rg -n "resolveIcons" packages` - the loader resolves manifest and adapter icons, and nothing resolves an engine template's icon.
- `ls packages/server/icons` - `anthropic`, `openai`, `openai-compatible`, `openrouter` and `openrouter-dark`.

### Runtime path

```
manifest or Adapter.icons { src: "mark:whatsapp" } -> resolveIcons -> packages/server/icons/whatsapp.svg (+ whatsapp-dark.svg) -> data: icons -> channel row -> client
activepieces piece -> mark table -> { src: "mark:<name>" } -> adapter icons, no CDN fetch
acp template { icon: { src: "mark:<name>" } } -> loader resolves -> template icons -> engines row; a record with no icon -> its template's icons -> agents row
```

### Gaps

- `resolveIcons` knows no `mark:` source.
- An adapter with no icon is sent with none, though its plugin has one.
- The Jira, Linear, Resend and WhatsApp CDN logos are over 32 KB, so those pieces show no icon.
- An ACP template has no icon, and a record written by the move from presets has none.
- A template and a record carry one icon, so a dark variant has no place.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The marks live in `packages/server/icons/`, the folder the server already ships | file:///github/ahp-review/briefs/shared-marks.md | 01 |
| A plugin names a mark as `{ "src": "mark:<name>" }`, in the manifest or in `Adapter.icons` | file:///github/ahp-review/briefs/shared-marks.md | 01 |
| The scheme is `mark:` | (defaulted: no other name was proposed) | 01 |
| Where `<name>-dark.svg` exists, the host also sends it with `theme: "dark"` | file:///github/ahp-review/briefs/shared-marks.md | 01 |
| An unknown mark is one problem line, and the next step of the fallback | file:///github/ahp-review/briefs/shared-marks.md | 01 |
| Each mark is copied by hand, with no `simple-icons` dependency, and Softov curates it in the pending file | file:///github/ahp-review/briefs/shared-marks.md | 01, 04 |
| Any plugin may name a host mark, not only the plugins in this repository | Softov, 2026-10-26 | 01 |
| An adapter with no icon is sent with its plugin's icon, then the client's blank square | file:///github/ahp-review/briefs/shared-marks.md | 02 |
| A piece that maps to a mark shows the mark and does not fetch its CDN logo. A piece with no mark keeps its CDN logo | Softov, 2026-10-26 | 03 |
| Plan 58 task 06 is replaced by task 03, and its four SVGs go into the host's set | file:///github/ahp-review/briefs/shared-marks.md | 01, 03 |
| The ACP agent icons are part of this plan | Softov, 2026-10-26 | 04 |
| A template and a record keep one `mark:` icon. The host sends the light file and, where one exists, the dark file | Softov, 2026-10-26 | 04 |
| A record with no icon is sent with the icons of its template. Nothing on disk changes, and a record's own icon wins | Softov, 2026-10-26 | 04 |
| The engine names a record's template with `templateOf`, and the host matches by `command` only for an engine with none | Softov, 2026-10-26: "Engine answers" | 05 |
| A template carries the resolved icons in a new `icons` list, and the agents channel row carries `icons` beside `icon` | (defaulted: a mark with a dark file is two icons, and `icon` stays for clients that read it) | 04 |
| An ACP row with no mark from Simple Icons or its vendor gets no icon, and the engine's icon is drawn | (defaulted: the fallback a record has today) | 04 |
| dsh needs a mark from Softov | file:///github/ahp-review/briefs/acp-agent-icons.md | 04 |
| Resend and GitHub get a dark file in `#E6EDF3`, and the GitHub piece maps to a `github` mark | Softov, 2026-10-26: "Resend and github are dark colors" | 06 |

## Proposed architecture

- **Data flow** - a `mark:` source resolves in the server, at load, into one `data:` icon, or two with a dark file. A client receives `data:` URIs as it does today.
- **State flow** - nothing new is stored. The marks are files in the server package.
- **Layer responsibilities** - server holds the marks, resolves `mark:` and resolves template icons at load.
  sdk sends the adapter fallback and the agents row.
  activepieces holds the piece to mark table, and agent-acp gives each template a `mark:` icon.
- **Source-of-truth files** - [`code://packages/server/src/icons.ts`](../../../../packages/server/src/icons.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The host resolves a mark](task-01-the-host-resolves-a-mark.md) | done | - |
| [02 - An adapter falls back to its plugin's icon](task-02-an-adapter-takes-its-plugin-icon.md) | done | - |
| [03 - An Activepieces piece shows its mark](task-03-a-piece-shows-its-mark.md) | done | 01 |
| [04 - An ACP agent shows its vendor's mark](task-04-an-acp-agent-shows-its-mark.md) | done | 01 |
| [05 - The engine names the template a record runs](task-05-the-engine-names-a-record-s-template.md) | done | 04 |
| [06 - Black marks get a dark file, and GitHub gets a mark](task-06-black-marks-get-a-dark-file.md) | done | 03 |

## Risks and tradeoffs

- The marks are the brands' trademarks. The Simple Icons data is CC0 1.0, and the docs say that a mark stays its brand's.
- A record with no icon takes the template its engine names. An ACP record whose `id` and `base` name no shipped row keeps the engine's icon.
- ahpw draws `[record.icon]` today. It must read the row's `icons` first, or a record shows no dark file. That change is in ahpw, outside this plan.

## Resume state

- **Done so far:** tasks 01-04 are merged in #102, and tasks 05 and 06 in #104. Softov passed the checks by hand on 2026-11-04. See [implemented.md](implemented.md).
- **Next action:** none. The plan is built.
- **Open questions:** none. What waits is in [deferred.md](deferred.md).
- **Watch out for:** ahpw must read a row's `icons` before `icon`, or a record shows no dark file.

## Final verification checklist

- [x] `{ "src": "mark:whatsapp" }` in a manifest gives a `data:image/svg+xml` icon in the plugins channel row.
- [x] The GitHub, Jira, Linear, Resend and WhatsApp connectors show their marks, and the CDN is not fetched for them.
- [x] The Resend and GitHub marks read in ahpw's dark theme.
- [x] A webhook connector with no adapter icon shows the webhook plugin's icon.
- [x] Softov's existing Codex record shows the OpenAI mark in ahpw, in light and dark.
- [x] Each new mark has a row in `.project/pending/plugin-58-icon-curation.md`.
- [x] `plans/index.md` updated.
