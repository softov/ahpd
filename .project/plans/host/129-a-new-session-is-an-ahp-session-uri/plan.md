---
title: A new session is an `ahp-session:` URI
domain: host
status: planned
priority: medium
created: 2026-10-27
revalidated: 2026-10-27
changes:
  - specs/sessions-and-chats.md
decisions:
  - decisions/a-new-session-is-held-under-the-protocols-uri.md
refs:
  - file:///github/ahp-review/briefs/session-uris.md - the brief this plan comes from, with Softov's answers of 2026-10-27
  - "[code://packages/sdk/src/host/sessionmethods.ts#L927-L953](../../../../packages/sdk/src/host/sessionmethods.ts#L927-L953) - `createSession`, which holds every session as `${provider}:/${idOf(given)}` and claims the client's URI as an alias"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L159](../../../../packages/sdk/src/host/sessionmethods.ts#L159) - `movedTo`, which names a session made for a moved chat `<provider>:/<backend id>`"
  - "[code://packages/sdk/src/host/changesets.ts#L270](../../../../packages/sdk/src/host/changesets.ts#L270) - `askModel`, which names its one-turn session `<provider>:/<uuid>`"
  - "[code://packages/sdk/src/host/automations.ts#L704-L707](../../../../packages/sdk/src/host/automations.ts#L704-L707) - `beginSession`, which names an automation's session `<provider>:/<uuid>`"
  - "[code://packages/sdk/src/host/tooling.ts#L1703-L1705](../../../../packages/sdk/src/host/tooling.ts#L1703-L1705) - the session tool's `create`, which names a child session `<provider>:/<uuid>`"
  - "[code://packages/sdk/src/sessions/nested.ts#L904-L945](../../../../packages/sdk/src/sessions/nested.ts#L904-L945) - the nested proxy, which creates `<provider>:/<id>` in the host inside a machine and already sends `provider`"
  - "[code://packages/sdk/src/host/spawn.ts#L574-L580](../../../../packages/sdk/src/host/spawn.ts#L574-L580) - `keepProvider`, which writes the provider when a session starts"
  - "[code://packages/sdk/src/host/spawn.ts#L1706-L1709](../../../../packages/sdk/src/host/spawn.ts#L1706-L1709) - `names.set(idOf(uri), uri)`, the name a started session is published under"
  - "[code://packages/sdk/src/host/catalogue.ts#L999-L1003](../../../../packages/sdk/src/host/catalogue.ts#L999-L1003) - `adopt`, which names a listed session `${provider}:/${row.id}`"
  - "[code://packages/sdk/src/host/catalogue.ts#L841-L862](../../../../packages/sdk/src/host/catalogue.ts#L841-L862) - one listed row per id, its agent picked from the stored provider"
  - "[code://packages/sdk/src/host/routing.ts#L41-L46](../../../../packages/sdk/src/host/routing.ts#L41-L46) - `spaceHere`, which takes a URI whose scheme is a loaded provider as a session's"
  - "[code://packages/sdk/src/host/routing.ts#L48-L67](../../../../packages/sdk/src/host/routing.ts#L48-L67) - `heldAs` and `nameOf`, which resolve any spelling to the held name by its id, and the comment that gives VS Code's old behaviour as the reason"
  - "[code://packages/sdk/src/host/routing.ts#L480-L488](../../../../packages/sdk/src/host/routing.ts#L480-L488) - `unheld`, which refuses an id another name holds"
  - "[code://packages/sdk/src/host/tooling.ts#L1028-L1032](../../../../packages/sdk/src/host/tooling.ts#L1028-L1032) - `reportedBy`, which reads the provider off the scheme of the held name when no chat runs"
  - "[code://packages/sdk/src/plugins/plugins.ts#L1200-L1213](../../../../packages/sdk/src/plugins/plugins.ts#L1200-L1213) - `sessionKept`, which compares the stored provider with the URI's scheme"
  - "[code://packages/computer/src/plugin.ts#L1141](../../../../packages/computer/src/plugin.ts#L1141) - the one caller of `sessionKept`, with the session URI a machine label holds"
  - "[code://packages/sdk/src/sessions/sessions.ts#L423-L467](../../../../packages/sdk/src/sessions/sessions.ts#L423-L467) - `Row` and `empty`: a row is keyed by id, holds a `provider` and no URI"
  - "[code://packages/sdk/src/sessions/sessions.ts#L753-L755](../../../../packages/sdk/src/sessions/sessions.ts#L753-L755) - how a file row's `provider` is read back, the pattern for a stored URI"
  - "[code://packages/sdk/src/types/sessions.ts#L240-L252](../../../../packages/sdk/src/types/sessions.ts#L240-L252) - `provider` and `setProvider` on `SessionStore`"
  - "[code://packages/sdk/src/sessions/catalog.ts#L85-L91](../../../../packages/sdk/src/sessions/catalog.ts#L85-L91) - `uriFor`, the `ahp-session:/<id>` spelling, and a comment that says a held session is `<provider>:/<id>`"
  - "[code://packages/sdk/src/host/channels.ts#L85-L98](../../../../packages/sdk/src/host/channels.ts#L85-L98) - `named`, whose comment says the host names the scheme"
  - "[code://packages/sdk/src/host/handshake.ts#L312-L321](../../../../packages/sdk/src/host/handshake.ts#L312-L321) - initialize `_meta['vscode.ahpSessionUris']: true`"
  - "[code://packages/sdk/test/host-names.test.ts#L74-L130](../../../../packages/sdk/test/host-names.test.ts#L74-L130) - the cases that expect an `ahp-session:` session to be listed as `claude:/<id>`"
  - "[code://packages/sdk/test/plugin-host.test.ts#L61-L66](../../../../packages/sdk/test/plugin-host.test.ts#L61-L66) - the `sessionKept` cases"
  - "[code://docs/sdk/SESSIONS.md#L18](../../../../docs/sdk/SESSIONS.md#L18) - the docs say a session is held as `<provider>:/<id>`"
  - "[code://docs/sdk/AHP.md#L589-L632](../../../../docs/sdk/AHP.md#L589-L632) - \"Session URIs\", which gives the reason for `<provider>:/<uuid>`"
  - "[code://UPSTREAM.md#L7](../../../../UPSTREAM.md#L7) - Pass 7, whose range holds `bd64649be19` and does not list it"
  - https://github.com/microsoft/agent-host-protocol/blob/main/docs/specification/session-channel.md - "The session's provider (e.g. \"copilot\") is **not** encoded in the URI scheme"
  - https://github.com/microsoft/vscode/commit/bd64649be19f2da0f09c2ab84c066c6c764b83be - "Use proper ahp-session: scheme URIs for new AH sessions", 2026-10-05
  - https://github.com/microsoft/vscode/blob/171e90619c723a84a3e1c7bcd58d226698f55c72/src/vs/platform/agentHost/common/agentHostSessionIdentity.ts#L13-L17 - `newAgentHostSessionUri`, the legacy spelling only for a native host without `vscode.ahpSessionUris`
  - https://github.com/microsoft/vscode/blob/171e90619c723a84a3e1c7bcd58d226698f55c72/src/vs/platform/agentHost/common/agent.ts#L1581-L1587 - `AgentSession.provider`, a "Legacy provider-scheme fallback" that returns nothing for `ahp-session`
  - https://github.com/microsoft/vscode/blob/171e90619c723a84a3e1c7bcd58d226698f55c72/src/vs/platform/agentHost/node/agentHostDatabase.ts#L779-L783 - the `sessions` table, keyed by `session_uri`, beside `provider`
  - https://github.com/microsoft/vscode/blob/171e90619c723a84a3e1c7bcd58d226698f55c72/src/vs/platform/agentHost/node/agentSessionRegistry.ts#L199-L204 - a session found on disk is given the `ahp-session` URI
---

## Goal

The protocol names a session `ahp-session:/<uuid>` and carries its provider on `SessionSummary.provider`.
ahpd holds every session as `<provider>:/<id>`, so the provider is in the scheme, as VS Code did before 2026-10-05.
With this plan, every new session ahpd holds is `ahp-session:/<uuid>`, and its provider comes from the session's record, never from its URI.
A session that already exists keeps the name it has, as VS Code keeps its legacy names.
This plan reverses [host 30](../30-a-session-is-listed-under-its-providers-name/plan.md) for new sessions only.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n '}:/\${' packages/*/src` - six places in the host make a `<provider>:/` session name. They are `createSession`, `movedTo`, `askModel`, `beginSession`, the session tool's `create` and `adopt`. The nested proxy makes a seventh, in the host inside a machine.
- `rg -n "schemeOf\(" packages/sdk/src` - two reads of a session's scheme as a provider: `reportedBy` in `tooling.ts` and `sessionKept` in `plugins.ts`; the others read resource and watch schemes.
- `rg -n "SessionStore\b" packages` - `@ahpd/sdk` has the only two stores, `memorySessions` and `fileSessions`.
- `rg -n "a-session-is-held-under-its-providers-name" .project docs packages` - the superseded decision, host 30, the spec `sessions-and-chats.md`, the comments on `named` and `createSession`, and `docs/sdk/SESSIONS.md`.
- `git merge-base --is-ancestor bd64649be19 e646868227c` in VS Code - true, so Pass 7 of `UPSTREAM.md` covers the change and does not list it.

### Runtime path

```
createSession { channel, provider } -> held name -> names.set(id, name) -> keepProvider -> the row on disk
restart -> listing -> adopt(row) -> the name from the row -> listSessions and root/sessionAdded
```

### Gaps

- `createSession` holds a session as `${provider}:/${idOf(given)}` whatever the client sent, so `ahp-session:/<uuid>` is only an alias ([`code://packages/sdk/src/host/sessionmethods.ts#L942`](../../../../packages/sdk/src/host/sessionmethods.ts#L942)).
- The brief names `spawn.ts#L1709` as the place a session is named; that line records the name that `createSession` made.
- A row holds no session URI, so after a restart a session is named `${provider}:/${row.id}`, whatever it was created as.
- `reportedBy` and `sessionKept` read a provider from a URI's scheme.
- `docs/sdk/SESSIONS.md`, `docs/sdk/AHP.md` and the spec give `<provider>:/<id>` as the held name.
- The brief says the last `UPSTREAM.md` pass stopped at `7516b04bc94`; Pass 7 reads to `e646868227c` (1.143.1), which holds `bd64649be19`, and does not list it.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Every new session that ahpd makes is held as `ahp-session:/<uuid>`: in `movedTo`, `askModel`, `beginSession` and the session tool's `create`. | The goal in file:///github/ahp-review/briefs/session-uris.md; Softov asked for it to be planned, 2026-10-27 | 02 |
| A session's provider comes from its stored provider, never from its URI. | The goal in file:///github/ahp-review/briefs/session-uris.md | 04 |
| A session that already exists keeps its `<provider>:/<id>` name. | Softov, 2026-10-27, in file:///github/ahp-review/briefs/session-uris.md: "Yes, as VS Code does." | 03 |
| ahpd still accepts a `createSession` on a `<provider>:/<uuid>` channel, and the session keeps that URI as its name. | Softov, 2026-10-27, in file:///github/ahp-review/briefs/session-uris.md: "Yes." | 02 |
| A session listed from disk that ahpd never named is `ahp-session:/<id>`. | Softov, 2026-10-27, in file:///github/ahp-review/briefs/session-uris.md: "`ahp-session:/<id>`, as VS Code names a session it finds with no registration." | 03 |
| A `createSession` on `ahp-session:/<id>` holds the session under that URI. | The goal in file:///github/ahp-review/briefs/session-uris.md | 02 |
| A `createSession` on any other channel holds the session as `ahp-session:/<id>`, and the client's URI is an alias. This includes a provider scheme that is not the provider the request names. | `(defaulted: today's alias, with the protocol's scheme in place of the provider's)` | 02 |
| The row stores the session's URI as `uri`, so a name survives a restart. | `(defaulted: the brief's shape, as VS Code stores session_uri, https://github.com/microsoft/vscode/blob/171e90619c723a84a3e1c7bcd58d226698f55c72/src/vs/platform/agentHost/node/agentHostDatabase.ts#L779-L783)` | 01 |
| A stored URI alone does not make a row, and it is written when the row is first written. | `(defaulted: the store writes no file for a session this host never ran, [code://packages/sdk/src/sessions/sessions.ts#L452-L467](../../../../packages/sdk/src/sessions/sessions.ts#L452-L467))` | 01 |
| `keepProvider` stores the held name under the host's id when the row has none, and not under the backend's own id. | `(defaulted: names is keyed by the host's id, [code://packages/sdk/src/host/spawn.ts#L1709](../../../../packages/sdk/src/host/spawn.ts#L1709))` | 02 |
| A row with no stored URI and a provider is named `<provider>:/<id>`, from the listing as today, and that name is then stored. | `(defaulted: the brief's shape; it keeps the answer on existing sessions true after a restart)` | 03 |
| A row with no stored URI and no provider keeps the name it has today, after the agent that lists it, and that name is then stored. | `(defaulted: the answer on existing sessions covers a row written before providers were kept)` | 03 |
| A URI whose scheme is a loaded provider still reaches a session by its id. | The brief's shape, and [code://packages/sdk/src/host/routing.ts#L46](../../../../packages/sdk/src/host/routing.ts#L46) | 04 |
| `reportedBy` reads the session's stored provider when no chat runs. | The brief's shape | 04 |
| The nested proxy creates `ahp-session:/<id>` in the host inside a machine, and keeps sending `provider`. | `(defaulted: the goal covers every new session a host holds, and the proxy already sends provider)` | 02 |
| `UPSTREAM.md` Pass 7 gets an item for `bd64649be19` under "Other host changes", ticked by this plan. | `(defaulted: Pass 7's range holds bd64649be19 and does not list it)` | 05 |
| The decision [a-new-session-is-held-under-the-protocols-uri](../../../decisions/a-new-session-is-held-under-the-protocols-uri.md) supersedes `a-session-is-held-under-its-providers-name`. The comments on `named` and `createSession`, and `docs/sdk/SESSIONS.md`, cite the new decision. | Softov, 2026-10-27 | 04, 05 |
| `sessionKept` compares the session's held name with the URI it is asked about. For a row with no stored URI, this is today's check. | `(defaulted: an ahp-session: URI has no provider to compare with)` | 04 |
| Chat URIs (`ahp-chat:`) do not change. | Not in scope in file:///github/ahp-review/briefs/session-uris.md | - |
| ahpc and ahpw create `ahp-session:/<uuid>` in plans of their own repositories, not in this plan. | `(defaulted: this plan is ahpd's; the brief lists the client change)` | - |

## Proposed architecture

- **Data flow** - a session gets its name when the host first holds it. The row keeps the name as `uri`, and a listing after a restart reads it back.
- **Event flow** - no new action; `listSessions`, `root/sessionAdded` and every URI built from a session use the held name, as now.
- **State flow** - `names` maps an id to its held name. A listing fills it from the row's `uri`, and derives a name only when the row has none.
- **Layer responsibilities** - `@ahpd/sdk`: the store keeps `uri`, and the host chooses the name. Routing resolves any spelling by its id · docs: the held name and its reason.
- **Source-of-truth files** - [`code://packages/sdk/src/sessions/sessions.ts`](../../../../packages/sdk/src/sessions/sessions.ts), [`code://packages/sdk/src/host/sessionmethods.ts`](../../../../packages/sdk/src/host/sessionmethods.ts), [`code://packages/sdk/src/host/catalogue.ts`](../../../../packages/sdk/src/host/catalogue.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The store keeps a session's URI](task-01-the-store-keeps-a-sessions-uri.md) | todo | - |
| [02 - A new session is held as `ahp-session:`](task-02-a-new-session-is-held-as-ahp-session.md) | todo | 01 |
| [03 - A listed session is named from its row](task-03-a-listed-session-is-named-from-its-row.md) | todo | 01 |
| [04 - No provider is read from a scheme](task-04-no-provider-is-read-from-a-scheme.md) | todo | 01 |
| [05 - The docs name the protocol's URI](task-05-the-docs-name-the-protocols-uri.md) | todo | 02, 03, 04 |

## Risks and tradeoffs

- A client that reads the provider from a scheme gets `ahp-session` for a new session - every summary carries `provider` ([`code://packages/sdk/src/host/catalogue.ts#L516`](../../../../packages/sdk/src/host/catalogue.ts#L516)). VS Code reads it since `bd64649be19`.
- ahpc and ahpw still create `<provider>:/<uuid>` until their own plans change them - the answer on `<provider>:/<uuid>` channels keeps them working.
- Many tests in `packages/sdk/test` expect `<provider>:/<id>` for a session created on `ahp-session:` - each such case expects the new name, and none is deleted.
- The first listing after an upgrade stores a `uri` in every old row, so it writes many files - only rows that exist are written. The store joins its writes into one write per tick.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-the-store-keeps-a-sessions-uri.md](task-01-the-store-keeps-a-sessions-uri.md).
- **Open questions:** none.
- **Watch out for:** `keepProvider` also writes the provider under the backend's own id, and that id must not get the host's name. The aliases in `routing.ts` stay, because ahpc, ahpw and old names use them.

## Final verification checklist

- [ ] `pnpm boundary`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.
- [ ] A session created on `ahp-session:/<uuid>` is listed under that URI before and after a restart.
- [ ] A session in a row written before this change is listed under its old `<provider>:/<id>` name after a restart.
- [ ] `specs/sessions-and-chats.md` says how a session is named.
- [ ] `plans/index.md` updated.
