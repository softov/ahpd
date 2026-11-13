---
title: The wake takes the bot's owner on a host with no users
status: implemented
depends: []
layer: "bot"
refs:
  - "[code://packages/bot/src/wake.ts#L55-L63](../../../../packages/bot/src/wake.ts#L55-L63) - `BotSessions`, which gets `hasUsers`"
  - "[code://packages/bot/src/wake.ts#L749-L762](../../../../packages/bot/src/wake.ts#L749-L762) - the owner the wake uses"
  - "[code://packages/bot/src/plugin.ts#L584-L587](../../../../packages/bot/src/plugin.ts#L584-L587) - the plugin's seam, from `host.hasUsers`"
---

## Objective

On a host with no users directory, the wake uses the bot's owner when the Front session has no owner. On a host with users, a session with no owner still ends the turn.

## Files

- `UPDATE: packages/bot/src/wake.ts` - `BotSessions` gets `hasUsers`, and the wake falls back to `bot.owner`.
- `UPDATE: packages/bot/src/plugin.ts` - the seam sets `hasUsers` from `host.hasUsers`.
- `UPDATE: packages/bot/test/bot-wake.test.ts` - a `users` option on the fake host, and two cases.
- `UPDATE: packages/bot/test/bot-context.test.ts`, `packages/bot/test/bot-post.test.ts` - their fakes name `hasUsers: true`.
- `DELETE: .project/problems/a-bot-never-answers-on-a-host-with-no-users.md` - the problem this plan fixes.

## Steps

1. Add `hasUsers: boolean` to `BotSessions`, with a comment that a host without users records no session's owner.
2. In the wake, use `bot.owner` when the session's owner is `undefined` and `hasUsers` is `false`.
3. Keep the refusal when the owner is still `undefined`.
4. In the plugin, set `hasUsers: host.hasUsers === true` on the seam.
5. Give the fake host in `bot-wake.test.ts` a `users` option, `true` by default.
6. Add a case: no users, no owner, a bot owned by `root:box`. One Back starts, titled `@main/backer/root`, and the context says `from: box`.
7. Add a case: users, no owner. The turn ends with the refusal and no Back starts.
8. Delete the problem file.

## Validation

- `bot-wake.test.ts`: the two new cases pass, and the case for a session the host does not hold still passes.
- `pnpm typecheck` passes.
- `TMPDIR=/tmp npx vitest run packages/bot/test` passes.

## Resume

Implemented 2026-11-13. See [implemented.md](implemented.md).
