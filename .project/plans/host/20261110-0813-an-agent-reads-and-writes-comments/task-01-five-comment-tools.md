---
title: Five comment tools on the channel
status: todo
depends: []
layer: "sdk, docs"
refs:
  - "[code://packages/sdk/src/tools/artifacts.ts#L184](../../../../packages/sdk/src/tools/artifacts.ts#L184) - `artifactTools`, the pattern"
  - "[code://packages/sdk/src/host/snapshots.ts#L413-L420](../../../../packages/sdk/src/host/snapshots.ts#L413-L420) - the annotations channel"
---

## Objective

ahpd serves `addComment`, `listComments`, `replyToComment`, `deleteComments` and `resolveComments` on the session's annotations channel, with VS Code's meta and text.

## Files

- `CREATE: packages/sdk/src/tools/comments.ts` - the comment tool group.
- `UPDATE: packages/sdk/src/host/snapshots.ts:413-420` - the comment on the channel says which tools write it.
- `UPDATE: packages/sdk/test` - the cases of each tool.
- `UPDATE: docs/sdk/TOOLS.md` - the tools.

## Steps

1. Copy each tool's schema and text from VS Code's `agentFeedbackServerTools.ts` at 171e90619.
2. Write each comment as an annotation with `_meta['vscode.agentFeedback']`, as VS Code's `agentFeedbackAnnotations.ts` shapes it.
3. Read only annotations that carry that meta.
4. Send each write through the host's `annotations/*` action path, so every client sees it.
5. Require `session:review` for the tools that write.
6. Register the group beside `artifactTools`.

## Validation

- A comment added, listed, replied to, resolved and deleted.
- An annotation with no comment meta is not listed and not touched.
- `pnpm typecheck`, then the sdk suite.
- By hand: a comment through ahpd shows in VS Code.

## Resume

