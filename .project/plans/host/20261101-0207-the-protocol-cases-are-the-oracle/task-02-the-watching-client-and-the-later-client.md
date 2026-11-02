---
title: The watching client and the later client
status: done
depends: [01]
layer: "sdk tests"
refs:
  - "[code://packages/sdk/test/ahp-test-cases.test.ts#L554-L756](../../../../packages/sdk/test/ahp-test-cases.test.ts#L554-L756) - the host cases: `HOST_OWNS`, `driven`, and the checks"
  - "https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/reducers.test.ts#L116-L145 - the reducer harness the watching client's check follows"
  - "https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/clients/dotnet/tests/AgentHostProtocol.Tests/RealSocketTypeScriptConformanceTests.cs#L54-L66 - the convergence assertion the later client's check follows"
---

## Objective

Every root, session and chat case runs through the host, and two checks cover the whole state.
A watching client's view equals the protocol reducer over its snapshot and the actions the host accepted.
A client subscribing afterwards is served that view.
Each place the host does otherwise is a divergence entry naming its keys and the rule it breaks.

## Files

- `UPDATE: packages/sdk/test/ahp-test-cases.test.ts:554-582` - `HOST_OWNS` goes, and `DIVERGES` takes its place: keys, the rule broken, and the correction that removes it.
- `UPDATE: packages/sdk/test/ahp-test-cases.test.ts:603-704` - `driven` returns each action's answer, the watching client's view, the reducer's view and the served state.
- `UPDATE: packages/sdk/test/ahp-test-cases.test.ts:715-756` - each case asserts the answers, the two checks against `DIVERGES`, and the lists' shape.

## Steps

1. Wait for the host to go quiet before the watching client subscribes.
2. Reduce the watching client's envelopes from its own snapshot with the protocol's reducer.
3. Reduce the same snapshot with the case's actions the host did not refuse.
4. Read the later client's snapshot.
5. Compare the three with `canonical`, key by key over every key either side holds.
6. Remove `HOST_OWNS`, the starting-agreement rule and the unread set-up dispatch it needed.
7. Record every difference in `DIVERGES` with the keys, the rule it breaks and the correction that removes it.
8. Record in `deferred.md` that a case starts from the host's own state until the host's state is the reducer's.

## Validation

- `pnpm exec vitest run packages/sdk/test/ahp-test-cases.test.ts` passes, with every divergence named.
- Two runs list the same divergences.

## Resume

Done 2026-11-01 in 21bd8d33. Seventeen cases differ for the watching client and twenty-two for the later one.
`ALLOWED` holds the differences the protocol has the host make on its own, each with its sentence.
The clock is held within each step of a case, which the plan did not know it needed.
