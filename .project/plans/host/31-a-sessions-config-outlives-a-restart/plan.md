---
title: A session's config outlives a restart, and a stored value the schema no longer offers falls back to the default
domain: host
status: planned
priority: high
created: 2026-09-29
revalidated: 2026-09-29
requires: []
refs:
  - "[code://packages/sdk/src/host.ts#L8380-L8392](../../../../packages/sdk/src/host.ts#L8380-L8392) - the one `kept.setConfig`: a session with no running agent, each value written through `String()`"
  - "[code://packages/sdk/src/host.ts#L8815-L8841](../../../../packages/sdk/src/host.ts#L8815-L8841) - a live `session/configChanged`, which never reaches the store"
  - "[code://packages/sdk/src/host.ts#L8431](../../../../packages/sdk/src/host.ts#L8431) - a resume spawns with `kept.config(id)`"
  - "[code://packages/sdk/src/host.ts#L5530](../../../../packages/sdk/src/host.ts#L5530) - a browsed row shows defaults under `kept.config(id)`"
  - "[code://packages/sdk/src/host.ts#L3164-L3222](../../../../packages/sdk/src/host.ts#L3164-L3222) - `spawn`, which merges the config over `agent.defaults()`"
  - "[code://packages/sdk/src/sessions.ts#L76-L207](../../../../packages/sdk/src/sessions.ts#L76-L207) - `fileSessions` and the saved shape"
---

## Goal

A session keeps the configuration it was created with and every change made while it ran, after the daemon restarts.
A stored value its backend's schema no longer offers, such as a Claude preset that was renamed or removed, is dropped and the default is used, for every backend.

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

## Proposed architecture

- **State flow** - `createSession` and every accepted `session/configChanged` write `kept.setConfig(id, values)`; resume and a browsed row read it through one `storedConfig(owner, id)` that drops what the schema refuses.
- **Layer responsibilities** - sdk only.
- **Source-of-truth files** - [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts), [`code://packages/sdk/src/sessions.ts`](../../../../packages/sdk/src/sessions.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The store keeps what a session was made with and every change](task-01-the-store-keeps-every-change.md) | todo | - |
| [02 - A stored value the schema refuses falls back to the default](task-02-a-refused-value-falls-back.md) | todo | 01 |

## Risks and tradeoffs

- A `sessions.json` written before this holds strings; a string the schema refuses falls back under task 02, so an old file cannot break a resume.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-the-store-keeps-every-change.md](task-01-the-store-keeps-every-change.md).
- **Open questions:** none.
- **Watch out for:** `sessions: 'memory'` forgets by design; test with `fileSessions`.

## Final verification checklist

- [ ] A Claude session created with `thinking: disabled` keeps it after a daemon restart.
- [ ] A stored `permissionMode` of `nope` resumes as `default`.
- [ ] `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.
- [ ] `plans/index.md` updated.
