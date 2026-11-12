---
title: The port answers a host URL
status: todo
depends: []
layer: "sdk, agent-acp"
refs:
  - "[code://packages/sdk/src/types/computers.ts#L293](../../../../packages/sdk/src/types/computers.ts#L293) - beside `how`"
  - "[code://packages/agent-acp/src/session/opening.ts#L80-L172](../../../../packages/agent-acp/src/session/opening.ts#L80-L172) - `toolsReachable` and `serversFor`"
---

## Objective

`serversFor` uses the URL that `computers.reach(id, url)` answers for the tools endpoint, and keeps `toolsReachable` when there is no answer.

## Files

- `UPDATE: packages/sdk/src/types/computers.ts:293` - add `reach?(id: string, url: string): Promise<string | undefined>` with its doc comment.
- `UPDATE: packages/sdk/src/machines/computers.ts:207-209` - the gated port passes `reach` through.
- `UPDATE: packages/agent-acp/src/session/opening.ts:123-184` - `serversFor` asks `reach` before `toolsReachable`.
- `UPDATE: packages/agent-acp/test/agent-acp-catalog.test.ts:487-522` - cases for an answer and for none.

## Steps

1. Add `reach` to the port type, documented as the URL a machine uses for a host URL, or `undefined`.
2. Pass `reach` through the gated port in `machines/computers.ts`.
3. In `serversFor`, call `reach` for a machine session and use its answer as the endpoint URL.
4. Fall back to `toolsReachable` and its line when `reach` is absent or answers `undefined`.
5. Write the cases.

## Validation

- The new cases: an answer replaces the URL and keeps the tools; no answer keeps today's line.
- `pnpm typecheck` and the agent-acp suite pass.

## Resume
