---
title: A session's config outlives a restart, and a stored value the schema no longer offers falls back to the default
domain: host
status: active
priority: high
created: 2026-09-29
revalidated: 2026-10-04
requires: []
refs:
  - "[code://packages/sdk/src/host/chatactions.ts#L107-L112](../../../../packages/sdk/src/host/chatactions.ts#L107-L112) - the one `kept.setConfig`: a session with no running agent, each value written through `String()`"
  - "[code://packages/sdk/src/host/chatactions.ts#L372-L452](../../../../packages/sdk/src/host/chatactions.ts#L372-L452) - a live `session/configChanged`, which never reaches the store"
  - "[code://packages/sdk/src/host/chatactions.ts#L196-L200](../../../../packages/sdk/src/host/chatactions.ts#L196-L200) - a resume spawns with `kept.config(id)`"
  - "[code://packages/sdk/src/host/snapshots.ts#L396-L399](../../../../packages/sdk/src/host/snapshots.ts#L396-L399) - a browsed row shows defaults under `kept.config(id)`"
  - "[code://packages/sdk/src/host/spawn.ts#L422](../../../../packages/sdk/src/host/spawn.ts#L422) - `spawn`, which merges the config over `agent.defaults()`"
  - "[code://packages/sdk/src/sessions.ts#L76-L207](../../../../packages/sdk/src/sessions.ts#L76-L207) - `fileSessions` and the saved shape"
---

## Goal

A session keeps the configuration it was created with and every change made while it ran, after the daemon restarts.
A stored value its backend's schema no longer offers, such as an enum value a backend dropped, is dropped and the default is used, for every backend.
A preset is not a session value: since claude/15 a preset is a provider id, and a session whose preset is renamed or removed is a session whose agent did not load, which [host/41 task 02](../41-a-failure-belongs-to-the-item-that-failed/task-02-a-session-waits-for-its-own-agent.md) lists under it, not openable, its record never rewritten.

## Reconnaissance

The files read are the `refs` above.

### Runtime path

```
createSession(config) -> spawn(settings = defaults + config)          (not stored)
session/configChanged on a live session -> session.setConfig -> dispatch (not stored)
restart -> resume -> spawn(kept.config(id) ?? {})                     (defaults: the chosen values are gone)
```

### Gaps

- Only a session with no running agent writes its config to the store, so a created or live-changed value is lost on restart.
- The store writes each value through `String()`, so an array or an object (`permissions`, `shellInitScripts`) comes back as text.
- Nothing checks a stored value against the schema; a stale enum value reaches the backend as it was.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| The store holds the values a session was created with and every accepted change, as JSON values | (defaulted: a resume must start where the session was) | 01 |
| A stored value the schema does not accept is dropped and the default used; nothing is refused | Softov, 2026-09-29: "For some session that could store that information we retrieve.. without that goes to default... since a profile could be removed in a future... changed its name. etc" | 02 |
| Only a declared key whose stored value the schema refuses is dropped; a key the schema does not declare is kept and handed back, since the store only holds keys the backend accepted | Softov, 2026-09-30, asked what happens on resume to a stored key the schema does not declare, such as Claude's `model`: "Keep it" | 02 |
| A browsed row logs a dropped value once per session, not on every read | (defaulted: the same line on every listing is noise) | 02 |
| A config change for a channel that names no session this host runs, lists or finds in the catalogue is refused, and nothing is stored for it | (defaulted: the store is keyed by id, and a row for no session is one nothing will read or forget) | 01 |
| A listing answers `past` for `LISTING_FRESH` (2 s); an id missing from a listing `past` did not start itself is listed for once more, at most once in that window | (defaulted: a backend writes a session to disk after a listing, and an id that names nothing must not cost a listing each) | 01 |
| A key the schema scopes to one chat is stored when it is set on the session's lead chat, which is what a resume applies it to, and not when it is set on a peer chat | Softov, 2026-09-30, asked "After a restart, should the lead chat come back on the model you last picked for it?": "Yes, save the lead chat's" | 01 |
| A session whose recorded provider (a removed or renamed preset among them) did not load is listed under it, not openable, its record never rewritten | Softov, 2026-10-03, asked "when a `$secret` in a plugin's options can't be read at load, what fails?": "Only its item"; [host/41 task 02](../41-a-failure-belongs-to-the-item-that-failed/task-02-a-session-waits-for-its-own-agent.md) | host/41 02 |

## Proposed architecture

- **State flow** - `createSession` and every accepted `session/configChanged` write `kept.setConfig(id, values)`; resume and a browsed row read it through one `storedConfig(owner, id)` that drops what the schema refuses.
- **Layer responsibilities** - sdk only.
- **Source-of-truth files** - [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts), [`code://packages/sdk/src/host/sessionconfig.ts`](../../../../packages/sdk/src/host/sessionconfig.ts), [`code://packages/sdk/src/sessions.ts`](../../../../packages/sdk/src/sessions.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The store keeps what a session was made with and every change](task-01-the-store-keeps-every-change.md) | done | - |
| [02 - A stored value the schema refuses falls back to the default](task-02-a-refused-value-falls-back.md) | done | 01 |

## Risks and tradeoffs

- A `sessions.json` written before this holds strings; a string the schema refuses falls back under task 02, so an old file cannot break a resume.

## Resume state

- **Done so far:** tasks 01 and 02 implemented: the store keeps a session's config from creation and every accepted change, as JSON values, except a peer chat's chat-scoped key, a change answered after the session was disposed, and config for a channel that names no session, and a resume or a browsed row drops a declared value the schema refuses, logged once, and keeps undeclared keys.
- **Next action:** review.
- **Open questions:** none.
- **Watch out for:** `sessions: 'memory'` forgets by design; test with `fileSessions`.
- **Watch out for:** a `preset` key stored by a Claude session before claude/15 is no longer declared by the schema, so it is kept and handed back like any undeclared key, and the backend ignores it.

## Final verification checklist

- [ ] A Claude session created with `thinking: disabled` keeps it after a daemon restart.
- [ ] A stored `permissionMode` of `nope` resumes as `default`.
- [ ] `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.
- [ ] `plans/index.md` updated.
