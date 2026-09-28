---
title: A path is judged where pi puts it, reads outside the workspace ask, and pi's own tools keep their effects
status: implemented
depends: [task-02-a-mode-says-which-calls-ask.md]
layer: "agent-pi"
refs:
  - "[code://packages/agent-pi/src/session.ts#L235-L300](../../../../packages/agent-pi/src/session.ts#L235-L300) - `PI_EFFECTS`, `effectsOf`, `insideWorkspace` and `decide`"
  - "[code://packages/agent-cofold/src/agent.ts#L115-L135](../../../../packages/agent-cofold/src/agent.ts#L115-L135) - cofold's modes: a read outside the workspace asks, and a tool with no effects runs"
  - npm://@earendil-works/pi-coding-agent@^0.87.1 - `dist/core/tools/path-utils.js`: `~` expanded and a leading `@` stripped before a path is used
---

## Objective

The modes judge a path where pi will read or write it, a read outside the workspace asks as cofold's does, a tool with no `effects` runs as cofold's does, and a host tool dropped for shadowing a pi built-in has no say over the built-in.

## Files

- `UPDATE: packages/agent-pi/src/session.ts:235-300` - the path resolution, the read rule, the no-effects rule and the order of `effectsOf`.
- `UPDATE: packages/agent-pi/test/agent-pi.test.ts` - the cases below.

## Steps

1. Resolve a tool's path as pi does (`~` expanded, a leading `@` stripped, relative to the session's directory) and then follow symlinks, the target's nearest existing ancestor for a path that does not exist yet, before judging it inside.
2. `read`, `grep`, `find` and `ls` with a path outside the workspace ask in `default`, `acceptEdits` and `plan`, and are refused in `dontAsk`, as cofold's do.
3. A tool with no `effects` is treated as `{}` and runs, as cofold's `createTool` treats it.
4. `effectsOf` looks at `PI_EFFECTS` first for a name pi owns, so a host tool that was dropped for having that name changes nothing.

## Validation

- `packages/agent-pi/test/agent-pi.test.ts`: under `acceptEdits`, `write` to `~/.bashrc`, to `@/etc/x` and through a symlink out of the workspace each ask; today each runs.
- `read` of `/etc/hosts` asks in `default`, `acceptEdits` and `plan` and is refused in `dontAsk`; today it runs in every mode.
- A client tool with no effects runs in `default` without asking.
- A host tool named `bash` declaring only reads, dropped by `toPiTool`, leaves pi's `bash` asked in `default`.
- `node_modules/.bin/vitest run packages/agent-pi` green.

## Resume

Built.
`session.ts` resolves a tool's path as pi does: unicode spaces folded, a leading `@` stripped, `~` expanded, `file:` URLs read, then relative to the session's directory.
It follows symlinks up to the nearest ancestor that exists before judging the path inside, so a write through a link out of the workspace asks.
A read outside the workspace asks in `default`, `acceptEdits` and `plan` and is refused in `dontAsk`, and a read that names no path reads where the session works.
A tool that declares no `effects` is treated as `{}` and runs, as cofold's does.
`effectsOf` reads pi's own names first, so a host tool dropped for shadowing `bash` leaves the built-in asked.

- Failed first: the four cases read `run` where `ask` was expected for `~/.bashrc`, `@/etc/x`, a symlink out, an outside read and a dropped `bash`, and `ask` where `run` was expected for a tool with no effects.
- `node_modules/.bin/vitest run packages/agent-pi` green, 80 tests; `pnpm typecheck` green.
