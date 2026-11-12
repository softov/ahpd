---
title: An unused new session is removed
domain: host
status: planned
priority: medium
created: 2026-11-12
revalidated: 2026-11-12
requires: []
changes: []
creates: []
refs:
  - git://b4ad32951 - the commit of ahpd this plan was checked at
  - "[code://packages/sdk/src/host/lifecycle.ts#L2676](../../../../packages/sdk/src/host/lifecycle.ts#L2676) - `markSessionProvisional`: a new session stays unlisted until its first message"
  - "[code://packages/sdk/src/host/catalogue.ts#L798](../../../../packages/sdk/src/host/catalogue.ts#L798) - the provisional set, which nothing ever empties for a session that gets no message"
  - "[code://packages/sdk/src/host/lifecycle.ts#L870-L882](../../../../packages/sdk/src/host/lifecycle.ts#L870-L882) - `removeSession` already removes a provisional session without a word"
  - "[code://packages/sdk/src/host/sleep.ts#L68-L94](../../../../packages/sdk/src/host/sleep.ts#L68-L94) - `sleepAfterMinutes`, the timer setting to copy"
  - "[code://packages/server/src/config.ts#L556-L562](../../../../packages/server/src/config.ts#L556-L562) - the config field and its doc comment to copy"
  - "[code://packages/server/src/commands/options.ts#L870](../../../../packages/server/src/commands/options.ts#L870) - the option entry to copy"
---

## Goal

A session that is made and never gets a message is removed after a while, and its disposable machine goes with it.
Today it stays unlisted for the life of the daemon, so nobody sees it and nothing removes its machine.
`ahpc session new` with no `prompt` after it, or one whose client timed out, leaves one each time.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "provisional" packages/sdk/src/host` - the set is filled at create, read by the catalogue and by `removeSession`, and emptied at the first message only.

### Runtime path

```
createSession -> markSessionProvisional -> (no message) -> timer -> removeSession -> teardown -> leave -> machine removed
```

### Gaps

- No timer for a provisional session.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A provisional session with no message is removed after a set time, which lets its machine go | Softov, 2026-11-12: "Remove it when unused" | 01 |
| The setting is `unusedSessionMinutes`; unset is 10; zero keeps the session | `(defaulted: the shape of sleepAfterMinutes)` | 01 |
| The timer stops at the session's first message | `(defaulted: a message makes it a session in use)` | 01 |

## Proposed architecture

- **Data flow** - `markSessionProvisional` arms a timer; the first message clears it; when it fires, `removeSession` runs.
- **Layer responsibilities** - sdk: the timer and the removal · server: the setting.
- **Source-of-truth files** - [`code://packages/sdk/src/host/lifecycle.ts`](../../../../packages/sdk/src/host/lifecycle.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A provisional session times out](task-01-a-provisional-session-times-out.md) | todo | - |

## Risks and tradeoffs

- A script that makes a session and sends its first message much later loses the session - it sets `unusedSessionMinutes`.
- A session made again for the same URI touches it - the timer starts again then.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-a-provisional-session-times-out.md](task-01-a-provisional-session-times-out.md).
- **Open questions:** none.
- **Watch out for:** a provisional session has no row to drop, so the removal must not broadcast a `sessionRemoved`.

## Final verification checklist

- [ ] A session with no message is gone after the set time, and its disposable machine is removed.
- [ ] A session with a message before the time stays.
- [ ] `unusedSessionMinutes: 0` keeps a session with no message.
