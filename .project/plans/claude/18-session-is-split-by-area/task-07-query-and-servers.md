---
title: The query and the MCP servers are files of their own
status: implemented
depends: [task-06-asking.md]
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session.ts#L41-L42](../../../../packages/agent-claude/src/session.ts#L41-L42) - `UUID`"
  - "[code://packages/agent-claude/src/session.ts#L847-L860](../../../../packages/agent-claude/src/session.ts#L847-L860) - `values`, which becomes a field, and `fromPreset`, which moves"
  - "[code://packages/agent-claude/src/session.ts#L1361-L1444](../../../../packages/agent-claude/src/session.ts#L1361-L1444) - `waiting`, `wake`, `closed`, `peers`, `declared`, the `ahp` construction statement, `wanted`, `discover`, `steering`, `input`"
  - "[code://packages/agent-claude/src/session.ts#L2428-L2650](../../../../packages/agent-claude/src/session.ts#L2428-L2650) - `startQuery`, `running`, `handle`, `carried` (task 08), `reported`, `ends`"
  - "[code://packages/agent-claude/src/session.ts#L2688-L2735](../../../../packages/agent-claude/src/session.ts#L2688-L2735) - `take`, `switchAgent`"
  - "[code://packages/agent-claude/src/session.ts#L3065-L3337](../../../../packages/agent-claude/src/session.ts#L3065-L3337) - `consume` and the `void consume()` that stays"
  - "[code://packages/agent-claude/src/session.ts#L982-L989](../../../../packages/agent-claude/src/session.ts#L982-L989) - `onServer`"
  - "[code://packages/agent-claude/src/session.ts#L2897-L3063](../../../../packages/agent-claude/src/session.ts#L2897-L3063) - `refreshMcp`, `serverNamed`, `describe` and the `void describe()` that stays"
  - "[code://packages/agent-claude/src/session.ts#L3618-L3735](../../../../packages/agent-claude/src/session.ts#L3618-L3735) - methods `setCustomizationEnabled`, `startMcpServer`, `authenticated`, `awaiting`, `stopMcpServer`"
---

## Objective

`session/query.ts` exports `createQuery(ctx)`, which builds the CLI's query and reads its frames, and `session/servers.ts` exports `createServers(ctx)`, which holds the MCP servers and what the CLI says it offers and returns their five methods, unchanged.

## Files

- `CREATE: packages/agent-claude/src/session/query.ts` - module-level `UUID`; `createQuery(ctx)` with `fromPreset` (856-860), `waiting` with the comment above it (1361-1363), `input` (1429-1444), `startQuery` (2428-2608), `reported` (2631-2638), `ends` (2640-2650), `take` (2688-2706), `switchAgent` (2708-2735), `consume` (3065-3336), offering `waiting`, `startQuery`, `ends`, `take`, `switchAgent`, `consume`.
- `CREATE: packages/agent-claude/src/session/servers.ts` - `createServers(ctx)` with `onServer` (982-989), `declared` (1375-1383), `wanted` (1395-1396), `discover` (1398-1414), `refreshMcp` with the comment above it (2897-2997), `serverNamed` (3015-3017), `describe` (3019-3062), offering `onServer`, `declared`, `refreshMcp`, `describe` and the five methods.
- `UPDATE: packages/agent-claude/src/session/context.ts` - `extends Query, Servers`; fields `wake`, `closed`, `peers`, `steering`, `running`, `agentId`, `handshake`, `gone`, `customizations`, `offered`, `values`, with the comments of `peers`, `steering`, `agentId`, `gone`, `values` and the one above `running` and `handle`; `startNext` until task 08.
- `UPDATE: packages/agent-claude/src/session.ts` - those removed; `Object.assign(ctx, createQuery(ctx))`, `Object.assign(ctx, createServers(ctx))`; the construction statements read `ctx.handle = ctx.startQuery(ctx.running, true)`, `void ctx.describe().catch(() => {})` and `void ctx.consume()`, in today's order.

## Steps

1. Move each declaration and method with its comment, unchanged but for indentation, `export` and `ctx.`; the separator `// --- the run` at 2428 moves with `startQuery`.
2. The eleven `let`s above become fields; every reader and writer, including `self` (`agentId`, `models`, `customizations`, `workingDirectories`, `sessionState`, `chatState`), `beginTurn`, `steer`, `resume` and `close`, uses `ctx.<name>`.
3. `consume` compares `ctx.handle !== mine`, which is how a query this host put away is told from a CLI that died; it must read the field each time, never a copy.
4. `declared` moves from the `ctx` literal into `createServers` with its comment and is offered; the `ahp` construction statement at 1384-1393 stays in `session.ts`, after both factories and before `startQuery`.
5. `startNext` is still in `session.ts` and `consume` calls it, so `session.ts` puts it on `ctx` until task 08; the `onServer` that task 05 put on `ctx` from `session.ts` is removed.
6. `sourceFirst` and `canUseTool` are read off `ctx` in `startQuery`.

## Validation

- `pnpm exec tsc --noEmit` passes.
- `pnpm boundary` passes.
- `pnpm exec vitest run packages/agent-claude` passes; `agent-claude-agent-pick.test.ts`, `agent-claude-model-refusal.test.ts`, `agent-claude-restored-model.test.ts`, `agent-claude-turn-recorded.test.ts`, `agent-claude-presets.test.ts`, `agent-claude-declarations.test.ts` and `agent-claude-close.test.ts` cover the query options, a rebuilt query, the frames and the MCP state.
- Pure-move check, against the commit the task started from, with the new files marked by `git add -N packages/agent-claude/src/session`: every line the task removed reappears among the lines it added, comparing both sides with indentation, `export ` and `ctx.` stripped.

  ```
  strip() { sed -E "s/^$1[[:space:]]*//; s/^export //; s/ctx\.//g" | sort; }
  comm -23 <(git diff -U0 -- packages/agent-claude/src | grep -E '^-[^-]' | strip -) \
           <(git diff -U0 -- packages/agent-claude/src | grep -E '^\+[^+]' | strip '\+')
  ```

  It prints only import lines and the `let` declarations that became fields; the same two lists with `comm -13` show the added lines that are new, which are only imports, factory signatures, the `Query` and `Servers` interfaces, `SessionContext` fields, `ctx` literal entries and the spread into `self`.
- `wc -l packages/agent-claude/src/session.ts packages/agent-claude/src/session/*.ts` recorded in *Resume*.

## Resume

- **Implemented** 2026-10-04 on `build/agents/6a395779`.
- `session/query.ts` (581 lines) and `session/servers.ts` (341 lines) created; `session/context.ts` is 244 and `session.ts` is 853.
- Module-level `UUID` moved to `query.ts`. `createQuery(ctx)` holds `fromPreset`, `waiting`, `input`, `startQuery`, `reported`, `ends`, `take`, `switchAgent` and `consume`, and offers `waiting`, `startQuery`, `ends`, `take`, `switchAgent`, `consume`. `reported` is private to the factory: nothing outside it was left needing it.
- `createServers(ctx)` holds `onServer`, `declared`, `wanted`, `discover`, `refreshMcp`, `serverNamed` and `describe`, and offers `onServer`, `declared`, `refreshMcp`, `describe` plus `methods: { setCustomizationEnabled, startMcpServer, authenticated, awaiting, stopMcpServer }`, spread into `self` as `...servers.methods`. `wanted`, `discover` and `serverNamed` are private.
- The eleven `let`s are fields on `SessionContext`, each with the comment it had, and the `ctx` literal carries their initial values. `startNext` is a twelfth field, as the task's Files section asks, assigned with `ctx.startNext = startNext;` after its declaration.
- The construction statements read `ctx.handle = ctx.startQuery(ctx.running, true)`, `void ctx.describe().catch(() => {})` and `void ctx.consume()`, in today's order. The `ahp` statement stays in `session.ts` between the factories and `startQuery`, and writes `ctx.declared.ahp`.
- **Departure 7.** `turns` is a thirteenth field. `consume` pushes every finished turn onto it and reads its length for a compact boundary's id, so it crosses into `query.ts` as well; the plan's table does not name it, and `const turns` was otherwise a local of `createSession` that only `sessionState` also read.
- **Departure 8.** `cwd` and `uri` are read as `ctx.options.cwd` and `ctx.options.uri`, and `chatUri` in `refreshMcp` as `ctx.options.chatUri`. All three are destructured locals of `createSession` on fields `SessionOptions` already declares, the same answer as Departure 6; without it `startQuery` would have had no cwd.
- **Departure 9.** Two shorthands became explicit because the local is now a field: `customizations,` in the `session/customizationsChanged` emit and in `sessionState` are `customizations: ctx.customizations`. The pure-move check shows both, and nothing else moves.
- The comment above `describe` ("Ask the CLI what it can do") had already been orphaned above `refreshMcp`'s own comment in `session.ts`; it moves with `describe` as the ref asks, and `refreshMcp` keeps "Re-read the MCP servers and say what changed".
- `session.ts` drops `protectedResource`, `urlOf`, `flagSettingsOf`, `queryOptionsOf`, `Status`, `idOf`, `Scope` and `Published` from its imports and re-exports; `Published` is still re-exported, since `index.ts` imports it from `../session.js`.
- `pnpm exec tsc --noEmit`, `pnpm boundary` and `pnpm exec vitest run packages/agent-claude` (19 files, 169 tests) pass.
