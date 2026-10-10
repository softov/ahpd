---
title: A restored worker chat takes the same title
status: done
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/transcript.ts#L140-L160](../../../../packages/agent-claude/src/transcript.ts#L140-L160) - the worker chats read from `subagents/*.meta.json`"
---

## Objective

A worker chat restored from the transcript is titled by the same rule as a live one, from the `description` and `agentType` in its `.meta.json`.

## Files

- `UPDATE: packages/agent-claude/src/transcript.ts` - `title` from the shared `titleOf`.
- `UPDATE: packages/agent-claude/test/` - a restored worker with a description, and one with only an agent type.

## Steps

1. Export `titleOf` from where task 01 puts it, or from a small module both import, and use it here.
2. Confirm the restored first turn already carries the prompt from the worker's first user line; add a test either way.

## Validation

- A `.meta.json` with `description: "Rewrite refs: host 49, 50"` restores a chat with that title and a first turn whose text is the prompt.

## Resume

Implemented, both steps. `titleOf` went into `input.ts` in task 01, which `transcript.ts` already imported from for `lineOf`, `pastLineOf`, `questionRequest`, `questionAnswers` and `toolInputOf` - so no new module, and the restored chat is named by the same call a live one is.

`subagentsOf` reads `description` and `agentType` off the meta file as before and hands them to `titleOf`. `agentName` and `description` on the restored entry are unchanged: the title is what a list draws, and the other two are what the `subagent` content block carries.

Step 2 needed no change and is now asserted: the CLI writes the spawning call's `prompt` as the worker's own first user line, and `buildTurns` opens a turn from it with `origin: { kind: 'user' }` - the same text the live chat is opened on, with `origin: { kind: 'tool' }`.

Tests written, in `packages/agent-claude/test/agent-claude-subagent-restore.test.ts`:

- `reads a session's subagents back, their turns and the call that ran each` - `toolu_task`'s title is now `List files` rather than `Explore`, and the assertion added is that `turns[0].message` is `{ text: 'list the files', origin: { kind: 'user' } }`.
- The same test gained a fourth worker, `agent-e5`, whose `.meta.json` names `agentType: 'Plan'` and no `description`, with its own spawning call in the session's transcript. Its title is `Plan` and it carries no `description` - the "only an agent type" half of the objective, which nothing covered before.

Four existing assertions in that file changed with the rule: `toolu_task`'s title and its `subagent` link are `List files`, and the nested `toolu_nested` link is `Look deeper`. `toolu_second`, which has no meta file at all, is still `Subagent`, and the orphan is still left out.

`packages/sdk/src/host/history.ts` and `snapshots.ts` both say `one.title ?? 'Subagent'`, which is right: they carry a title this package decided, and only when there was none.

