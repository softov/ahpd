---
title: A nested session's switch is said once
domain: host
status: built
priority: medium
created: 2026-11-02
revalidated: 2026-11-02
refs:
  - git://9d1cc04e - the commit of ahpd this plan was checked at
  - "git://f48055f0 - the last commit that holds `.project/working/maycxc-union-20261101-review.md`; Softov's review: a nested session's customization switch may reach outer clients twice"
  - "[code://packages/sdk/src/sessions/nested.ts#L483](../../../../packages/sdk/src/sessions/nested.ts#L483) - `answering`, the client actions the host inside owes an answer"
  - "[code://packages/sdk/src/sessions/nested.ts#L510-L531](../../../../packages/sdk/src/sessions/nested.ts#L510-L531) - `deliver` and `carry`"
  - "[code://packages/sdk/src/sessions/nested.ts#L933-L983](../../../../packages/sdk/src/sessions/nested.ts#L933-L983) - `pump`, which passes an inner action out with the answer it owes, or none"
  - "[code://packages/sdk/src/sessions/nested.ts#L1361-L1393](../../../../packages/sdk/src/sessions/nested.ts#L1361-L1393) - `answer`, `setConfig` and `setCustomizationEnabled`, which deliver with no client's dispatch"
  - "[code://packages/sdk/src/host/chatactions.ts#L1304-L1460](../../../../packages/sdk/src/host/chatactions.ts#L1304-L1460) - the switch, which the host outside says once its session took it"
---

## Goal

A switch, a setting or an answer the host outside says itself reaches its clients once on a nested session.
The host inside's echo of it moves the session's mirror and goes no further.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "deliver\(" packages/sdk/src/sessions/nested.ts` - three deliveries with no client's dispatch: an answer, a setting and a switch.
- `rg -n "session.answer|session.setConfig|session.setCustomizationEnabled" packages/sdk/src/host/chatactions.ts` - the host outside says each itself once its session took it.

### Runtime path

```
client outside: session/customizationToggled (clientSeq 9)
  -> host outside: setCustomizationEnabled -> proxy delivers it inside, answers true
  -> host outside says the switch with the client's origin
  -> host inside echoes the proxy's dispatch -> pump finds no client owed it -> emits it again with no origin
```

### Gaps

- A client outside hears the switch twice, the second copy with no origin and the inner enablement.
- A setting and an answer take the same road.

## Answers

| What | Source | Task |
| --- | --- | --- |
| An action's echo answers its sender, and every other client hears the change once | AHP actions guide: the server echoes an accepted action back once https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/guide/actions.md | 01 |
| The proxy's mirror still takes the inner echo | nested.ts: "The mirror is kept so a client that arrives late gets a snapshot." | 01 |
| The three deliveries are the ones the host outside says itself | chatactions.ts: each dispatches the action with the client's origin once its session answered true | 01 |

## Proposed architecture

- **Data flow** - `deliver` takes a mark for an action the host outside says itself, and keeps its `clientSeq`.
- **State flow** - `pump` reduces the echo of a marked action into the mirror and emits nothing.
- **Layer responsibilities** - sdk sessions alone.
- **Source-of-truth files** - [`code://packages/sdk/src/sessions/nested.ts`](../../../../packages/sdk/src/sessions/nested.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - an echo the host outside said goes no further](task-01-an-echo-the-host-outside-said-goes-no-further.md) | done | - |

## Risks and tradeoffs

- A rejection of a marked action inside is logged, as one with no client owed it is.

## Resume state

- **Done so far:** task 01, 2026-11-02; [implemented.md](implemented.md) says what was verified.
- **Next action:** none.
- **Open questions:** none.
- **Watch out for:** an inner session publishes its customizations by action; a case waits for them before it switches one.

## Final verification checklist

- [x] A switch on a nested session reaches the client outside once, with its origin.
- [x] On main's code the client outside hears it twice.
