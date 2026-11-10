---
title: send_message replaces, cancels and steers
status: implemented
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/tools/session.ts#L682-L711](../../../../packages/sdk/src/tools/session.ts#L682-L711) - `send_message`"
---

## Objective

`send_message` takes VS Code's `operation`, `delivery`, `messageId` and `expectedRevision`, and answers a sent message's id and revision.

## Files

- `UPDATE: packages/sdk/src/tools/session.ts:682-711` - the inputs, the text and the run.
- `UPDATE: packages/sdk/test` - a case for each operation and delivery.
- `UPDATE: docs/server/MCP.md` - the new inputs.

## Steps

1. Copy VS Code's `send_message` schema and description at 171e90619.
2. Send a `steer` delivery as the host's steering message of the chat's running turn.
3. Send a `queue` delivery as a queued message, as today, and answer its id and revision.
4. Make `replace` and `cancel` act only on a queued message this chat sent, at the revision given.
5. Refuse in VS Code's words where VS Code refuses.

## Validation

- A case for `steer` on a running turn, `replace` and `cancel` of a queued message, and a stale `expectedRevision`.
- `pnpm typecheck`, then the sdk suite.

## Resume

Implemented 2026-11-10. `send_message` takes VS Code's `operation` (`send`, `replace`, `cancel`), `delivery` (`queue`, `steer`), `messageId` and `expectedRevision`. It answers JSON with `action`, `messageId`, `revision` and `openLink`, in VS Code's terms: `started`, `queued`, `steered`, `replaced`, `cancelled`, `notReplaced`, `notCancelled` or `rejected`. A `steer` sets the chat's steering message on a running turn. An idle chat is refused `cannotSteer`. `replace` and `cancel` act only on a pending queued message the same chat sent, at `expectedRevision`. They answer `messageNotFound`, `messageNotOwned`, `revisionConflict` or the message's status otherwise. `ToolCall.send` takes a `SendMessageRequest` and answers a `SendMessageAnswer`. `packages/sdk/src/host/tooling.ts` holds the shared `deliver`. Cases are in `packages/sdk/test/sessiontools.test.ts` and `packages/sdk/test/host-tools.test.ts`; `docs/server/MCP.md` names the new inputs. Gate: typecheck clean. The sdk suite passed 4621 and failed 1: `watches.test.ts > honours the excludes it was given`. The prescribed `TMPDIR` inside the worktree breaks it, because the case's own paths then contain `node_modules/`. It passes with `TMPDIR` outside the repository. It does not read this tool. A `GIT_CEILING_DIRECTORIES` entry in the untracked config keeps the worktree suite's no-repository cases honest.

