---
title: pi and cofold run their client calls through the sdk
domain: host
status: planned
priority: high
created: 2026-10-06
revalidated: 2026-10-06
requires:
  - plans/host/62-every-backend-calls-a-clients-tool-p1-the-sdk-holds-a-client-call/plan.md
refs:
  - "[code://packages/agent-pi/src/tools.ts#L28-L60](../../../../packages/agent-pi/src/tools.ts#L28-L60) - `RunByClient` and `toPiTool`: a client's tool is a pi custom tool whose `execute` waits"
  - "[code://packages/agent-pi/src/session.ts#L185-L215](../../../../packages/agent-pi/src/session.ts#L185-L215) - pi's `byClient`, `releaseCalls`, `ranByClient`"
  - "[code://packages/agent-pi/src/session.ts#L383-L410](../../../../packages/agent-pi/src/session.ts#L383-L410) - `askBefore` emits the ready with the contributor"
  - "[code://packages/agent-pi/src/session.ts#L1145-L1200](../../../../packages/agent-pi/src/session.ts#L1145-L1200) - the three members and `setTools`, which marks the backend stale and rebuilds it before the next turn"
  - "[code://packages/agent-pi/src/mapping.ts#L120-L140](../../../../packages/agent-pi/src/mapping.ts#L120-L140) - `chat/toolCallStart` with the contributor"
  - "[code://packages/agent-cofold/src/tools.ts#L60-L130](../../../../packages/agent-cofold/src/tools.ts#L60-L130) - `ClientToolRelay` and `cofoldTool`: an owned tool's `execute` hands the call over"
  - "[code://packages/agent-cofold/src/tools.ts#L240-L300](../../../../packages/agent-cofold/src/tools.ts#L240-L300) - the start, ready and part carry `contributorOf(owner)`"
  - "[code://packages/agent-cofold/src/turnagent.ts#L115-L150](../../../../packages/agent-cofold/src/turnagent.ts#L115-L150) - cofold's `waiting`, `releaseCalls` and the relay"
  - "[code://packages/agent-cofold/src/turnagent.ts#L229-L285](../../../../packages/agent-cofold/src/turnagent.ts#L229-L285) - cofold's three members"
  - "[code://packages/agent-cofold/src/session.ts#L255-L262](../../../../packages/agent-cofold/src/session.ts#L255-L262) - the snapshot's `inputNeeded`"
  - "[code://packages/agent-cofold/src/session.ts#L335](../../../../packages/agent-cofold/src/session.ts#L335) - cofold's `setTools`"
  - "npm://@earendil-works/pi-agent-core@0.87.1 - `AgentToolResult.content` is `(TextContent | ImageContent)[]` (`dist/types.d.ts:366-372`)"
  - "npm://@cofold/agents@^0.1.2 - `ToolOutput` is `string | { content: string; detail?: unknown }`, so a cofold tool answers text only (`types/tool.ts:25`)"
  - "[code://packages/agent-pi/test/agent-pi-tools.test.ts](../../../../packages/agent-pi/test/agent-pi-tools.test.ts) - pi's client-tool cases"
  - "[code://packages/agent-cofold/test/agent-cofold-client-tool.test.ts](../../../../packages/agent-cofold/test/agent-cofold-client-tool.test.ts) - cofold's six client-tool cases"
---

## Goal

pi and cofold keep calling a client's tool as pi/02 and plugin/04 built it, through the sdk holder, so both raise the `toolClientExecution` entry, keep an early answer, and time a call out; pi hands its model a client's images, and cofold, whose tools answer text only, says in text what it could not pass.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### What pi and cofold have today

Both take `setTools` and offer a client's tool to their model: pi as a custom tool from `toPiTool`, rebuilt before the next turn when the set changes; cofold as a `createTool` whose `execute` hands the call to the session's relay.
Both report the call with the client contributor and wait for `completeToolCall`, and both fail it on `clientGone`, cancel and close.
Neither raises the execution request or times a call out, and pi registers its wait at `execute`, after the ready has gone out.

### Searches performed

- `rg -n "setTools|toolCallOwner|completeToolCall|clientGone" packages/agent-pi/src packages/agent-cofold/src` - all four in each.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| - | None. | - |

| What | Source | Task |
| --- | --- | --- |
| pi and cofold move onto the sdk holder and keep their client-tool tests green | the parent | 01, 02 |
| pi passes text and images, and a resource that is not an image as a text line; cofold passes everything as text, an image or resource as a line naming its type and size | the parent's row, Softov, 2026-10-06: "Everything now"; what each agent's tool result takes | 01, 02 |

## Proposed architecture

- **Data flow** - pi opens at `askBefore`'s running ready and waits in `execute`; cofold opens where `toolReadyAction` goes out for an owned call and waits in the relay.
- **State flow** - each snapshot's `inputNeeded` adds `calls.entries()`.
- **Layer responsibilities** - agent-pi · agent-cofold.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - pi's client calls are the sdk's](task-01-pis-client-calls-are-the-sdks.md) | todo | p1 |
| [02 - cofold's client calls are the sdk's](task-02-cofolds-client-calls-are-the-sdks.md) | todo | p1 |

## Risks and tradeoffs

- A pi call whose tool was added mid-turn is not offered until the rebuild before the next turn - unchanged, and said in pi's README already.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-pis-client-calls-are-the-sdks.md](task-01-pis-client-calls-are-the-sdks.md).
- **Open questions:** none beyond the parent's.
- **Watch out for:** cofold's gone message names the tool; the holder's must too, or cofold's existing case fails for the wrong reason.

## Final verification checklist

- [ ] `vitest run packages/agent-pi packages/agent-cofold` green.
- [ ] `plans/index.md` updated.
