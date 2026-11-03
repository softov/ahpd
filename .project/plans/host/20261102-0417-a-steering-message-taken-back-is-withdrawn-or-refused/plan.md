---
title: A steering message taken back is withdrawn or refused
domain: host
status: built
priority: high
created: 2026-11-02
revalidated: 2026-11-02
refs:
  - git://e4694965 - R1's continuation, the commit this plan was checked at
  - "[code://.project/working/maycxc-union-20261101-review.md](../../../working/maycxc-union-20261101-review.md) - Softov's review: a steering message a client takes back is neither answered nor withdrawn"
  - "[code://packages/sdk/src/host/chatactions.ts#L1603-L1650](../../../../packages/sdk/src/host/chatactions.ts#L1603-L1650) - the removal: `unqueue`, then the refusal during a turn, or the host's own removal"
  - "[code://packages/sdk/src/types/session.ts#L671-L672](../../../../packages/sdk/src/types/session.ts#L671-L672) - `unqueue`: take one back, while it is still waiting"
  - "[code://packages/agent-cofold/src/turns.ts#L787-L793](../../../../packages/agent-cofold/src/turns.ts#L787-L793) - cofold's `unqueue`, which looks in `queued` alone"
  - "[code://packages/agent-cofold/src/context.ts#L50-L56](../../../../packages/agent-cofold/src/context.ts#L50-L56) - `untaken`, the steering messages waiting to be turns of their own"
  - "[code://packages/sdk/src/sessions/nested.ts#L1415-L1417](../../../../packages/sdk/src/sessions/nested.ts#L1415-L1417) - the proxy's `unqueue`, which carries every removal inside as `queued`"
  - "[code://.project/plans/host/20261101-1627-a-validation-reads-the-held-state/plan.md](../20261101-1627-a-validation-reads-the-held-state/plan.md) - the continuation's plan, which refuses a removal during a turn when the backend takes nothing back"
  - "[code://packages/agent-cofold/test/agent-cofold-turn.test.ts](../../../../packages/agent-cofold/test/agent-cofold-turn.test.ts) - cofold's steering cases through the host"
  - "[code://packages/sdk/test/nested-proxy.test.ts](../../../../packages/sdk/test/nested-proxy.test.ts) - a nested session's actions, answered from the host inside"
---

## Goal

A client that takes back a steering message gets an answer, and the answer is true.
A backend takes back a message its agent has not been handed, and says it gone.
A message the agent holds stays, and the host refuses the removal while a turn runs.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "pendingMessageRemoved" packages/sdk/src/host/chatactions.ts` - `unqueue`, then the host answers a dispatch the backend left unanswered.
- `rg -n "unqueue" packages/*/src` - cofold, pi, Claude, the bot and the proxy; each looks in its queued messages alone.
- `rg -n "withdrawSteering" src/vs/platform/agentHost` in VS Code at 3a242139 - the reference's hook, and its host's refusal without it.

### Runtime path

```
cofold stops a run holding a steer -> the run hands it back -> untaken, steeringMessage held, no turn running
client chat/pendingMessageRemoved {kind: steering, id: s1}
  -> unqueue(s1): cofold looks in queued, says nothing
  -> unanswered, no turn running -> the host says it gone
  -> untaken still holds s1, and it runs as a turn once the next one ends
nested: unqueue carries {kind: queued} inside -> the host inside refuses a queued s1
```

### Gaps

- cofold's `unqueue` ignores `untaken`, so the host says a message gone that cofold still runs.
- The proxy carries a steering removal inside as a queued one, which the host inside refuses for the wrong kind.
- `Not found: a host case that takes back a steering message - searched every test that sends chat/pendingMessageRemoved.`

## Answers

| What | Source | Task |
| --- | --- | --- |
| A host rejects a removal it can no longer honor after the handoff | AHP main, chat-channel.md, Steering Messages: "Hosts MUST reject edits or client removals that they can no longer honor after handoff." https://github.com/microsoft/agent-host-protocol/blob/ff7d6a1c7b4f5e47925d3ce1c3bcf685266a6d49/docs/specification/chat-channel.md#steering-messages | 01 |
| The refusal during a turn, in the reference's words, when the backend takes nothing back | the continuation's plan, from VS Code's host: https://github.com/microsoft/vscode/blob/3a2421399905c0c044dade3048a797d1e9ba33d4/src/vs/platform/agentHost/node/agentService.ts#L12886-L12893 | 01 |
| `unqueue` takes back what still waits, a steering message handed back among it | Session's `unqueue`: "Take one back, while it is still waiting." | 01 |
| cofold takes back a message in `untaken` and keeps one its run holds | `RunHandle.submit` in @cofold/agents 0.4.0 takes approve, deny, answer, steer and cancel, and none gives a steer back | 01 |
| pi takes back no steering message | pi's `AgentSession.clearQueue` gives back every queued message at once, and nothing gives back one | 01 |
| The proxy carries the kind the inner chat holds the message as | the protocol matches a removal on its id and its kind | 01 |

## Proposed architecture

- **Data flow** - the host's removal case is the continuation's; `unqueue` answers for a message the backend takes back.
- **State flow** - cofold drops the message from `untaken` and `steering`, and says `chat/pendingMessageRemoved` inside the dispatch, which is the echo.
- **Layer responsibilities** - cofold: its `unqueue`. sdk: the proxy's `unqueue` and the interface's doc. pi, Claude and the bot: none.
- **Source-of-truth files** - [`code://packages/agent-cofold/src/turns.ts`](../../../../packages/agent-cofold/src/turns.ts), [`code://packages/sdk/src/sessions/nested.ts`](../../../../packages/sdk/src/sessions/nested.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - a steering message taken back is withdrawn or refused](task-01-a-steering-message-taken-back-is-withdrawn-or-refused.md) | done | - |

## Risks and tradeoffs

- The branch starts from R1's continuation, whose host answers a removal the backend leaves unanswered.
- The same rule covers edits: a second `chat/pendingMessageSet` under a held steering id reaches the backend again.
  The review's notes do not name it, so the implemented record keeps it as a finding.

## Resume state

- **Done so far:** task 01, 2026-11-02; [implemented.md](implemented.md) says what was verified.
- **Next action:** none.
- **Open questions:** none.
- **Watch out for:** a client's fold that applies a refused envelope; read the state from a snapshot instead.

## Final verification checklist

- [x] cofold takes back a message its stopped run handed back, and the message never runs.
- [x] cofold's run keeps a message it holds, and the host refuses the removal.
- [x] pi keeps a message it holds, and the host refuses the removal.
- [x] A nested session's removal reaches the host inside as `steering`, and its answer reaches the client outside.
