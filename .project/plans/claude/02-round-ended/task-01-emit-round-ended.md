---
title: An empty model round settles the client, or the task is dropped with the gap recorded
status: todo
depends: []
layer: packages/agent-claude
refs:
  - code://packages/agent-claude/src/session.ts#L1839-L1982 - the message loop where an SDK event would be seen
  - code://packages/agent-claude/src/session.ts#L1945-L1982 - the `result` branch that ends a turn today
  - code://packages/agent-claude/src/session.ts#L1866-L1882 - the compact-boundary `systemNotification`, the part this one is shaped like
  - code://packages/agent-claude/src/session.ts#L922-L926 - `addPart()`, which announces a part on the running turn
  - code://packages/sdk/src/host.ts#L1310-L1330 - `dispatch()`, where the part is broadcast and kept for replay
  - code://.project/research/response-round-ended-signal.md - the investigation this task opens with
  - code://test/toolauth.test.ts#L47-L77 - the mocked SDK whose frames a test injects
  - file:///github/externals/vscode/src/vs/platform/agentHost/common/meta/agentSystemNotificationMeta.ts#L24-L48 - `responseRoundEnded` and the known-kinds set
  - file:///github/externals/vscode/src/vs/platform/agentHost/node/copilot/copilotAgentSession.ts#L5223-L5243 - the Copilot emission this mirrors
  - npm://@microsoft/agent-host-protocol@^0.9.0 - `SystemNotificationResponsePart` is `{ kind, content, _meta? }`
---

## Objective

When the Claude stream ends a model response round with neither text nor tool calls, the running turn gains a `systemNotification` with empty content and `_meta.kind: 'responseRoundEnded'`, so a client settles its open reasoning section; if the stream has no such event, the task is dropped and the client gap is recorded rather than faked.

## Files

- `UPDATE: packages/agent-claude/src/session.ts:1839-1982` - the message-loop branch that emits the part.
- `UPDATE: .project/research/response-round-ended-signal.md` - the Answer from step 1.
- `CREATE: test/roundended.test.ts` - the frame-driven case, only once the investigation returns an event.
- `CREATE: .project/plans/claude/02-round-ended/deferred.md` - the client gap, only if the answer is no.

## Steps

1. Run the investigation in `.project/research/response-round-ended-signal.md`: read the SDK's event surface for a round-complete or assistant-message event that can carry no content and no tool blocks, drive one session with a prompt that produces an empty round and capture it with `ahpd --wire <file>`, compare the frames with the reference at `copilotAgentSession.ts:5241`, and write the Answer.
2. If the Claude stream has no event that marks an empty round, stop: leave `session.ts` untouched, set this task's status to `dropped`, write `deferred.md` recording that a client keeps an open reasoning section on an empty turn and why this host cannot close it, and say so in the plan's Resume state. Do not invent an event from `result`, from an idle period or from any other frame.
3. If the stream has such an event, find the branch in the message loop that starts at `session.ts:1841` where that event arrives for the active turn, and emit `addPart(active, { id, kind: 'systemNotification', content: '', _meta: { kind: 'responseRoundEnded' } })` only when the round carried no text and no tool call.
4. Give the part an id derived from the turn and the round, following the compact-boundary part's `${String(turn.id)}:compact:${String(turns.length)}` form.
5. Do not emit when the round carried text or a tool call, and do not emit when there is no active turn, since a response part belongs to a turn.
6. Add the case to a test that drives the mocked SDK's frames, and run the wire capture again so the part is visible on the wire.

## Validation

- `test/roundended.test.ts`: an empty round yields one `chat/responsePart` with `kind: 'systemNotification'`, `content: ''` and `_meta` `{ kind: 'responseRoundEnded' }`; a round carrying text yields none; a round carrying a tool call yields none.
- `pnpm test` green; `pnpm typecheck` and `pnpm boundary` green.
- By hand: `ahpd --wire <file>` on the prompt that produced the empty round shows the frame, and the reference client closes its reasoning section.
- If the answer is no: `deferred.md` exists, the task is `dropped`, and the plan's Resume state names the client gap.

## Resume

Empty until started.
