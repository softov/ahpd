---
title: A worker's own actions are schema-checked, and its comments document
status: todo
depends: [task-09-a-background-worker-is-linked-on-completion.md, task-10-the-spawning-call-carries-the-reference-meta.md, task-11-a-worker-ends-once-and-stays-ended.md, task-12-a-nested-worker-is-linked-from-its-parent-worker.md, task-13-a-resumed-session-keeps-its-restored-workers.md]
layer: "tests, agent-claude, sdk"
refs:
  - "[code://test/subagent-chat.test.ts#L141-L160](../../../../test/subagent-chat.test.ts#L141-L160) - `running`, which subscribes to the session and the lead chat only"
  - "[code://test/subagent-chat.test.ts#L233-L238](../../../../test/subagent-chat.test.ts#L233-L238) - the protocol check, which sees only subscribed channels"
  - "[code://packages/agent-claude/src/session.ts#L887-L894](../../../../packages/agent-claude/src/session.ts#L887-L894) - a comment on `scopeFor` that narrates"
---

## Objective

The protocol check covers the worker channel's own actions, and the comments this plan added say what each declaration is rather than what came before it.

## Files

- `UPDATE: test/subagent-chat.test.ts:141-160` - no client subscribes to the worker channel, so its `chat/turnStarted`, `chat/responsePart` and turn ending never reach the wire and are never checked.
- `UPDATE: packages/agent-claude/src/session.ts:887-894` and `:1260-1266` - "which is what every session did before this existed" and "which is what `claude/03` left out".
- `UPDATE: packages/agent-claude/src/claude.ts:551-555` - "which is what a session did before this existed".
- `UPDATE: packages/sdk/src/types/agent.ts:176-178` - "which is what every backend did before this existed" on `Start.subagent`.

## Steps

1. In the fake backend, open the worker in `begin` but emit its part and its ending on a later tick, and have `running` subscribe to the worker channel once its `session/chatAdded` is on the wire.
2. Rewrite each listed comment to state what the declaration does; history goes nowhere in the code.
3. Search the files this plan touched for the same phrasing (`rg -n "before this existed|left out" packages/agent-claude/src packages/sdk/src/types`) and rewrite what this plan added.

## Validation

- `test/subagent-chat.test.ts`: a new assertion that at least one `action` frame on the worker channel is on the wire, before the checker case runs; zero today, so it fails. The checker case then passes with those frames in it.
- `rg -n "before this existed|left out, because" packages/agent-claude/src/session.ts packages/agent-claude/src/claude.ts packages/sdk/src/types/agent.ts` finds none of the lines listed above.

## Resume
