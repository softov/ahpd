---
title: A bot answers on a host with no users
domain: bots
status: planned
priority: high
created: 2026-11-13
revalidated: 2026-11-13
requires: []
changes: []
creates: []
refs:
  - git://045197d4f - the commit of ahpd this plan was checked at, and the last one that holds `problems/a-bot-never-answers-on-a-host-with-no-users.md`
  - "[code://packages/bot/src/wake.ts#L747-L751](../../../../packages/bot/src/wake.ts#L747-L751) - the wake refuses a Front session that has no owner"
  - "[code://packages/sdk/src/host/owners.ts#L75-L79](../../../../packages/sdk/src/host/owners.ts#L75-L79) - a host with no users directory records no owner for a session"
  - "[code://packages/bot/src/talks.ts#L45-L51](../../../../packages/bot/src/talks.ts#L45-L51) - `talkerOf`, which already keeps a talk with no owner as `root`"
  - "[code://packages/bot/src/provider.ts#L78-L86](../../../../packages/bot/src/provider.ts#L78-L86) - a bot made on a host with no users is owned by `root:<hostName>`"
  - "[code://packages/sdk/src/types/plugin.ts#L759-L769](../../../../packages/sdk/src/types/plugin.ts#L759-L769) - `hasUsers`, which a plugin reads to know the host has a users directory"
---

## Goal

A bot answers on a host with no users directory, which is the default install.
On 2026-11-13 a message to a bot on such a host failed at once with `<session> is a session this host does not hold`.
After this plan, the Back starts as on a host with users, and the talk is the host's own.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "sessionOwner|sessions.owner" packages/bot/src` - the wake and the talk index read the session's owner. Only the wake refuses when there is none.
- `rg "BotSessions" packages/bot` - the plugin and three test files build the seam.
- Test daemon on port 39200 with no `users` key, at `045197d4f`: the message failed with the refusal. Softov saw the same on 2026-11-13.

### Runtime path

```
Front turn -> wake.woken -> seams.sessions.owner(session) -> undefined on a host with no users -> refusal
```

### Gaps

- The wake reads "no owner" as "a session this host does not hold". On a host with no users, every session has no owner.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The fix is in the bot plugin, not in how the host records owners | Softov, 2026-11-13: "make the fix onto the bot thing" | 01 |
| On a host with no users, the bot's owner is whose the talk is | The problem file's *Fix*; a bot there is owned by `root:<hostName>` | 01 |
| A host with users keeps the refusal for a session with no owner | `(defaulted: there, no owner means the host does not hold the session)` | 01 |

## Proposed architecture

- **Data flow** - `BotSessions` gets `hasUsers`. The wake takes the bot's owner when the session has none and the host has no users.
- **Event flow** - unchanged.
- **State flow** - unchanged. The talk index keeps a talk with no owner as `root`, as before.
- **Layer responsibilities** - the bot plugin only.
- **Source-of-truth files** - [`code://packages/bot/src/wake.ts`](../../../../packages/bot/src/wake.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The wake takes the bot's owner on a host with no users](task-01-the-wake-takes-the-bots-owner.md) | implemented | - |

## Risks and tradeoffs

- On a host with no users, the wake can no longer tell a session it holds from one it does not. A Front turn runs in a session the host holds, so the message comes from a held session.
- The context block names the host as `from`, such as `from: soft-sandbox`, because the bot's owner is `root:<hostName>`.

## Resume state

- **Done so far:** task 01 implemented, 2026-11-13; see [implemented.md](implemented.md).
- **Next action:** Softov reviews the PR. The plan closes as `built` on his word.
- **Open questions:** none.
- **Watch out for:** `hasUsers` is required on `BotSessions`, so a new fake of the seam must name it.

## Final verification checklist

- [x] A message to a bot in a session with no owner, on a host with no users, starts one Back chat titled `@main/<bot>/root`.
- [x] A session with no owner on a host with users still ends the turn with the refusal.
- [x] `pnpm typecheck` and the bot suite pass.
- [x] A test daemon with no `users` key answers a message to a bot.
