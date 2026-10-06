---
title: Each AskUserQuestion question carries its header as its title
status: todo
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/input.ts#L86-L117](../../../../packages/agent-claude/src/input.ts#L86-L117) - `questionRequest`, which builds the questions"
---

## Objective

A question built from AskUserQuestion input has `title` set to that question's `header`, so a client shows the short label ("Alert color") above the question, as VS Code does.

## Files

- `UPDATE: packages/agent-claude/src/input.ts:92-111` - add `title: header` to each question when `header` is a non-empty string.
- `UPDATE: packages/agent-claude/src/input.ts:117` - drop the read of a top-level `input.header`, which AskUserQuestion has no field for; `message` stays `'The agent has a question'`.
- `UPDATE: packages/agent-claude/test/agent-claude-tool-input.test.ts` - the cases below.

## Steps

1. Test first: an input with three questions, two with headers, builds two questions with `title` and one without.
2. Set `title` from `question.header`; keep `id` as `q<n>` and `message` as the question's text, so `questionAnswers` and the restored question are unchanged.
3. Remove the `input.header` read.

## Validation

- `packages/agent-claude/test/agent-claude-tool-input.test.ts`: titles from headers; a restored question built by the same code carries the same titles.
- `pnpm test` in `packages/agent-claude`.

## Resume

