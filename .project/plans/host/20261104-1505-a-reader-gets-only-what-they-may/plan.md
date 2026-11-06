---
title: A reader gets only what they may
domain: host
status: built
priority: high
created: 2026-11-04
revalidated: 2026-11-04
refs:
  - git://0538977c - the commit of ahpd the facts were checked at, and the last that holds the four problem files of this plan
  - git://0538977c - `problems/a-team-key-can-hold-a-grant-its-minter-does-not.md`, replaced by task 01
  - git://0538977c - `problems/a-removed-teams-keys-work-again-when-the-team-is-added-back.md`, replaced by task 02
  - git://0538977c - `problems/a-write-only-field-not-marked-secret-is-returned.md`, replaced by task 03
  - git://0538977c - `problems/the-bot-picker-lists-every-bot-to-any-client.md`, replaced by task 04
  - "[code://packages/sdk/src/access/tokens.ts#L157-L160](../../../../packages/sdk/src/access/tokens.ts#L157-L160) - `boundTeam` checks `user:write` only"
  - "[code://packages/server/src/commands/token.ts#L244-L248](../../../../packages/server/src/commands/token.ts#L244-L248) - the command bounds a team key by `user:write` only"
  - "[code://packages/sdk/src/access/users.ts#L1659-L1667](../../../../packages/sdk/src/access/users.ts#L1659-L1667) - `removeTeam` leaves the team's keys in the tokens file"
  - "[code://packages/sdk/src/access/users.ts#L1679-L1693](../../../../packages/sdk/src/access/users.ts#L1679-L1693) - `remove` drops a person's tokens: the pattern task 02 copies"
  - "[code://packages/sdk/src/connectors/channel.ts#L389-L392](../../../../packages/sdk/src/connectors/channel.ts#L389-L392) - `connectorRow` returns the whole record"
  - "[code://packages/sdk/src/channels/owners.ts#L144-L156](../../../../packages/sdk/src/channels/owners.ts#L144-L156) - `isSecret` and the top-level `secretFields`"
  - "[code://packages/sdk/src/plugins/validate.ts#L88-L110](../../../../packages/sdk/src/plugins/validate.ts#L88-L110) - `writeOnlyGaps`, the load warning, walks nested fields"
  - "[code://packages/bot/src/chat.ts#L1417-L1424](../../../../packages/bot/src/chat.ts#L1417-L1424) - the `bot` completion returns `store.all()`"
  - "[code://packages/bot/src/chat.ts#L1472-L1485](../../../../packages/bot/src/chat.ts#L1472-L1485) - `create` takes any bot the store holds"
  - "[code://packages/bot/src/provider.ts#L316-L323](../../../../packages/bot/src/provider.ts#L316-L323) - `mayRead`, which a `bot://` read checks"
  - "[code://packages/sdk/src/types/completions.ts#L21-L38](../../../../packages/sdk/src/types/completions.ts#L21-L38) - `SessionConfigAsk` names no reader"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L1664-L1685](../../../../packages/sdk/src/host/sessionmethods.ts#L1664-L1685) - the host calls an answerer, with `connection.principal` in reach"
  - "[code://packages/sdk/src/host/spawn.ts#L1030-L1035](../../../../packages/sdk/src/host/spawn.ts#L1030-L1035) - the `Start` a backend gets, built where `sender` is known"
---

## Goal

A caller never gets a credential, a value or a name that its grants do not cover.
The review of 2026-11-03 found four places where one does: a team key, a removed team's keys, a `writeOnly` connector field, and the bot picker.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "secretFields\(" packages/*/src` - connectors and tunnel kinds keep top-level secrets only.
- `rg -n "writeOnly" packages/*/src` - only the load warning and the plugin options mask read it.
- `rg -n "mayRead" packages/bot/src` - the catalogue and `bot://` reads check it, and the completion and `create` do not.

### Runtime path

```
token mint -> boundTeam -> tokens file
team remove -> users file, tokens file
connector list -> connectorRow -> client
completion -> SessionConfigAsk -> bot answerer -> client
session create -> Start -> bot create
```

### Gaps

- A team key carries `proxy:call`, and its minter needs only `user:write`.
- A team's keys stay in the tokens file after the team goes.
- A connector row returns a `writeOnly` value that is not secret.
- The bot picker and a new Bot chat do not check `mayRead`.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Fix the seven open problems of the review now | Softov, 2026-11-04, "7 open problems, fix now" | 01-04 |
| A team key's minter needs `proxy:call` as well as `user:write` | Softov, 2026-11-04, chose "Minter needs proxy:call" | 01 |
| `removeTeam` drops the tokens whose `team` is the id, as `remove` does for a person | (defaulted: the problem's one fix) | 02 |
| A connector row shows `<set>` for every non-empty `writeOnly` value, at any depth | (defaulted: the plan of the `secret` keyword says a read never returns a `writeOnly` value) | 03 |
| For a schema whose secrets are top-level, the load warning names a nested `writeOnly` node as masked, not as kept in the vault | (defaulted: connectors and tunnel kinds move top-level secrets only, so the vault sentence is false there) | 03 |
| `SessionConfigAsk` gets `reader`, the asking connection's principal | (defaulted: the problem's first fix) | 04 |
| `Start` gets `reader`, the principal of the sending connection, and the bot `create` refuses a bot the reader may not read | (defaulted: a start with no sender, such as a restart, has no reader and is not checked, as `trusted` is not) | 04 |

## Proposed architecture

- **Data flow** - the reader travels from the connection into `SessionConfigAsk` and `Start`, and the bot package checks `mayRead` against it.
- **State flow** - `removeTeam` writes the tokens file without the team's keys.
- **Layer responsibilities** - sdk: tokens, teams, connector rows, the ask and the start · server: the CLI bound · bot: the picker and `create`.
- **Source-of-truth files** - [`code://packages/sdk/src/access/users.ts`](../../../../packages/sdk/src/access/users.ts), [`code://packages/sdk/src/connectors/channel.ts`](../../../../packages/sdk/src/connectors/channel.ts), [`code://packages/bot/src/chat.ts`](../../../../packages/bot/src/chat.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - a team key needs proxy call](task-01-a-team-key-needs-proxy-call.md) | done | - |
| [02 - a removed team takes its keys](task-02-a-removed-team-takes-its-keys.md) | done | - |
| [03 - a write-only value is masked](task-03-a-write-only-value-is-masked.md) | done | - |
| [04 - the bot picker lists readable bots](task-04-the-bot-picker-lists-readable-bots.md) | done | - |

## Risks and tradeoffs

- A user administrator without `proxy:call` can no longer mint team keys. That is the point of task 01.
- A Bot chat restarted by the daemon is not checked against `mayRead`, because no connection asked for it.

## Resume state

- **Done so far:** tasks 01 to 04 are implemented on 2026-11-04. The six new cases fail without the change.
- **Next action:** none. The plan is built, and `implemented.md` says what exists.
- **Open questions:** none.
- **Watch out for:** nothing open.

## Final verification checklist

- [x] Each task's new cases fail without its change and pass with it.
- [x] `pnpm --filter @ahpd/sdk test`, `pnpm --filter @ahpd/server test` and `pnpm --filter @ahpd/bot test` pass, run one at a time.
- [x] `pnpm typecheck` and `pnpm boundary` pass.
