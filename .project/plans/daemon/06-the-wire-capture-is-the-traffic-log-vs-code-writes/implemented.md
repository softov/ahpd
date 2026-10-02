---
title: The wire capture is the traffic log VS Code writes - implemented
date: 2026-10-02
refs:
  - "[code://packages/server/src/wire.ts](../../../../packages/server/src/wire.ts)"
  - "[code://packages/server/src/commands/run.ts](../../../../packages/server/src/commands/run.ts)"
  - "[code://tools/wire.mjs](../../../../tools/wire.mjs)"
---

`ahpd --wire <file>` writes the traffic log in the shape VS Code's agent host writes, one message per line with `_ahpLog` beside it, rolled at 75 MiB into five files, with long lines cut, and readable only by its owner.

## What was built

- [`code://packages/server/src/wire.ts`](../../../../packages/server/src/wire.ts) - `lineFor` (the message at the root, `_raw` for a frame that is not an object, `_ahpLog` with `ts`, `dir`, `connectionId`, `transport`, `byteLength`), `writerFor` (append, roll, line cap with `truncated`, `0600` on every file), `filesOf`.
- [`code://packages/server/src/commands/run.ts`](../../../../packages/server/src/commands/run.ts) - the tap writes through `writerFor`; `diagnostics.logs` names every capture file, oldest first.
- [`code://tools/wire.mjs`](../../../../tools/wire.mjs) - the checker takes `_ahpLog` off before checking; `framesIn` reads both the old and the new line.
- `docs/DAEMON.md`, `docs/AHP.md` - the `--wire` row and the two shapes.

## Verified

- `pnpm exec tsc --noEmit` clean, `pnpm test` 151 files and 2212 tests, `pnpm boundary` clean.
- `packages/server/test/wire-writer.test.ts` (11): rolls and keeps five files, the first frame is never rolled away, a long line is cut and marked, `filesOf` names what exists, `0600` when new, over a `0644` file, and after a roll.
- `packages/sdk/test/wire.test.ts`: the line shape, `_raw`, both shapes read, `_ahpLog` not reported.
- `node tools/validate.mjs packages/sdk/test/fixtures/wire.jsonl`: 122 frames, nothing undeclared, nothing missing.

## Departures from the plan

- `wire.ts` was made in task 01 rather than task 02, and the mode is set there rather than in `run.ts`.
- Five files are the live file and four rolls, `.1` to `.4`, as VS Code counts them.
- The checker never reported `_ahpLog`, since it sits at the root; the strip is kept so it never does.
- The fixture is `packages/sdk/test/fixtures/wire.jsonl`, not `test/fixtures/wire.jsonl`.

## Left for later

- none.
