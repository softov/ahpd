---
title: The tool and truncation tests fail when their fix is taken out
status: implemented
depends: [task-06-a-rebuild-keeps-the-session.md]
layer: "agent-pi"
refs:
  - "[code://packages/agent-pi/test/agent-pi.test.ts](../../../../packages/agent-pi/test/agent-pi.test.ts) - the cases that pass without their fix"
---

## Objective

Each case named below fails when the line it guards is removed.

## Files

- `UPDATE: packages/agent-pi/test/agent-pi.test.ts`
- `UPDATE: packages/agent-pi/test/agent-pi-truncate.test.ts`

## Steps

1. The contributor: a client tool call through `begin` puts `contributor` on the wire.
2. The rebuild: `opens[1]` carries `onToolCall`, `instructions` and the tools.
3. The schema: `toPiTool` passes the tool's `inputSchema` properties to pi.
4. The end point: a truncation asked on the turn's `chat/turnComplete` finds its `endPoint`.

## Validation

- For each of the four, the Resume says which line was removed and that the case failed.
- `node_modules/.bin/vitest run packages/agent-pi` green.

## Resume

Built, by removing each guarded line and reading which case failed:
1. Contributor: removing `ownerOf: clientOf` from `begin`'s mapping made `does not send a client tool to its client until the person approves it` fail with `contributor` `undefined`.
2. Rebuild: removing `onToolCall: askBefore` from `build` made `rebuilds pi on the same session and the model it was on` fail on `opens[1].onToolCall`, and `still asks under projectTrust deny` fail too.
3. Schema: changing `parameters` to `Type.Unsafe({ type: 'object' })` made `converts a bound tool to pi definition, keeping the name, title and schema` fail on `properties.path`. That case was strengthened from the bare `type` check to assert the input schema's `properties` and `required`.
4. End point: removing `ends.set(String(active.id), at)` made `answers where a watched turn ended, and nothing for one it never saw end` and the host's `accepts a truncation through the host and rewinds the restarted session` fail.

- `node_modules/.bin/vitest run packages/agent-pi` green, 91 tests; `pnpm typecheck` green.
