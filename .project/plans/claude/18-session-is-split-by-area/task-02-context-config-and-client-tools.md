---
title: The context, the session config and the client tools are files of their own
status: todo
depends: [task-01-common-and-customizations.md]
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session.ts#L674-L712](../../../../packages/agent-claude/src/session.ts#L674-L712) - `ClaudeSessionOptions`, which `session/context.ts` types `ctx.options` with"
  - "[code://packages/agent-claude/src/session.ts#L17-L30](../../../../packages/agent-claude/src/session.ts#L17-L30) - `EFFORTS`, `EFFORT_LABELS`"
  - "[code://packages/agent-claude/src/session.ts#L79-L111](../../../../packages/agent-claude/src/session.ts#L79-L111) - `ShellInitScript`, `MAX_SHELL_INIT_SCRIPT`, `shellInitScripts`, `sourcing`"
  - "[code://packages/agent-claude/src/session.ts#L530-L586](../../../../packages/agent-claude/src/session.ts#L530-L586) - `permissionFor`, `listsOf`"
  - "[code://packages/agent-claude/src/session.ts#L862-L897](../../../../packages/agent-claude/src/session.ts#L862-L897) - `initScript`, `sourced`, `setShellInit`, `sourceFirst`; line 890 is a construction statement and stays"
  - "[code://packages/agent-claude/src/session.ts#L3538-L3616](../../../../packages/agent-claude/src/session.ts#L3538-L3616) - methods `setConfig` and `settings`, with the orphan comment above `setConfig`"
  - "[code://packages/agent-claude/src/session.ts#L588-L672](../../../../packages/agent-claude/src/session.ts#L588-L672) - `shaped`, `contributed`"
  - "[code://packages/agent-claude/src/session.ts#L909-L981](../../../../packages/agent-claude/src/session.ts#L909-L981) - `offering`, `called`, `providedBy`, `unclaimed`, `expecting`, `opening`, `claim`, `byClient`, `releaseCalls`, `ranByClient`"
  - "[code://packages/agent-claude/src/session.ts#L4055-L4105](../../../../packages/agent-claude/src/session.ts#L4055-L4105) - methods `setTools`, `toolCallOwner`, `completeToolCall`, `clientGone`"
  - "[code://packages/sdk/src/host/context.ts#L31-L40](../../../../packages/sdk/src/host/context.ts#L31-L40) - the context shape copied"
---

## Objective

`session/context.ts` declares `SessionContext` and holds `ClaudeSessionOptions`; `createSession` builds one `ctx`; `session/config.ts` and `session/clienttools.ts` each export a factory that takes it and returns what the area offers and its `Session` methods, unchanged.

## Files

- `CREATE: packages/agent-claude/src/session/context.ts` - `ClaudeSessionOptions` (674-712) and `SessionContext`, types only: `options`, `settings`, `declared`, the fields this task makes of `let`s (`allowed`, `chosen`, `offering`, `handle`), `doing` until task 03 moves it, and `extends Config, ClientTools`.
- `CREATE: packages/agent-claude/src/session/config.ts` - module-level `EFFORTS`, `EFFORT_LABELS`, `ShellInitScript`, `MAX_SHELL_INIT_SCRIPT`, `shellInitScripts`, `sourcing`, `permissionFor`, `listsOf`; `createConfig(ctx)` with `initScript`, `sourced`, `setShellInit`, `sourceFirst`, offering `initScript`, `setShellInit`, `sourceFirst` and the methods `setConfig` and `settings`.
- `CREATE: packages/agent-claude/src/session/clienttools.ts` - module-level `shaped`, `contributed`; `createClientTools(ctx)` with `called`, `providedBy`, `unclaimed`, `expecting`, `opening`, `claim`, `byClient`, `releaseCalls`, `ranByClient`, offering `providedBy`, `opening`, `releaseCalls`, `ranByClient` and the methods `setTools`, `toolCallOwner`, `completeToolCall`, `clientGone`.
- `UPDATE: packages/agent-claude/src/session.ts` - those removed; `const ctx = { ... } as SessionContext` built at the top of `createSession`; `Object.assign(ctx, createConfig(ctx))` and `Object.assign(ctx, createClientTools(ctx))`; the two method tables spread into `self`; re-exports `EFFORTS`, `EFFORT_LABELS`, `permissionFor` and the type `ClaudeSessionOptions`.

## Steps

1. Move each declaration and method with its comment, unchanged but for indentation, `export` and `ctx.`.
2. `allowed`, `chosen`, `offering` and `handle` become fields: each comment moves onto its field in `context.ts`, the initial value goes into the `ctx` literal, and every reader and writer, in the new files and in `session.ts`, uses `ctx.<name>`; none is taken into a local.
3. `settings` becomes a field of the `ctx` literal with its value, its comment and the one above it at 837 moving onto the field in `context.ts`; `declared` stays where it is declared and `session.ts` puts it on `ctx` (`ctx.declared = declared`) until task 07 moves it into `session/servers.ts`.
4. `doing` is still in `session.ts` and `ranByClient` calls it, so `session.ts` puts it on `ctx` until task 03 moves it.
5. The construction statements stay where they are, in order, after both factories: `if (settings.shellInitScripts !== undefined) ctx.setShellInit(...)`, then `if (ctx.offering.length > 0) declared.ahp = contributed(ctx.offering, ctx.ranByClient)`, then `ctx.handle = startQuery(running, true)`; the comment above `running` and `handle` stays above `running` until task 07.
6. `close` reads `ctx.initScript` and `ctx.releaseCalls`; `cancel` reads `ctx.releaseCalls`; `assistant` reads `ctx.providedBy` and `ctx.opening`.
7. `index.ts`, `claude.ts` and `probe.ts` are not touched: `session.ts` re-exports what moved.

## Validation

- `pnpm exec tsc --noEmit` passes.
- `pnpm boundary` passes.
- `pnpm exec vitest run packages/agent-claude` passes; `agent-claude-options.test.ts`, `agent-claude-presets.test.ts`, `agent-claude-declarations.test.ts`, `agent-claude-restored-model.test.ts` and `agent-claude-close.test.ts` cover config, the declared tools and the shell script's removal.
- Pure-move check, against the commit the task started from, with the new files marked by `git add -N packages/agent-claude/src/session`: every line the task removed reappears among the lines it added, comparing both sides with indentation, `export ` and `ctx.` stripped.

  ```
  strip() { sed -E "s/^$1[[:space:]]*//; s/^export //; s/ctx\.//g" | sort; }
  comm -23 <(git diff -U0 -- packages/agent-claude/src | grep -E '^-[^-]' | strip -) \
           <(git diff -U0 -- packages/agent-claude/src | grep -E '^\+[^+]' | strip '\+')
  ```

  It prints only import lines and the `let` declarations that became fields; the same two lists with `comm -13` show the added lines that are new, which are only imports, factory signatures, the interfaces of what each area offers, `SessionContext` fields, the `ctx` literal and the spreads into `self`.
- `wc -l packages/agent-claude/src/session.ts packages/agent-claude/src/session/*.ts` recorded in *Resume*.

## Resume
