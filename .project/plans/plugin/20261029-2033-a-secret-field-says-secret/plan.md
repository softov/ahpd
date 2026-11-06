---
title: A secret field says secret
domain: plugin
status: built
priority: medium
created: 2026-10-29
revalidated: 2026-10-29
refs:
  - git://5e2b7003 - the commit of `main` the facts were checked at
  - "[code://packages/sdk/src/channels/owners.ts#L128-L170](../../../../packages/sdk/src/channels/owners.ts#L128-L170) - `writeOnly` and `writeOnlyPaths`, which find the fields the host moves to the vault"
  - "[code://packages/sdk/src/connectors/channel.ts#L674-L775](../../../../packages/sdk/src/connectors/channel.ts#L674-L775) - a connector's secrets, its listing and its sign-in field"
  - "[code://packages/sdk/src/agents/channel.ts#L227-L231](../../../../packages/sdk/src/agents/channel.ts#L227-L231) - an agent's secrets"
  - "[code://packages/sdk/src/plugins/validate.ts#L42-L64](../../../../packages/sdk/src/plugins/validate.ts#L42-L64) - `CheckedSchema` and `gapsOf`, the problem lines a registration's schema gives"
  - "[code://packages/sdk/src/plugins/validate.ts#L638-L657](../../../../packages/sdk/src/plugins/validate.ts#L638-L657) - a sign-in field must be one the vault keeps"
  - "[code://packages/server/src/commands/config.ts#L53-L61](../../../../packages/server/src/commands/config.ts#L53-L61) - the configuration answer, which shows a `writeOnly` value as `<set>`"
  - "[code://packages/server/src/pluginschannel.ts#L49-L67](../../../../packages/server/src/pluginschannel.ts#L49-L67) - `secretsOf`, which takes credentials out of a served load problem"
  - "[code://packages/server/src/agents/migrate.ts#L473-L481](../../../../packages/server/src/agents/migrate.ts#L473-L481) - the migration reads `writeOnlyPaths`"
  - "[code://packages/server/src/proxy/adapters.ts#L80-L88](../../../../packages/server/src/proxy/adapters.ts#L80-L88) - `KEY`, the vendor key field"
---

## Goal

A field whose value the host keeps in the vault says `secret: true` in its schema.
A read of the record answers `{ "$secret": "<name>" }` for it, so a client shows the field as set.
`writeOnly` keeps its JSON Schema meaning: a value that a read never returns.
A plugin that still marks a vault field `writeOnly` keeps working, and its load gives a problem line.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "writeOnly" packages/*/src packages/*/package.json docs/plugins docs/sdk` - 38 files: the sdk helpers, the server masks, the first-party schemas and three docs.
- `rg -ln "writeOnly" packages/*/test` - 31 test files and fixtures name it.
- `rg -n "schemaGaps|gapsOf" packages/sdk/src` - a registration's schema already gives problem lines that never refuse it.

### Runtime path

```
plugin registerAdapter / registerAgent -> checkAdapter / checkEngine -> gaps: "writeOnly where the vault keeps it" when no `secret`
put connector or agent -> secretFields / secretPaths -> vault -> record { field: { $secret } }
list -> the record as kept -> the client draws the field as set
ahpd config / plugin list -> `<set>` for a `writeOnly` or a `secret` value
```

### Gaps

- One keyword says two things: "never returned" and "kept in the vault, returned as a reference".
- A client cannot tell from the schema that a read answers a reference in place of a string.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A value read back as a vault reference is a `secret`, not `writeOnly` | Softov, 2026-10-29: "writeOnly that returns a token for a vault is not writeOnly its a secret" | 01 |
| The keyword is `secret: true` on the property, not a `format` | (defaulted: `format` names a string's shape, and the read answers an object) | 01 |
| The host still reads `writeOnly` as a vault field when the node has no `secret` | (defaulted: a third-party plugin keeps its secrets out of the record) | 01 |
| A `writeOnly` vault field gives a problem line at load, and the load goes on | (defaulted: the gap lines `gapsOf` already writes) | 01 |
| The `<set>` mask and the load-problem mask read both keywords | (defaulted: a secret is never shown either) | 02 |
| A plugin option in `package.json` that the vault never holds stays `writeOnly` | (defaulted: its value is answered `<set>`, never as a reference) | 03 |
| Every first-party vault field and the docs say `secret` | (defaulted: the first-party plugins show the keyword) | 03 |

## Proposed architecture

- **Data flow** - `isSecret(node)` answers true for `secret: true`, or for `writeOnly: true` with no `secret`. `secretFields` and `secretPaths` read it. The vault and the record keep their shape.
- **Event flow** - none.
- **State flow** - none. A record written before this plan reads the same.
- **Layer responsibilities** - sdk: the helpers, the sign-in check and the problem line · server: the two masks and the migration · plugins: their schemas · docs: the keyword.
- **Source-of-truth files** - [`code://packages/sdk/src/channels/owners.ts`](../../../../packages/sdk/src/channels/owners.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The host reads secret](task-01-the-host-reads-secret.md) | done | - |
| [02 - The masks read both keywords](task-02-the-masks-read-both-keywords.md) | done | 01 |
| [03 - First-party schemas say secret](task-03-first-party-schemas-say-secret.md) | done | 01 |

## Risks and tradeoffs

- ahpw and ahpapp mask an input by `writeOnly`. After task 03, a first-party vault field shows as plain text in them until they read `secret`. Ideas in both repositories hold that work.
- A plugin can set both `secret: false` and `writeOnly: true`. The host then masks the value as `<set>` and does not move it to the vault.

## Resume state

- **Done so far:** all three tasks are implemented on `build/agents/7355891b`, and `implemented.md` says what was built and where it departed from the plan. The keywords, the fallback, the load-time problem line, the two masks, the first-party schemas, the docs and the tests are all in place.
- **Next action:** none. The plan is built, and `implemented.md` says what exists.
- **Open questions:** none.
- **Watch out for:** the cofold engine schema overrides `apiKey` with `secret: true` in `kindSchema`, because its `package.json` options stay `writeOnly` and the engine spreads them; task 03's Files list does not name that file. Task 03's Files list is also missing six test files that assert a vault field: the acp presets, the claude options schema, the pi engine, the openrouter sign-in, the activepieces pieces and the cofold engine. `packages/sdk/test/fixtures/wire.jsonl` is rewritten by the suite on every run and is left dirty in the worktree.

## Final verification checklist

- [ ] `pnpm typecheck` passes.
- [ ] `pnpm test` passes.
- [x] A connector with a `secret` field lists `{ "$secret": "<name>" }` for it. Checked on 2026-11-03: an `openrouter` put answered `{"$secret":"host:connector/secret-check/key"}`.
- [ ] A plugin whose adapter marks a vault field `writeOnly` loads, keeps the value in the vault, and gives one problem line.
- [x] `rg -n "writeOnly" packages/*/src` names only plugin options and the `writeOnly` fallback. Checked on 2026-11-03.
