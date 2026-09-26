---
title: A model round that ends empty is announced
domain: claude
status: planned
priority: medium
created: 2026-09-26
revalidated: 2026-09-26
requires:
  - plans/claude/02-round-ended/plan.md
changes: []
creates: []
decisions: []
refs:
  - "[code://packages/agent-claude/src/session.ts#L1052-L1060](../../../../packages/agent-claude/src/session.ts#L1052-L1060) - `streamed`, which sees `message_start` and the content blocks but never acts on `message_delta` or `message_stop`"
  - "[code://packages/agent-claude/src/session.ts#L2064](../../../../packages/agent-claude/src/session.ts#L2064) - an existing `systemNotification` part, the shape to reuse"
  - "[code://.project/plans/claude/02-round-ended/deferred.md](../../../../.project/plans/claude/02-round-ended/deferred.md) - why it waited: no SDK event for the round"
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/platform/agentHost/node/copilot/copilotAgentSession.ts#L5223-L5243 - the reference: an empty final answer emits a `SystemNotification` part with `_meta` kind `responseRoundEnded`
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/platform/agentHost/common/meta/agentSystemNotificationMeta.ts#L25 - "clients settle any open thinking section and render nothing"
  - npm://@anthropic-ai/claude-agent-sdk@0.3.283 - still no round event; its only new message type over 0.3.278 is `mcp_read_resource`
---

## Goal

When Claude ends a model round with neither text nor a tool call, the client is told so, and VS Code closes the open thinking section instead of drawing two rounds of thinking as one.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `diff` of the `type:` literals in `sdk.d.ts`, 0.3.278 against 0.3.283 - one addition, `mcp_read_resource`; no round event.
- `grep -n "message_stop\|message_delta" packages/agent-claude/src/session.ts` - nothing; the backend ignores the stream's message end.
- The daemon runs the CLI with `--include-partial-messages`, so every API call arrives as `stream_event`s from `message_start` to `message_stop`, with `stop_reason` on `message_delta`.

### Runtime path

```
CLI stream_event message_start -> content_block_start(thinking) ... -> message_delta(stop_reason) -> message_stop
  -> streamed() -> [new] no text and no tool_use in this message -> chat/responsePart systemNotification { _meta: responseRoundEnded }
```

### Gaps

- `claude/02` deferred this because the SDK has no round event; the stream's own message boundaries are the event, and were not considered.
- Not confirmed on a real stream that an empty round arrives as its own message.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| The part is the reference's: `kind: 'systemNotification'`, empty `content`, `_meta` carrying kind `responseRoundEnded` | the reference, `copilotAgentSession.ts:5233-5241` | 02 |
| Only a message that had no `text` and no `tool_use` block, and ended with `stop_reason` `end_turn` | the reference's `isEmptyFinalAnswer` | 02 |
| A subagent's messages are judged in the subagent's scope, as the reference does with `parentToolCallId` | the reference | 02 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - An empty round seen on a real stream](task-01-seen-on-a-real-stream.md) | todo | - |
| [02 - The part is emitted](task-02-the-part-is-emitted.md) | todo | 01 |

## Risks and tradeoffs

- If task 01 finds that the CLI never sends an empty message, the plan is dropped and `claude/02`'s deferral stands, with the capture as the evidence.
- A turn that ends with thinking and no answer also ends the turn; the part is still correct there, since the reference emits it for any empty final answer.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-seen-on-a-real-stream.md](task-01-seen-on-a-real-stream.md).
- **Open questions:** none.
- **Watch out for:** `streaming` holds the current message id; key the "saw text or a tool" flag by it, or a tool call from the previous message leaks into this one.

## Final verification checklist

- [ ] A captured stream with an empty round, checked into `test/fixtures`.
- [ ] A test replaying it sees one `responseRoundEnded` part, and a normal turn sees none.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm boundary` green.
- [ ] `UPSTREAM.md` Pass 4 box ticked, `claude/02`'s `deferred.md` pointed here, `plans/index.md` updated.
