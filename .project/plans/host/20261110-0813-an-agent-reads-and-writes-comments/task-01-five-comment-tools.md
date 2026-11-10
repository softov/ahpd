---
title: Five comment tools on the channel
status: implemented
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

- **Done so far:** `packages/sdk/src/tools/comments.ts` holds VS Code's five tools, by name, schema, wording and refusal, and `applyCommentTool` is the pure part: it reads `AnnotationsState` and answers the actions and the model's text. A comment is an annotation carrying `_meta['vscode.agentFeedback']`, and only one with that slot is listed, replied to, resolved or deleted. `addComment` writes a `codeReview` comment in the `created` state, with the turn's origin and one `agent` entry, and its range becomes zero-based; `listComments` hides `created` and, by default, resolved comments; `replyToComment` adds an `agent` entry; `resolveComments` writes `resolved` or `submitted` back and carries a client's other meta fields through untouched; `deleteComments` removes the ids it found and names the ones it did not. All five set `deferLoading: true`, and the four writers ask `session:review` with `may` and refuse with the host's own sentence. Every write goes through `markAnnotation`, which a client's `annotations/*` action now takes too, so the channel is one state and one notice whichever produced it. `commentTools()` is registered beside `artifactTools()` in `hostTools()`.
- **Next action:** [task-02-view-unreviewed-comments.md](task-02-view-unreviewed-comments.md).
- **Open questions:** none.
- **Watch out for:** the by-hand check in VS Code was not run. The cases drive the tools through a host and read its annotations channel, so VS Code itself is still to confirm. An annotation that carries the key with the wrong shape is somebody else's, not a comment, and the tools leave it alone.

Files changed by this task: `packages/sdk/src/tools/comments.ts`, `packages/sdk/src/tools/index.ts`, `packages/sdk/src/host.ts`, `packages/sdk/src/host/actions.ts`, `packages/sdk/src/host/context.ts`, `packages/sdk/src/host/snapshots.ts`, `packages/sdk/src/host/tooling.ts`, `packages/sdk/src/types/host.ts`, `packages/sdk/test/commenttools.test.ts`, `packages/sdk/test/host-tools.test.ts`, `packages/sdk/test/host-github.test.ts`, `docs/sdk/TOOLS.md`, `docs/updates/v0_15.md`.
