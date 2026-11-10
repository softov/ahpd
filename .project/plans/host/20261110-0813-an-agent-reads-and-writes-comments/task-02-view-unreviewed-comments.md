---
title: viewUnreviewedComments asks first
status: implemented
depends:
  - task-01-five-comment-tools.md
layer: "sdk"
refs:
  - "[code://packages/sdk/src/tools/comments.ts](../../../../packages/sdk/src/tools/comments.ts) - the comment tool group of task 01"
---

## Objective

`viewUnreviewedComments` asks the person before it shows the waiting comments, as VS Code's does.

## Files

- `UPDATE: packages/sdk/src/tools/comments.ts` - the sixth tool.
- `UPDATE: packages/sdk/test` - the cases of the tool.

## Steps

1. Copy the tool's schema, text and confirmation from VS Code at 171e90619.
2. Ask the person only when a comment waits for them.
3. Show every waiting comment, since no client lets the person pick yet.

## Validation

- No waiting comment answers with no question.
- A waiting comment asks, and an answer of no shows nothing.
- `pnpm typecheck`, then the sdk suite.

## Resume

- **Done so far:** `viewUnreviewedComments` is the sixth tool, with VS Code's schema, title, description and `readOnlyHint: false`, and `deferLoading: true`. It asks the person first, through `at.ask`, and only while `hasRevealableComments` says a review comment waits. That is a pull request or code review comment a window flagged with `pendingAgentReveal`, or one still in `created`. An answer of `Show them`, and only that, reveals every waiting comment; reading one accepts it, so `created` becomes `submitted` and a reveal flag is cleared. `listComments` appends VS Code's note counting the waiting comments and naming the tool. Like the other writers it asks `session:review` first, so a refused call asks no question. `docs/sdk/TOOLS.md` and the release note say so.
- **Next action:** Softov reviews the plan. `implemented.md` is written when the plan closes.
- **Open questions:** none.
- **Watch out for:** no client lets the person pick which comments to reveal. An answer of yes reveals all of them, as the plan's answer says. The confirmation is in this host's words, written in VS Code's style. The reference host's confirmation is a client-side view, and this mode reads VS Code only file by file. The tool's own text is VS Code's.

Files changed by this task: `packages/sdk/src/tools/comments.ts`, `packages/sdk/src/tools/index.ts`, `packages/sdk/src/host/snapshots.ts`, `packages/sdk/test/commenttools.test.ts`, `packages/sdk/test/host-tools.test.ts`, `packages/sdk/test/host-github.test.ts`, `docs/sdk/TOOLS.md`, `docs/updates/v0_15.md`.
