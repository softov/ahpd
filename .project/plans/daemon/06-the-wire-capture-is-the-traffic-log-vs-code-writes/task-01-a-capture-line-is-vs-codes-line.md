---
title: A capture line is VS Code's line
status: todo
depends: []
layer: "server"
refs:
  - "[code://packages/server/src/commands/run.ts#L344-L360](../../../../packages/server/src/commands/run.ts#L344-L360) - the tap to change"
  - "[code://tools/wire.mjs#L221-L232](../../../../tools/wire.mjs#L221-L232) - `framesIn`, and the checker it feeds"
  - "[code://test/wire.test.ts](../../../../test/wire.test.ts) - where the capture's lines are asserted"
  - file:///github/externals/vscode/src/vs/platform/agentHost/common/ahpJsonlLogger.ts - `IAhpLogMeta` and `log()`, the shape copied
---

## Objective

Each line `--wire` writes is the JSON-RPC message with a root-level `_ahpLog` of `ts`, `dir`, `connectionId`, `transport` and `byteLength`, and `pnpm wire` checks such a capture clean.

## Files

- `UPDATE: packages/server/src/commands/run.ts:344-360` - the tap builds `{ ...message, _ahpLog }` instead of `{ at, from, peer, frame }`.
- `UPDATE: tools/wire.mjs` - the checker skips `_ahpLog` on a message; `framesIn` keeps reading the old `frame` shape.
- `UPDATE: test/wire.test.ts` - the new line, and an old-shape line still read.

## Steps

1. Map `from` to `dir`: `client` is `c2s`, `host` is `s2c`.
2. `connectionId` is `String(peer)`; `transport` is `stdio` when the daemon answers over stdio and `websocket` otherwise; `byteLength` is the frame's UTF-8 length.
3. A frame that does not parse as JSON becomes `{ "_raw": text, "_ahpLog": ... }`, so every line is still JSON.
4. Keep the append synchronous, and keep the tap from throwing.
5. In `tools/wire.mjs`, drop `_ahpLog` from a message before it is checked, so the closed-object check does not report it.

## Validation

- `test/wire.test.ts`: a request, its answer and an action land as three lines with the right `dir` and a `connectionId`; a non-JSON frame lands as `_raw`.
- `pnpm wire -- test/fixtures/wire.jsonl` and `pnpm wire -- <a new capture>` both report no defects.
- `pnpm test`, `pnpm typecheck` green.

## Resume

