---
title: An agent unload ends its sessions
status: done
depends: [task-02-a-plugin-change-applies-at-once.md]
layer: "sdk, server"
refs:
  - "[code://packages/sdk/src/host.ts#L156-L203](../../../../packages/sdk/src/host.ts#L156-L203) - the agent map"
  - "[code://packages/server/src/plugins.ts#L1156](../../../../packages/server/src/plugins.ts#L1156) - the loader, where `unloadOne` runs"
---

## Objective

An unload of a plugin with an agent ends each session that runs on that agent, then removes the agent.

## Files

- `UPDATE: packages/sdk/src/host.ts` - add a way to end every session on one agent, as a disposal does.
- `UPDATE: packages/server/src/applyplugins.ts` - end the agent's sessions before `unloadOne`.
- `UPDATE: packages/server/test/plugin-live.test.ts` - the agent cases.
- `UPDATE: docs/plugins/PLUGINS.md` - say that disabling an agent plugin ends its sessions.

## Steps

1. Read how the host disposes of one session, and reuse that path.
2. Add `host.endSessionsOf(agent)`, which ends each session whose provider is that agent.
3. Call it in `applyPlugins` for each agent of a plugin that unloads.
4. Call it for a reload with new options too, before the closers run.
5. Write the docs line.

## Validation

- `plugin-live.test.ts` opens a session on a plugin agent, disables the plugin, and the session ends.
- The agent is gone from the root state after the unload.
- `npm test -w packages/server` passes.

## Resume

- **Done so far:** `host.endSessionsOf(agent)` from task-01 ends each session that runs on one agent, through the same `removeSession` a disposal uses. `applyPlugins` has `endSessions(id)`, which reads the agents of the plugin as the set holds it and calls it for each. It runs before `set.unload` in the loop that drops a plugin the file no longer names. The reload branch calls it the same way, so the closers run after the sessions are gone. `plugin-live.test.ts` now has seven cases. The two new ones register a backend from the repository's echo example through a file URL and open a session on it. They check that the unload leaves no active session and no agent in the root state. The second one changes the plugin's options and checks the same, while the new backend stays listed. `docs/plugins/PLUGINS.md` says an unload ends an agent plugin's sessions.
- **Next action:** [task-04-a-code-reload-imports-a-new-url.md](task-04-a-code-reload-imports-a-new-url.md).
- **Files:** `packages/server/src/applyplugins.ts`, `packages/server/test/plugin-live.test.ts`, `docs/plugins/PLUGINS.md`, this task file, the plan and the index. The session cannot commit, so they are left in the worktree.
- **Open questions:** none.
- **Departures:** A reload ends the sessions of the agent it moves, and it does so before the closers, as step 4 says. A session whose backend comes back under the same provider after the reload is not reopened. A change applied with no host behind it, as a channel built without a daemon, has no session to end and does nothing.
- **Watch out for:** The host is read through `options.host()` at the moment of the change. `endSessionsOf` takes a provider instead of an agent object as well, which a later caller may find easier.
