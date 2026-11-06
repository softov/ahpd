---
title: The host takes a new fold
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L156-L203](../../../../packages/sdk/src/host.ts#L156-L203) - `createHost` and the agent map it builds once"
  - "[code://packages/sdk/src/host.ts#L945](../../../../packages/sdk/src/host.ts#L945) - `retool`, which rebuilds one session's tool list"
  - "[code://packages/sdk/src/host.ts#L1231](../../../../packages/sdk/src/host.ts#L1231) - a value derived from `options.events` once at start"
  - "[code://packages/sdk/src/plugins/plugins.ts#L283-L295](../../../../packages/sdk/src/plugins/plugins.ts#L283-L295) - `foldHostOptions`"
---

## Objective

`host.replace(folded)` makes the host use a new fold of the options.
Each open session is retooled, so a tool that was added or removed shows in its next turn.

## Files

- `UPDATE: packages/sdk/src/host.ts:156-203` - hold the options in one place that `replace` swaps, and rebuild the agent map from it.
- `UPDATE: packages/sdk/src/host.ts:1231` - read each value derived from the options again when the fold changes.
- `UPDATE: packages/sdk/src/types/host.ts` - add `replace(folded)` to the `Host` interface, with its comment.
- `CREATE: packages/sdk/test/host-replace.test.ts` - the cases below.

## Steps

1. List each place in `host.ts` that copies a field of `options` at start, and each value derived from one.
2. Move each copy to a read at use, or recompute it in `replace`.
3. Write `replace(folded)`, which swaps the options and rebuilds the agent map.
4. Refuse a fold whose ports or providers differ from the ones the host holds, and keep the old fold.
5. Keep an agent that still has an open session, and leave its removal to the caller.
6. Retool every open session at the end of `replace`.
7. Make `replace` emit one event, so a channel that lists contributions sends its rows again.

## Validation

- `host-replace.test.ts` adds a tool and checks that an open session's next turn has it.
- It removes a tool, a channel and a method, and checks that each is gone.
- It gives a fold with a different port, and the host keeps the old fold.
- `npm test -w packages/sdk` passes.

## Resume

- **Done so far:** `host.replace(folded)` and `host.endSessionsOf(agent)` are on the `Host` interface. `replace` refuses a fold whose port options or resource schemes differ, keeping the options the host has. It refuses a fold with no agents and one whose agent list breaks the two agent rules. It changes the agent map in place, so `createRoot` lists the new agents. It keeps an agent the fold dropped while a session still runs on it. It takes the new fold's descriptors onto the options object the host was built over. The keys the fold no longer has are deleted, so every area that destructured `options` reads the new value. A getter such as `mcpServers` stays a getter. It sets `ctx.first`, `ctx.contributed` and `ctx.contributing`. It wires each served channel's `publish` and `subscribers`. It opens or closes the users watch as the listeners move, and probes each new agent. It sends `session/serverToolsChanged` to every open session and retools it. Then it sends one `root/agentsChanged`. `endSessionsOf` removes every session running on one agent through `removeSession`, logging one that fails. `host-replace.test.ts` has four cases. One adds a tool. One removes a tool, a channel and a method. One is a refused port. One keeps an agent for its open session, then lets it go after `endSessionsOf`. `wirePlugins` sets every function the host writes on a plugin's entry, at start and again from `replace`. It covers a trigger's `deliver` and `run`, a start's `start`, `startChat` and `opens`, a session key's `changed`, and a plan's `changed`. A plugin's type also makes the automations saved for it watchable, so those are read again there. `foldHostOptions` keeps one trigger entry per contribution across folds, because the host writes `deliver` on it once. Two cases in `plugin-live.test.ts` check a live fire that reaches an automation and a live session start.
- **Next action:** [task-02-a-plugin-change-applies-at-once.md](task-02-a-plugin-change-applies-at-once.md).
- **Files:** `packages/sdk/src/host.ts`, `packages/sdk/src/host/automations.ts`, `packages/sdk/src/host/facts.ts`, `packages/sdk/src/host/spawn.ts`, `packages/sdk/src/plugins/plugins.ts`, `packages/sdk/src/types/host.ts`, `packages/sdk/test/host-replace.test.ts`, `packages/server/test/plugin-live.test.ts`, this task file and the plan. The session cannot commit, so they are left in the worktree.
- **Open questions:** none.
- **Departures:** `ctx.actionTools` is built once from `options.adapters` in `host/tooling.ts`. This task did not name that file, so a live change of adapters leaves the old adapter tools offered until a restart. The connector channel already serves an adapter that is gone as `unavailable`. `plugins.ts` was changed too, which the Files list did not name: a trigger entry built again at each fold left the host's `deliver` behind.
- **Watch out for:** `replace` must send `session/serverToolsChanged` and also call `retool`. `retool` only hands the chat its new tools, and the action is what a client reads as the set the session has. A new field the host writes on a plugin's entry belongs in `wirePlugins` too, or a plugin loaded live never gets it.
