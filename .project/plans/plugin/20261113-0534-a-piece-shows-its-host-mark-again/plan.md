---
title: A piece shows its host mark again
domain: plugin
status: planned
priority: high
created: 2026-11-13
revalidated: 2026-11-13
refs:
  - git://1ea68fcb8 - the commit that removed the table from piece to mark, with its cases and the docs sentence
  - git://f9ccec8a8 - the commit that set the logo limit back to 32 KB, without the marks
  - "[code://packages/activepieces/src/logos.ts#L136-L149](../../../../packages/activepieces/src/logos.ts#L136-L149) - `logoOf`, which reads the cache and then the CDN"
  - "[code://packages/activepieces/src/plugin.ts#L492-L495](../../../../packages/activepieces/src/plugin.ts#L492-L495) - where each piece's logo is asked for, by its adapter name"
  - "[code://packages/server/src/plugins.ts#L1636-L1642](../../../../packages/server/src/plugins.ts#L1636-L1642) - the host resolves each adapter's icons, a `mark:` source included"
  - "[code://packages/server/src/icons.ts#L176-L200](../../../../packages/server/src/icons.ts#L176-L200) - a `mark:<name>` source read from `packages/server/icons/`, with its dark file"
  - "[code://packages/activepieces/test/logos.test.ts](../../../../packages/activepieces/test/logos.test.ts) - the logo cases this plan adds to"
  - "[code://docs/plugins/activepieces.md#L15-L21](../../../../docs/plugins/activepieces.md#L15-L21) - *Each piece shows its logo*"
  - "[code://.project/pending/plugin-58-icon-curation.md](../../../pending/plugin-58-icon-curation.md) - the marks Softov curates, which asks whether the five marks stay"
  - https://cdn.simpleicons.org/postgresql - the PostgreSQL mark, CC0 1.0
---

## Goal

An Activepieces piece that has a host mark shows the mark again, as plan plugin/69 decided.
Jira Cloud, Linear, Postgres, Resend and WhatsApp publish logos over 32 KB, so today they show the plugin's Activepieces mark.
GitHub shows its black CDN logo, with no dark file for a dark theme.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `git log -S MARKS -- packages/activepieces/src/logos.ts` - `1751f6299` added the table, and `1ea68fcb8` removed it.
- `rg -n "mark:" packages --type ts` - the server still resolves `mark:` for an adapter, and only `agent-acp` names a mark.
- `ls ~/.config/ahpd/activepieces/icons/` on 2026-11-13 - the cached logos of Linear and WhatsApp are 76 KB, Jira Cloud 56 KB, Postgres 50 KB and Resend 48 KB.
- `ls packages/server/icons/` - marks for GitHub, Jira, Linear, Resend and WhatsApp exist. Postgres has none.

### Runtime path

```
plugin.ts load -> logoOf(<adapter name>) -> { src: "mark:<name>" } -> plugins.ts resolveIcons -> icons.ts markOf -> data: icon on the adapter -> client
```

### Gaps

- `logoOf` has no table from piece to mark, so a piece with a large logo has no icon.
- No mark for Postgres.
- No case fails when the table goes, or when it names a mark the host does not ship.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A piece with a host mark shows the mark, before the cache and the CDN, as plan plugin/69 task 03 had it | Softov, 2026-11-13: "Mark first" | 01 |
| The table maps `ap-github`, `ap-jira-cloud`, `ap-linear`, `ap-postgres`, `ap-resend` and `ap-whatsapp` | (defaulted: the five of plan plugin/69, and the one other piece of the dev config with a logo over 32 KB) | 01 |
| The Postgres mark is Simple Icons' `postgresql`, copied by hand, and Softov curates it in the curation file | (defaulted: the source and the curation of every other host mark) | 01 |
| A piece with no mark keeps its CDN logo, under the 32 KB limit of `f9ccec8a8` | [code://packages/activepieces/src/logos.ts#L37](../../../../packages/activepieces/src/logos.ts#L37) | 01 |

## Proposed architecture

- **Data flow** - `logoOf` looks up the adapter name in `MARKS`, and answers `{ icon: { src: "mark:<name>" } }` with no read. The host resolves the mark as it does for any adapter icon.
- **Layer responsibilities** - `packages/activepieces`: the table · `packages/server/icons`: the mark files · `docs/plugins/activepieces.md`: the rule.
- **Source-of-truth files** - [`code://packages/activepieces/src/logos.ts`](../../../../packages/activepieces/src/logos.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A piece takes its host mark](task-01-a-piece-takes-its-host-mark.md) | implemented | - |

## Risks and tradeoffs

- The six pieces show the host's drawing, not the logo Activepieces publishes. `1ea68fcb8` chose the piece's own logo, and the 32 KB limit makes that no icon for five of them.
- A piece that Activepieces adds later with a logo over 32 KB shows the plugin mark until it gets a row and a mark file.

## Resume state

- **Done so far:** task 01 is implemented on 2026-11-13, as [implemented.md](implemented.md) says.
- **Next action:** review the PR. Softov curates the Postgres mark in the curation file.
- **Open questions:** none.
- **Watch out for:** the table is keyed by the adapter name, `ap-<piece>`, not by the npm package. The mark names are lowercase letters, digits and `-`, as `icons.ts` checks.

## Final verification checklist

- [ ] `npx vitest run packages/activepieces` passes, with the new cases.
- [ ] `npx vitest run packages/server` passes.
- [ ] By hand, on a test daemon: the six pieces' adapters carry a `data:image/svg+xml` icon. GitHub and Resend carry a dark one too.
