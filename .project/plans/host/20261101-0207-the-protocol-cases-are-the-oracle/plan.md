---
title: The protocol's cases are the oracle
domain: host
status: built
priority: high
created: 2026-11-01
revalidated: 2026-11-01
requires:
  - plans/host/20261031-2222-every-client-action-is-answered/plan.md
  - plans/host/20261101-0022-a-state-change-is-said-to-every-subscriber/plan.md
refs:
  - git://31d9fae0 - the commit of ahpd this plan was checked at
  - "https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/reducers.test.ts#L89-L145 - the protocol's reducer harness: a case's actions applied through the reducer from a state, the result compared with the expected state"
  - "https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/clients/dotnet/tests/AgentHostProtocol.Tests/JsonCanon.cs#L10-L13 - the conformance comparison: keys sorted, and null-valued object members dropped, \"so an omitted optional field equals an explicit null\""
  - "https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/clients/dotnet/tests/AgentHostProtocol.Tests/RealSocketTypeScriptConformanceTests.cs#L12-L66 - the protocol's host conformance test: a client reduces the snapshot and every envelope, and its state equals the host's final state"
  - "https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/clients/dotnet/tests/AgentHostProtocol.Tests/interop/session-host.ts#L95-L133 - the host that test runs: state through `sessionReducer`, an unsupported offer answered with `-32005`, the baselines, and a closed socket"
  - "https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/guide/actions.md#L232 - the same reducer code runs on both server and client"
  - "https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/guide/reconciliation.md#L19-L32 - an own echo is applied to the confirmed state; a rejected action is removed from pending, never applied"
  - "https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/specification/session-channel.md#L162 - invalid actions MUST be echoed back with a `rejectionReason`"
  - "https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/common/reducer-helpers.ts#L41-L46 - servers reject any action a client may not originate"
  - "https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/specification/versioning.md#L52-L68 - negotiation: the baselines, `-32005` with `supportedVersions`, and closing the connection"
  - "[code://packages/sdk/test/ahp-test-cases.test.ts](../../../../packages/sdk/test/ahp-test-cases.test.ts) - the case driver: two rules for `null`, keys compared only where the host and the case start alike, refusals never asserted, `HOST_OWNS`"
  - "[code://packages/sdk/test/conformance.test.ts#L144-L207](../../../../packages/sdk/test/conformance.test.ts#L144-L207) - `dispatch` sends no `clientSeq`, and `held` reduces every envelope, a refused one included"
  - "[code://packages/sdk/test/notes.test.ts#L81-L105](../../../../packages/sdk/test/notes.test.ts#L81-L105) - the same fold of every envelope"
  - "[code://packages/sdk/test/operations.test.ts#L113-L117](../../../../packages/sdk/test/operations.test.ts#L113-L117) - the same fold of every envelope"
---

## Goal

The protocol's own cases decide whether this host is right, and every way it is not is named.
Each case runs through the host as a client would send it.
A client that only watched must hold what the protocol's reducer makes of what the host accepted.
A client that subscribes afterwards must be served that same state, which is the protocol's own convergence test.
Every refusal says why, against a row of the specification or a named host policy.
What the host does differently today is listed as a divergence, with the rule it breaks.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "withoutNulls|sameValue" packages/sdk/test/ahp-test-cases.test.ts` - two rules for `null`: absent for the reducer cases, a value for the host cases.
- `rg -n "started\b|differs" packages/sdk/test/ahp-test-cases.test.ts` - a host case compares only the keys whose starting value the host and the case share.
- `rg -n "rejectionReason" packages/sdk/test/ahp-test-cases.test.ts` - a refused case returns before any check, and no reason is asserted.
- `rg -n "nullToUndefined|deepStrictEqual" types/reducers.test.ts` in the protocol - the reducer harness the driver's comment names.
- `rg -n "JsonCanon" clients/dotnet/tests` in the protocol - the comparison the conformance tests share.
- `rg -n "method: 'dispatchAction'" packages/*/test` - 595 dispatches in 96 files send no `clientSeq`; this plan corrects the conformance suite's.

### Runtime path

```
case actions -> dispatchAction from one client -> host -> envelopes
  watching client: subscribe snapshot + every envelope -> protocol reducer -> its view
  the same snapshot + the actions the host accepted -> protocol reducer -> what the view must be
  a later client: subscribe -> the served state, which must be the view
```

### Gaps

- The reducer cases read `null` as absent and the host cases read it as a value, so the two halves disagree on equality.
- A host case compares only keys whose starting value the host and the case share.
- So 28 of the 32 cases it counts as agreeing never compare the key the case moves.
- A refused case returns before any state check, and its reason is never asserted.
- `HOST_OWNS` records the host's departures from a case as allowed differences, which is how case 272 hid until the group 9 correction.
- The negotiation rows run the package's rule; rows offering `0.10.0` never reach the host's answer, and no row checks that a refused connection closes.
- The conformance, notes and operations suites reduce a refused envelope as though the host had applied it.
- The conformance suite drives the host with actions the protocol calls malformed.
- They carry no `clientSeq`, a turn with no `startedAt`, a message with no `origin`, or a config key no schema declares.
- `Not found: a way to start a host case from its case's initial state - searched aHost, createSession and the restore paths; the host builds root, session and chat state itself, so nothing can be seeded.`

## Answers

| What | Source | Task |
| --- | --- | --- |
| One comparison everywhere: values as JSON carries them, object members holding `null` dropped, list slots kept | [JsonCanon.cs#L10-L13](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/clients/dotnet/tests/AgentHostProtocol.Tests/JsonCanon.cs#L10-L13) | 01 |
| A watching client's view must equal the protocol reducer over its own snapshot and the actions the host accepted, on every key | [types/reducers.test.ts#L116-L145](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/reducers.test.ts#L116-L145) | 02 |
| A later subscription must be served the watching client's view, on every key | [RealSocketTypeScriptConformanceTests.cs#L12-L66](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/clients/dotnet/tests/AgentHostProtocol.Tests/RealSocketTypeScriptConformanceTests.cs#L12-L66) | 02 |
| A host case starts from the host's own state; a case's `initial` waits until the host's state is the reducer's | `(defaulted: the host builds its state itself and cannot be seeded)` | 02 |
| Every refusal is asserted with its reason and its source, a specification row or a named host policy | [session-channel.md#L162](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/specification/session-channel.md#L162); [reducer-helpers.ts#L41-L46](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/common/reducer-helpers.ts#L41-L46) | 03 |
| What the host does differently is one list of divergences, each with the rule it breaks; nothing is an allowed difference unless a sentence of the specification allows it | `(defaulted: a difference from the protocol's answer is a defect until a sentence of the specification allows it)` | 02 |
| Every negotiation row goes through the host, and the host's answer is held to the row | [versioning.md#L52-L68](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/specification/versioning.md#L52-L68) | 04 |
| A refused envelope is left out of every fold that stands for a client | [reconciliation.md#L29-L30](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/guide/reconciliation.md#L29-L30) | 05 |
| The conformance suite sends what the protocol declares: a `clientSeq`, a turn's `startedAt`, a message's `origin`, and only config keys the schema declares | `@microsoft/agent-host-protocol@1.0.0`, `DispatchActionParams`, `ChatTurnStartedAction`, `Message`; [session actions.ts `SessionConfigChangedAction`](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/channels-session/actions.ts) | 05 |

## Proposed architecture

- **Data flow** - one client sends a case's actions, one watches, and one subscribes afterwards. The driver holds the watcher's reduction to the protocol reducer's and to the later snapshot.
- **State flow** - nothing in the host changes; every check reads envelopes and snapshots.
- **Layer responsibilities** - sdk tests only.
- **Source-of-truth files** - [`code://packages/sdk/test/ahp-test-cases.test.ts`](../../../../packages/sdk/test/ahp-test-cases.test.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - one comparison](task-01-one-comparison.md) | done | - |
| [02 - the watching client and the later client](task-02-the-watching-client-and-the-later-client.md) | done | 01 |
| [03 - every refusal says why](task-03-every-refusal-says-why.md) | done | 02 |
| [04 - negotiation through the host](task-04-negotiation-through-the-host.md) | done | 01 |
| [05 - a refused action is not applied](task-05-a-refused-action-is-not-applied.md) | done | - |

## Risks and tradeoffs

- A late start-up action of the backend would read as a divergence - the driver waits for the host to go quiet first.
- The divergence list is long - it is the record of what the host breaks, and each later correction empties its part of it.

## Resume state

- **Done so far:** tasks 01 to 05, 2026-11-01.
- **Next action:** none; see [implemented.md](implemented.md) and [deferred.md](deferred.md).
- **Open questions:** none.
- **Watch out for:** a divergence entry must name the keys exactly, so a correction that fixes one fails the test until its entry goes.

## Final verification checklist

- [x] Every root, session and chat case runs through the host with checks 1 to 4, and the divergence list matches what the host does.
- [x] Two runs give the same divergence list.
- [x] The conformance, notes and operations suites pass with the refused envelopes left out.
- [x] `pnpm run typecheck` exits 0, and the prose lint is clean.
