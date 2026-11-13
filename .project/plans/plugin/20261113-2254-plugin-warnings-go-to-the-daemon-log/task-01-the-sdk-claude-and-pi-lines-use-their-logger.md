---
title: The sdk, claude and pi lines use their logger
status: implemented
depends: []
layer: "sdk, agent-claude, agent-pi, server"
refs:
  - "[code://packages/agent-claude/src/claude.ts](../../../../packages/agent-claude/src/claude.ts) - `createSession` gets `log`"
  - "[code://packages/agent-pi/src/tools.ts](../../../../packages/agent-pi/src/tools.ts) - `toPiTool` takes `log`"
  - "[code://packages/sdk/src/repo/worktrees.ts](../../../../packages/sdk/src/repo/worktrees.ts) - `gitWorktrees` takes `log`"
  - "[code://packages/sdk/src/host/tooling.ts](../../../../packages/sdk/src/host/tooling.ts) - the retool lines use `ctx.log`"
---

## Objective

The twelve lines in agent-claude, agent-pi and the sdk write through the logger each package has, at `warn`.

## Files

- `UPDATE: packages/agent-claude/src/session/context.ts`, `claude.ts`, `session/turns.ts`, `session/config.ts`, `session/query.ts`.
- `UPDATE: packages/agent-pi/src/tools.ts`, `session.ts`.
- `UPDATE: packages/sdk/src/repo/worktrees.ts`, `host/tooling.ts`.
- `UPDATE: packages/server/src/commands/run.ts` - `gitWorktrees({ log: stamp })`.
- `UPDATE` the tests that spied on `console.warn`: two in agent-claude, two in agent-pi, and `fake-pi.ts`.

## Steps

1. Add `log` to `ClaudeSessionOptions`, and pass `options.log` to `createSession`.
2. Write the six agent-claude lines with `ctx.options.log?.(line, 'warn')`.
3. Give `toPiTool` a `log`, pass `options.log` to it, and write the two session lines with `options.log`.
4. Give `gitWorktrees` an options object with `log`, and pass the daemon's `stamp`.
5. Write the two tooling lines with `ctx.log.warn`.
6. Make the tests read the lines a session logged, in place of a spy on `console.warn`.

## Validation

- The agent-claude, agent-pi, sdk and server suites pass.

## Resume

Implemented 2026-11-13. See [implemented.md](implemented.md).
