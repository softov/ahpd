---
title: The answers come from the entry
status: todo
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/transcript.ts](../../../../packages/agent-claude/src/transcript.ts) - `turnsOf` and `buildTurns`, which this task changes"
  - "[code://packages/agent-claude/test/agent-claude-tool-input.test.ts](../../../../packages/agent-claude/test/agent-claude-tool-input.test.ts) - the cases for a restored question"
  - "[code://packages/agent-claude/test/agent-claude-subagent-restore.test.ts](../../../../packages/agent-claude/test/agent-claude-subagent-restore.test.ts) - the cases for a restored subagent"
---

## Objective

A restored question carries its answers, in the session and in the chat of a subagent.
The answers come from the `toolUseResult` of the entry that holds the result.

## Files

- `UPDATE: packages/agent-claude/src/transcript.ts:47-60` - `turnsOf` puts the answered `toolUseResult` of each entry on the message with its `uuid`.
- `UPDATE: packages/agent-claude/src/transcript.ts:278-288` - `buildTurns` reads the answers from the entry.
- `UPDATE: packages/agent-claude/test/agent-claude-tool-input.test.ts` - the fixture writes the file of the session and puts `toolUseResult` on the entry.
- `UPDATE: packages/agent-claude/test/agent-claude-subagent-restore.test.ts` - a case for a question that a restored subagent asked.
- `UPDATE: packages/agent-claude/README.md` - "What it does" says where a restored question finds its answers.
- `UPDATE: CHANGELOG.md` - an entry under `0.14.1 - unreleased`.

## Steps

1. Add `answeredIn`, which reads the file of a session one line at a time.
2. Parse only a line that names `answers`, and keep its `toolUseResult` when the answers are not empty.
3. In `turnsOf`, put each kept `toolUseResult` on the message with the same `uuid`.
4. In `buildTurns`, read the answers from the `toolUseResult` of the entry.
5. Make the mocked `getSessionMessages` leave out `toolUseResult`, and write the file of the session.
6. Add the case for the subagent, with the answers on the entry.
7. Add the sentence to the README and the changelog entry.

## Validation

- Test in `packages/agent-claude/test/agent-claude-tool-input.test.ts` that a restored answered question carries its answers and its request part.
- Test in `packages/agent-claude/test/agent-claude-subagent-restore.test.ts` that a question a restored subagent asked carries its answers.
- Run the cases on the module before this change, and see them fail.
- `pnpm boundary`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Resume

