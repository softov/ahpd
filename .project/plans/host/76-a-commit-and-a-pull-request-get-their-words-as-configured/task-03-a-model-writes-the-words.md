---
title: A model writes the words
status: todo
depends: [task-02-forced-and-session-title-modes.md]
layer: sdk
refs:
  - https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/agentHostPullRequestOperationHandler.ts#L636-L700 - the pull request prompt and how its answer is split
  - https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/agentHostCommitOperationHandler.ts#L81-L150 - the commit message prompt over the uncommitted diff
---

## Objective

In model mode, the named model writes the words from VS Code's prompts, and a failure falls back to the session title.

## Files

- `UPDATE: packages/sdk/src/changes.ts` - `wordsFor` asks the model in model mode.
- `CREATE: packages/sdk/src/changewords.ts` - the two prompts and the split of an answer into a title and a body.
- `CREATE: packages/sdk/test/changewords.test.ts` - the prompts, the split, and the fallback.

## Steps

1. Port VS Code's two prompts with their inputs: the branch, the base, the changed files, the diff and the conversation.
2. Call the provider and model from the setting once, with no tools.
3. Split the answer at the first blank line, and cut a title at 72 characters.
4. Fall back to the session title on a failure or an empty answer, and say so in the operation's result.

## Validation

- Tests use a fake provider for a good answer, an empty one and a failure.
- The gates pass.

## Resume
