---
title: The shared helpers and the customization list are files of their own
status: done
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session.ts#L64-L66](../../../../packages/agent-claude/src/session.ts#L64-L66) - `bag`, `list`, `str`, read by every area"
  - "[code://packages/agent-claude/src/session.ts#L32-L39](../../../../packages/agent-claude/src/session.ts#L32-L39) - `Published`, re-exported by `index.ts`"
  - "[code://packages/agent-claude/src/session.ts#L200-L528](../../../../packages/agent-claude/src/session.ts#L200-L528) - `customizationsOf`, `INTERNAL_AGENT`, `AGENT_FILE_MOST`, `agentNameOf`"
  - "[code://packages/agent-claude/src/probe.ts#L2](../../../../packages/agent-claude/src/probe.ts#L2) - imports `customizationsOf` from `./session.js`, which keeps working through the re-export"
  - "[code://packages/agent-claude/test/customizations.test.ts#L5](../../../../packages/agent-claude/test/customizations.test.ts#L5) - imports `customizationsOf` from `../src/session.js`"
  - "[code://packages/agent-claude/test/agent-claude-agent-pick.test.ts#L6](../../../../packages/agent-claude/test/agent-claude-agent-pick.test.ts#L6) - imports `agentNameOf` from `../src/session.js`"
---

## Objective

`session/common.ts` holds `bag`, `list` and `str`, and `session/customizations.ts` holds the customization list the CLI reports and the agent name a uri gives, unchanged; `session.ts` imports and re-exports them.
No context exists yet: everything this task moves is module-level and reads no session state.

## Files

- `CREATE: packages/agent-claude/src/session/common.ts` - `bag`, `list`, `str` (64-66), each exported.
- `CREATE: packages/agent-claude/src/session/customizations.ts` - `Published` (32-39), `customizationsOf` (200-478), `INTERNAL_AGENT` (480-481), `AGENT_FILE_MOST` (483-484), `agentNameOf` (486-528), with the `node:fs`, `node:path`, `node:url` and type imports they read.
- `UPDATE: packages/agent-claude/src/session.ts` - those removed; imports `bag`, `list`, `str` from `./session/common.js` and `customizationsOf` and `Published` from `./session/customizations.js`; re-exports `customizationsOf`, `INTERNAL_AGENT`, `agentNameOf` and the type `Published`.

## Steps

1. Move each declaration with its comment, unchanged; `bag`, `list` and `str` gain `export`.
2. Keep `customizationsOf` above `INTERNAL_AGENT` as today: the constant is read when the function runs, not when the module loads.
3. Drop from `session.ts` the imports only the moved code read (`existsSync`, `readFileSync`, `statSync`, `basename`, `fileURLToPath`, `McpServerState`).
4. Add no comment about the move.

## Validation

- `pnpm exec tsc --noEmit` passes.
- `pnpm boundary` passes.
- `pnpm exec vitest run packages/agent-claude` passes; `customizations.test.ts` and `agent-claude-agent-pick.test.ts` cover the moved functions through `../src/session.js`.
- Pure-move check, against the commit the task started from, with the new files marked by `git add -N packages/agent-claude/src/session`: every line the task removed reappears among the lines it added, comparing both sides with indentation, `export ` and `ctx.` stripped.

  ```
  strip() { sed -E "s/^$1[[:space:]]*//; s/^export //; s/ctx\.//g" | sort; }
  comm -23 <(git diff -U0 -- packages/agent-claude/src | grep -E '^-[^-]' | strip -) \
           <(git diff -U0 -- packages/agent-claude/src | grep -E '^\+[^+]' | strip '\+')
  ```

  It prints only import lines; the same two lists with `comm -13` show the added lines that are new, which are only imports and the re-exports.
- `wc -l packages/agent-claude/src/session.ts packages/agent-claude/src/session/*.ts` recorded in *Resume*; `session.ts` is about 3,900.

## Resume

- **Implemented** 2026-10-04 on `build/agents/6a395779`.
- `session/common.ts` (5 lines) and `session/customizations.ts` (345) created; `session.ts` is 3,896.
- `session.ts` drops `existsSync`, `readFileSync`, `statSync`, `basename`, `fileURLToPath` and `McpServerState`, imports `bag`/`list`/`str` and `agentNameOf`/`customizationsOf`, and re-exports `INTERNAL_AGENT`, `agentNameOf`, `customizationsOf` and the type `Published`.
- `pnpm exec tsc --noEmit`, `pnpm boundary` and `pnpm exec vitest run packages/agent-claude` (19 files, 169 tests) pass.
- Pure-move check run over the cumulative `git diff` rather than per task, because `git add -N` and committing are both out of bounds for this build: it prints import lines only, which is what the task predicts.

