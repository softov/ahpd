---
title: A response round that ends empty is announced, or the gap is recorded
domain: claude
status: built
priority: medium
created: 2026-09-19
revalidated: 2026-09-19
requires:
  - research/response-round-ended-signal.md
changes: []
creates: []
decisions: []
refs:
  - code://packages/agent-claude/src/session.ts#L1839-L1982 - the message loop where SDK events become chat actions
  - code://packages/agent-claude/src/session.ts#L1945-L1982 - the `result` branch that ends a turn, the neighbourhood an empty-round signal would sit in
  - code://packages/agent-claude/src/session.ts#L1866-L1882 - the compact-boundary `systemNotification`, the one part of this kind this repository already builds
  - code://packages/agent-claude/src/session.ts#L922-L926 - `addPart()`, which announces a part on the running turn
  - code://packages/sdk/src/host.ts#L1310-L1330 - `dispatch()`, where a response part is broadcast and kept for replay
  - code://packages/sdk/src/host.ts#L2929-L2941 - the one other `systemNotification` in the repository, an origin on a host-initiated turn rather than a response part
  - code://.project/research/response-round-ended-signal.md - the investigation this plan opens with
  - code://.project/review/2026-09-19-upstream-pass-4.md#L28 - the finding this plan takes, and the Left open line that makes it conditional
  - npm://@microsoft/agent-host-protocol@^0.9.0 - `SystemNotificationResponsePart` is `{ kind, content, _meta? }`, so empty content is a legal part
  - file:///github/externals/vscode/src/vs/platform/agentHost/common/meta/agentSystemNotificationMeta.ts#L24-L48 - `responseRoundEnded` and the known-kinds set
  - file:///github/externals/vscode/src/vs/platform/agentHost/node/copilot/copilotAgentSession.ts#L5223-L5243 - the Copilot emission this mirrors
---

## Goal

A model response round that ends with neither text nor tool calls is announced to the client as `responseRoundEnded`, so the open reasoning section settles instead of hanging on a turn that produced nothing.
If the Claude stream has no event that marks such a round, the task is dropped and the client gap is written down rather than faked.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `grep -rn "responseRoundEnded\|RoundEnded" packages/ test/ docs/` - nothing; the notification does not exist here and no test knows the word.
- `grep -rn "systemNotification" packages/agent-claude/src packages/sdk/src` - two hits, the compact-boundary part at `session.ts:1875` and the host-initiated turn's origin at `host.ts:2934`.
- `grep -rn "assistant\|result" packages/agent-claude/src/session.ts` - the message loop branches on `message.type` and already handles `result` as the end of a turn.
- `grep -rn "reloadPlugins\|reloadSkills" packages/agent-claude/src` - `reloadSkills()` is called and no empty-round event is read from either control call.

### Runtime path

```
Claude CLI stream -> session.ts message loop -> a round that carries no text and no tool call
  -> addPart(turn, { kind: 'systemNotification', content: '', _meta: { kind: 'responseRoundEnded' } })
  -> chat/responsePart -> dispatch() -> the client settles its open reasoning section
```

### Gaps

- `responseRoundEnded` appears nowhere under `packages/` or `test/`.
- The research Answer is empty, so whether the Claude stream marks an empty round is unknown, and the whole task is conditional on it.
- `Not found: a tested seam for a faked Claude frame - searched "frames.push" and "sessionQueries" in test/; `test/toolauth.test.ts` mocks the SDK and is the only place a frame is injected today.`
- The SDK mock in `test/toolauth.test.ts` has no `reloadPlugins` and no case that ends a round empty.

## Decisions locked in

No decision file: the item is either reachable or it is dropped, and a choice between two working options never arises.

| What | Source | Task |
| --- | --- | --- |
| The signal is a `systemNotification` with empty `content` and `_meta.kind: 'responseRoundEnded'` | `file:///github/externals/vscode/src/vs/platform/agentHost/common/meta/agentSystemNotificationMeta.ts#L24-L25` and the Copilot emission | 01 |
| The plan opens with the research investigation, and a "no such event" answer drops the task and records the client gap rather than importing an unrelated frame | `.project/research/response-round-ended-signal.md`, and the review's Left open line | 01 |
| The part is emitted only while a turn is active, because a response part belongs to a turn | `code://packages/agent-claude/src/session.ts#L922-L926` | 01 |
| The part is not emitted when the round carried text or a tool call | the reference's `!content && !toolRequests` test | 01 |
| The part id is derived from the turn and the round, the way the compact-boundary part is | `code://packages/agent-claude/src/session.ts#L1873-L1879` | 01 |

## Proposed architecture

- **Data flow** - the SDK frame arrives in the message loop, the loop decides whether the round carried text or a tool call, and a part goes on the running turn through the existing `addPart()`.
- **Event flow** - `addPart()` emits `chat/responsePart`; `dispatch()` broadcasts it and keeps it for replay, exactly as the compact-boundary part does today.
- **State flow** - the part is appended to the turn's `responseParts` and nothing else moves, so no new state is introduced.
- **Layer responsibilities** - packages/agent-claude: the branch in the message loop and the part it builds · packages/sdk: unchanged, because a `systemNotification` part already travels the wire · .project/research: the Answer that decides whether the branch exists at all.
- **Source-of-truth files** - `code://packages/agent-claude/src/session.ts`.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The empty round is announced](task-01-emit-round-ended.md) | dropped | - |

## Risks and tradeoffs

- The Claude stream may report the end of a turn but not a round that ended empty, in which case the only correct outcome is dropping the task and recording what a client loses.
- Emitting on the wrong boundary would settle a reasoning section that is still being written, so the branch must hang on an event the SDK names for the round and not on a timeout or a quiet period.
- An empty `content` on a `systemNotification` is legal in the protocol, but a client that renders every part as text would draw a blank line; the reference client reads the `_meta.kind` first, which is the same reader this host serves.
- There is no test seam for driving the real Claude stream empty, so the test drives the mocked SDK frames and the real behaviour is checked by hand with `ahpd --wire`.

## Resume state

- **Done so far:** the task's opening investigation is done and its Answer is no; the task is dropped and the client gap is recorded. See [implemented.md](implemented.md) and [deferred.md](deferred.md).
- **Next action:** none; every task is done or dropped and the plan is built.
- **Open questions:**
  1. Does the Claude SDK expose a round that ended with no content and no tool calls? - answered: no; `@anthropic-ai/claude-agent-sdk@0.3.278` has no such event, so the task is dropped.
- **Watch out for:** the gap is real and unplanned; it needs an SDK event that does not exist today, and it must not be faked from `result` or from the transport's `message_stop`.

## Final verification checklist

- [x] The research file's Answer is filled with the outcome of the method it states.
- [x] If the answer is yes: `pnpm test` green with the empty-round case, and the wire capture shows the part. - not applicable; the answer is no.
- [x] `pnpm typecheck` and `pnpm boundary` green.
- [x] If the answer is no: the task's status is `dropped`, `deferred.md` records the client gap, and no code changed.
- [x] `plans/index.md` updated.
