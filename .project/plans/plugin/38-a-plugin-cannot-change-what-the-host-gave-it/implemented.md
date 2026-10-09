---
title: A plugin cannot change what the host gave it - implemented
date: 2026-10-08
refs:
  - "[code://packages/sdk/src/frozen.ts](../../../../packages/sdk/src/frozen.ts)"
  - "[code://packages/sdk/src/plugins.ts](../../../../packages/sdk/src/plugins.ts)"
  - "[code://packages/server/src/plugins.ts](../../../../packages/server/src/plugins.ts)"
  - "[code://packages/sdk/test/plugin-boundary.test.ts](../../../../packages/sdk/test/plugin-boundary.test.ts)"
  - "[code://docs/PLUGINS.md](../../../../docs/PLUGINS.md)"
  - "[code://.project/decisions/a-plugin-gets-frozen-copies-of-host-values.md](../../../decisions/a-plugin-gets-frozen-copies-of-host-values.md)"
  - "[code://.project/plans/plugin/38-a-plugin-cannot-change-what-the-host-gave-it/plan.md](plan.md)"
---

All six tasks are built, in dependency order. Every value that crosses the plugin boundary is now a frozen copy, or an object built new and frozen where `structuredClone` cannot carry its methods, and the host reads only its own copy of what a plugin contributed. Nothing is committed: Softov reads the diff first.

Softov read the diff and found three places where the promise held on paper and not in the value. All three are fixed, each with a case that failed before the fix; the plan is back to `active` and the tasks stay `implemented`, because a plan is closed as built only after that read.

## What was built

- [`code://packages/sdk/src/frozen.ts`](../../../../packages/sdk/src/frozen.ts) - new. `frozenCopy(value)` is `structuredClone` then `deepFreeze`; `deepFreeze(value)` freezes in place, under a `WeakSet` cycle guard. The one helper every site below is written in terms of. Task 01.
- [`code://packages/sdk/src/users.ts`](../../../../packages/sdk/src/users.ts), [`code://packages/server/src/commands/authorize.ts`](../../../../packages/server/src/commands/authorize.ts) - a principal is frozen where it is built, `ROOT` included, and its `roles` with it. Task 01.
- [`code://packages/sdk/src/host/spawn.ts`](../../../../packages/sdk/src/host/spawn.ts), [`code://packages/sdk/src/host/tooling.ts`](../../../../packages/sdk/src/host/tooling.ts) - the `Start` a backend's `create` receives holds the host's own copies of the schema, the tool definitions, the MCP servers and a per-session file store, and a host tool's `context()` answers a copy of the turns. Task 02.
- [`code://packages/sdk/src/plugins.ts`](../../../../packages/sdk/src/plugins.ts) - the fold takes its copy of every agent, tool, session-config schema, trigger type and `optionsSchema`; `seal()` refuses a `register*` once `apply` has returned, in the plugin's own name; `fired` asks which plugin holds a trigger type; `raise` hands one frozen copy of the event to every listener; the plugin's `host` object is frozen; and the fold starts from the base's own property descriptors. Tasks 03, 04 and 05.
- [`code://packages/server/src/plugins.ts`](../../../../packages/server/src/plugins.ts) - `loadOne` builds a frozen `PluginContext` with `paths: frozenCopy(options.paths)`, copies a `secretAtUse` node like any other option, seals the recording once `apply` has settled, and keeps a frozen copy of each plugin's `optionsSchema`. Tasks 03 and 04.
- [`code://packages/sdk/src/host/automations.ts`](../../../../packages/sdk/src/host/automations.ts) - the trigger table is the host's own, so the plugin's `deliver` is written where the host keeps it and never onto the plugin's object. Task 03.
- [`code://packages/sdk/src/host/sessionconfig.ts`](../../../../packages/sdk/src/host/sessionconfig.ts), [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts), [`code://packages/sdk/src/index.ts`](../../../../packages/sdk/src/index.ts), [`code://packages/sdk/src/types/plugin.ts`](../../../../packages/sdk/src/types/plugin.ts) - the schema answers and the `HostRecording` surface the two above are written against.
- [`code://packages/sdk/test/plugin-boundary.test.ts`](../../../../packages/sdk/test/plugin-boundary.test.ts) - new, 24 cases. One per crossing, each trying the write and checking the host is unchanged: a principal at `read`, `write`, `remove` and `authorize`, the directory's own principal and its `roles`, and the one an embedder hands `accept`; a `Start`'s schema, tool definitions, MCP servers and store; a tool's turns; a registered agent, tool, session-config schema and trigger type; a backend written as a class and the fire of a type its plugin lost; a late registration; the frozen context; two listeners and one event; the fold keeping the base's getter.
- [`code://packages/server/test/plugin-load.test.ts`](../../../../packages/server/test/plugin-load.test.ts), [`code://packages/server/test/server-root-config.test.ts`](../../../../packages/server/test/server-root-config.test.ts) - the loader half: a frozen context with the plugin's own `paths`, a `secretAtUse` node the plugin writes into, a late `registerTool`, and a masked option read from the copy the host took rather than the schema the plugin holds. Three fixtures were added: `plugin-push`, `plugin-later` and `plugin-after`.
- [`code://docs/PLUGINS.md`](../../../../docs/PLUGINS.md) - "Everything you are handed is read-only", at the end of the contract: what is frozen, that registration ends when `apply` returns, and that a plugin is trusted code rather than sandboxed. Task 06.

## Verified

- `node tools/schema.mjs`: 508 definitions from 506 exported types, 633 closed objects.
- `pnpm build`, `pnpm typecheck` and `pnpm boundary`: clean. Boundary reports 9 packages, none undeclared.
- `npx vitest run --maxWorkers=2 --testTimeout=10000`: 255 files, 4459 tests, all passed, exit 0, run in the foreground after the review round. The six-task build was green twice at 255 files and 4456 tests before it.
- `packages/sdk/test/fixtures/wire.jsonl` was rewritten by the earlier runs, as it is by every run on this box, and put back line by line to what HEAD holds (`https://api.anthropic.com/v1/models`), because `git checkout --` is refused in this session. The run after the review round left it untouched (`git status --porcelain packages/sdk/test/fixtures/` is empty), so nothing had to be restored this time.
- Nothing was committed, so there is no `git://` ref.

## Review round, 2026-10-08

Three findings from Softov's read of the diff. Each was written as a case that failed first, and each case is in `packages/sdk/test/plugin-boundary.test.ts`.

1. **`keptAgent` froze an agent's own properties and lost its class.** A backend written as a class keeps `schema`, `defaults`, `create` and the rest on the prototype, so the descriptor copy answered `provider` and nothing else - the fold's own `agent.schema()` threw `TypeError: agent.schema is not a function`, and a method that keeps state in `this` would have thrown against the frozen copy. It is now `Object.create(agent, { provider: { value: agent.provider, enumerable: true } })`: a view of the plugin's own agent whose one own property is the pinned `provider`, not frozen, so methods answer through the prototype and a write to `this` still works. `keeps the methods of an agent written as a class` is the case, and `keeps the provider a plugin registered its agent under` now says why the copy is unfrozen. `packages/sdk/src/plugins.ts`.
2. **A plugin that lost every trigger type dropped its fires in silence.** The `Object.keys(kept).length === 0` branch left `contribution.triggers` as the record the plugin registered in, so `fireTrigger` found the name it had lost and handed the event to a `deliver` that was never set. It is now pointed at the host's own empty entry (`types: Object.freeze({})`), which is not pushed into `pluginTriggers`, and the fire throws the sentence this host answers for a type a plugin does not hold. `refuses a type another plugin already has, and a fire of it is refused too` is the case. `packages/sdk/src/plugins.ts`.
3. **A principal was frozen one level deep at two sites, and `roles` is the level that decides a grant.** `packages/sdk/src/users.ts` now builds the directory's principal as `roles: Object.freeze([...record.roles, ...fromIssuer])`, as `ROOT` already did; `packages/sdk/src/host.ts` gained `heldPrincipal(who)`, which freezes the `roles` array of the principal an embedder hands `accept` and then the principal, in place rather than spread, because a directory principal carries getters that re-read the file. `freezes the roles a person signed in with, which no provider may add to` and `freezes the principal an embedder hands its host, roles and all` are the cases.

## Departures from the plan

- **The fold's head is a descriptor copy, not a spread (task 05).** The task named the site and the shape, and the fix is exactly that: `Object.defineProperties({}, Object.getOwnPropertyDescriptors(base))`, with `agents` still copied explicitly. It also fixes what the plan found on the way: `{ ...base }` read the daemon's `get mcpServers()` once, so a root-config edit would never have reached the next session.
- **A frozen `host` object in the sdk, beyond task 04's file list.** `PluginHost` extends `PluginContext`, so the object a plugin registers through is the context it reads: the server's frozen literal covers only the object listeners capture, and `pluginHost` spreads it into the plugin's own `host`. That object is frozen where it is built.
- **`fired`'s owner check is inside the door, not on the firing side.** A plugin's `fireTrigger` only accepts names in its own kept entry, so the check the task asked for is unreachable through the public API; it is kept because a type is the host's to arbitrate, and it is written where the host looks a type up.
- **`sessionOwner` needed no freezing.** It answers an `Owner`, which is a string type, so there is no value a plugin could write to. The writable principal was the one handed to a resource provider's `read`, `write` and `remove`, and that is task 01's work.
- **The options `apply` receives are a copy, not a frozen one.** A `secretAtUse` node inside them is frozen, and the rest is the plugin's own fresh tree, so a write there changes nothing the daemon holds but does not throw. `docs/PLUGINS.md` says it that way rather than overstating the promise.
- **`as Bag` on a contract type does not typecheck.** Eleven casts written in tasks 02 to 04 reached past a typed value (`PluginHost`, `Agent`, `McpServer`) to write to it; the root `tsconfig.json` includes the tests, so `pnpm typecheck` failed on all of them. They now go through one documented helper, `bag(one)`, which casts through `unknown`.

## Left for later

- The rule is enforced on the host's side only. A plugin may still import `fs` or patch a module another plugin imported; running plugins out of process is the real boundary, and the plan says so.
- `say()` lets any plugin add a Host name every route accepts. The plan weighed it and left it out.
