---
title: Each case starts from its initial
status: todo
depends: [01]
layer: "sdk tests"
refs:
  - "[code://packages/sdk/test/ahp-test-cases.test.ts](../../../../packages/sdk/test/ahp-test-cases.test.ts) - `driven`, `DIVERGES`, `ALLOWED` and the checks"
---

## Objective

Each case's channel opens with its `initial`, and the oracle names every key the host says otherwise, at the start and after the case's actions.

## Files

- `UPDATE: packages/sdk/test/ahp-test-cases.test.ts` - `driven` seeds the case's channel; a `start` check; the entries the seeded cases show.
- `UPDATE: .project/plans/host/20261101-0207-the-protocol-cases-are-the-oracle/deferred.md` - the entries on the start state, the peer chats and the stamps go.

## Steps

1. Hand the host `opening` for the case's channel.
2. Use the root, the created session or its default chat, and a peer chat for 272 and 273.
3. Hold the watching client's first state to `initial`, keyed by a new `start` list on each entry.
4. Compare what it holds afterwards with `expected`, where it started from `initial` and the host refused nothing.
5. Otherwise compare it with the reducer over the state it started from.
6. Run the file, and name each difference with its correction or its sentence.
7. Remove the deferred entries this resolves.

## Validation

- Before the entries, the seeded file fails 110 of 248 host cases.
- After them, `pnpm exec vitest run packages/sdk/test/ahp-test-cases.test.ts` passes 647 of 647.

## Resume

Not started.
