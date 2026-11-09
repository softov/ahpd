---
title: A server's line keeps its level
status: done
depends: [task-01-the-hosts-log-takes-a-level.md]
layer: "sdk, agent-acp"
refs:
  - "[code://packages/agent-acp/src/connection.ts#L242-L272](../../../../packages/agent-acp/src/connection.ts#L242-L272) - each line of an ACP server's stderr, logged as `<command> stderr: <line>`"
  - "[code://packages/sdk/src/log.ts](../../../../packages/sdk/src/log.ts) - where `levelIn` goes, beside the levels"
---

## Objective

A line an ACP server writes on its stderr is logged at the level the line says, without the time the server put on it.
A line that says no level is logged at info.

## Files

- `UPDATE: packages/sdk/src/log.ts` - `levelIn(line)`: the level a line says, and the line without its time and level.
- `UPDATE: packages/sdk/src/index.ts` - export `levelIn`.
- `UPDATE: packages/agent-acp/src/connection.ts:242-272` - each stderr line goes through `levelIn`.
- `UPDATE: packages/sdk/src/sessions/nested.ts` - a session that failed in its machine logs at error, and one that stopped there at warn.
- `UPDATE: packages/sdk/test/log-levels.test.ts` - the cases in *Validation*.

## Steps

1. Read a level from a JSON line's `level`, as a word or as pino's number.
2. Read a level in brackets, or as a word after the line's own time.
3. Read a level word that opens a line: `WARN x`, `WARNING:x`, `Warning: x`.
4. Read logfmt's `level=`.
5. Answer nothing for a line with no level; the caller logs it at info.
6. Log each stderr line of an ACP server at the level `levelIn` reads.

## Validation

- `packages/sdk/test/log-levels.test.ts` has these cases:
  - A Rust line keeps its level and loses its time.
  - A level in brackets, a leading word, logfmt and JSON each give their level.
  - A line with no level gives nothing.
- `pnpm typecheck` and `pnpm test:unit` pass.

## Resume

Built on 2026-11-09 and merged in PR #259.
