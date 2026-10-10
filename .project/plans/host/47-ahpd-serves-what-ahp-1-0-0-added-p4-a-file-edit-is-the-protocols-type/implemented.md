---
title: A file edit is the protocol's type, and a Claude write confirmation previews its edit - implemented
date: 2026-10-09
refs:
  - "[code://packages/sdk/src/types/changes.ts](../../../../packages/sdk/src/types/changes.ts)"
  - "[code://packages/sdk/src/changes.ts](../../../../packages/sdk/src/changes.ts)"
  - "[code://packages/agent-claude/src/input.ts](../../../../packages/agent-claude/src/input.ts)"
  - "[code://packages/agent-claude/src/session/asking.ts](../../../../packages/agent-claude/src/session/asking.ts)"
---

The file edits ahpd builds use the protocol's own `FileEdit` and `ContentRef` types.
A Claude `Write`, `Edit` or `MultiEdit` that waits for approval now carries the edit it would make.
A client can draw the diff before the person answers.

## What was built

- [`code://packages/sdk/src/types/changes.ts`](../../../../packages/sdk/src/types/changes.ts) - the local `ContentRef` and `FileEdit` are gone; the protocol's `ContentRef`, `FileEdit`, `FileEditSide` and `FileEditCollection` are re-exported. `ChangesetSource` gained `propose` and `settle`.
- [`code://packages/sdk/src/changes.ts`](../../../../packages/sdk/src/changes.ts) - `propose` reads the file, applies the tool's change and holds the result under `ahp-edit://pending/<session>/<call>/<path>`. `read` serves it, and `settle` drops it.
- [`code://packages/sdk/src/host/spawn.ts`](../../../../packages/sdk/src/host/spawn.ts) - `Start.onEditProposed` and `Start.onEditSettled` pass a session's calls to the changes source. A session with no folder gets no preview.
- [`code://packages/agent-claude/src/input.ts`](../../../../packages/agent-claude/src/input.ts) - `writeOf` makes the text that `Write`, `Edit` and `MultiEdit` would leave. An edit that does not fit the file gives no preview.
- [`code://packages/agent-claude/src/session/asking.ts`](../../../../packages/agent-claude/src/session/asking.ts) - `canUseTool` asks for the preview before the question goes out and puts `edits` on the call and on the ready action. `settleEdits` drops the preview on the answer. `turns.ts`, `query.ts` and `session.ts` drop every preview when a turn stops, a turn ends or the session closes.
- [`code://packages/agent-claude/test/agent-claude-edit-preview.test.ts`](../../../../packages/agent-claude/test/agent-claude-edit-preview.test.ts), [`code://packages/sdk/test/changes-uris.test.ts`](../../../../packages/sdk/test/changes-uris.test.ts) - the preview of each tool, the cases with no preview, settling, and the pending URI read back through `read`.

## Verified

- The full gates on the review tree: schema, build, typecheck and boundary are clean. The suite ran 4723 tests with 1 failure, in `computer-attachments.test.ts`, which is the known flake. That file passed 3 runs of 3 on its own.
- The builder's own run passed 4698 tests.

## Departures from the plan

- Task 02 named `packages/agent-claude/src/session.ts` for the backend half. The claude/18 split moved that code, so the work is in `session/asking.ts`, `session/turns.ts` and `session/query.ts`.

## Left for later

- `propose` reads the file a tool names before anyone approves the call, and that file can be outside the session's folder. The preview of an `Edit` holds the whole file, so a client of the session sees the file's text before the answer. It is the same text the tool would read once approved.
