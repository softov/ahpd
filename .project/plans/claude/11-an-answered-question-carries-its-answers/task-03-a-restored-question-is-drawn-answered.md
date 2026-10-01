---
title: A restored question is drawn as the answered question
status: todo
depends: [task-02-a-replayed-answered-question-carries-its-answers.md]
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session.ts#L1889-L1925](../../../../packages/agent-claude/src/session.ts#L1889-L1925) - the live carousel: questions `q1..qN`, options keyed by label, `message` from the header"
  - "[code://packages/agent-claude/src/transcript.ts](../../../../packages/agent-claude/src/transcript.ts) - `buildTurns`, where the restored call is made"
  - "[code://packages/agent-claude/src/input.ts](../../../../packages/agent-claude/src/input.ts) - where the shared builder goes"
  - git://ac05bdfe1e1 - VS Code `stateToProgressAdapter.ts` L337-L371 `inputRequestResponsePartToProgress`, how an answered part is drawn
---

## Objective

A restored AskUserQuestion call whose transcript result has `toolUseResult.answers` is followed in its turn by a `kind: 'inputRequest'` part with `response: 'accept'` and the answers filled in, the same part the live turn ends with after `chat/inputCompleted`.
VS Code then draws the answered question after a restart, as it does live.
A question with no answers, denied or cancelled, gets no part.

## Files

- `UPDATE: packages/agent-claude/src/input.ts` - one builder from the AskUserQuestion input to the carousel request, and from the answers keyed by question text to its answers.
- `UPDATE: packages/agent-claude/src/session.ts` - the live branch uses the builder.
- `UPDATE: packages/agent-claude/src/transcript.ts` - `buildTurns` adds the part.
- `UPDATE: packages/agent-claude/test/agent-claude-tool-input.test.ts` - the cases below.

## Steps

1. Test first: the live part after `chat/inputCompleted` and the restored part for the same question and answers are equal, a multi-select included; a restored question with no answers has no part.
2. Move the live mapping into the builder, then add the restored part.

## Validation

- The new cases fail first and pass after.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.
- By hand in VS Code: the test.md session of 2026-09-28 shows the answered question after a daemon restart.

## Resume

Not started.
