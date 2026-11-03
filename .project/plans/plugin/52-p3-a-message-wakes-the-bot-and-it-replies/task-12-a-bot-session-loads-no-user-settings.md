---
title: A bot session loads no user settings
status: done
depends: [task-10-a-bots-folder-has-its-agents-file.md]
layer: "packages/sdk, packages/agent-claude, packages/bot"
refs:
  - "[code://packages/sdk/src/types/plugin.ts#L104](../../../../packages/sdk/src/types/plugin.ts#L104) - `trusted` on a plugin's session request, the pattern for the new flag"
  - "[code://packages/sdk/src/host/lifecycle.ts#L1618](../../../../packages/sdk/src/host/lifecycle.ts#L1618) - the store keeps the request's tools, so a restart keeps them"
  - "[code://packages/agent-claude/src/session/query.ts#L320](../../../../packages/agent-claude/src/session/query.ts#L320) - `settingSources` always holds `user`"
  - "[code://packages/bot/src/wake.ts#L166-L170](../../../../packages/bot/src/wake.ts#L166-L170) - the back session's request"
---

## Objective

A session request can say `userSettings: false`.
Such a session does not load the settings of the person who runs the daemon: for Claude, no `~/.claude/CLAUDE.md`, no memory and no user settings.
The folder's own `CLAUDE.md` still loads where the folder is trusted.
The store keeps the flag, so a restart keeps it.
A bot's back session sets the flag.

## Files

- `UPDATE: packages/sdk/src/types/plugin.ts` - `userSettings?: boolean` on the session request.
- `UPDATE: packages/sdk/src/types/agent.ts` - `userSettings` on `Start`, so a backend reads it.
- `UPDATE: packages/sdk/src/host/lifecycle.ts` - keep the flag in the session store.
- `UPDATE: packages/sdk/src/host/spawn.ts` - put the stored flag on `Start` at every spawn.
- `UPDATE: packages/agent-claude/src/session/query.ts` - remove `user` from `settingSources` when the flag is false.
- `UPDATE: packages/bot/src/wake.ts` - the back session's request sets `userSettings: false`.
- `CREATE: packages/sdk/test/session-user-settings.test.ts` - the flag reaches `Start`, and a restart keeps it.
- `UPDATE: packages/agent-claude/test/query.test.ts` - the setting sources with the flag.

## Steps

1. Add `userSettings?: boolean` to the session request, with `true` as the default.
2. Keep the flag in the session store, as the store keeps `tools` and the trusted folder.
3. Put the stored flag on `Start` at every spawn.
4. In Claude, use `['project', 'local']` for a trusted folder when the flag is false.
5. In Claude, use no setting source for a folder with no trust when the flag is false.
6. Make the back session's request in `wake.ts` set `userSettings: false`.
7. Leave every other session as it is.

## Validation

- `session-user-settings.test.ts`: test that the flag reaches `Start`, and that a restart keeps it.
- `query.test.ts`: test the setting sources for each pair of trust and flag.
- The gates pass: build, typecheck, boundary, schema and vitest.
