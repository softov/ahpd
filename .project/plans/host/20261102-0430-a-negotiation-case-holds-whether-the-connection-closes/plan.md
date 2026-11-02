---
title: A negotiation case holds whether the connection closes
domain: host
status: built
priority: medium
created: 2026-11-02
revalidated: 2026-11-02
refs:
  - git://9d1cc04e - the commit of ahpd this plan was checked at
  - "[code://.project/working/maycxc-union-20261101-review.md](../../../working/maycxc-union-20261101-review.md) - Softov's review: for invalid rows, `owed` sets `closed: asked.closed`"
  - "[code://packages/sdk/test/ahp-test-cases.test.ts#L303-L341](../../../../packages/sdk/test/ahp-test-cases.test.ts#L303-L341) - the negotiation cases: what the host answered, and what it owes"
  - "[code://packages/sdk/src/host/handshake.ts#L263-L289](../../../../packages/sdk/src/host/handshake.ts#L263-L289) - the host's answer to an offer, malformed or with nothing in common"
---

## Goal

Each of the protocol's version negotiation rows holds the host to an answer and to the connection's state after it.
An invalid offer is malformed params, and the connection stays open, as the protocol's interop host answers one.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "closed" packages/sdk/test/ahp-test-cases.test.ts` - the answered state reads `asked.closed`, and the owed state copies it for an invalid row.
- `rg -n "32602|socket.close" clients/dotnet/tests/AgentHostProtocol.Tests/interop/session-host.ts` in AHP at 5f16d81b - a malformed offer returns without a close.

### Runtime path

```
row 12-22, invalid offer -> host throws -32602 -> answered.closed = asked.closed
owed = { code: -32602, closed: asked.closed } -> equal whatever the host did to the connection
```

### Gaps

- An invalid row owes whatever the host did, so a host that closed the connection would pass.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A malformed offer is answered with `-32602` and the connection stays open | AHP's interop host returns after `failure(..., -32602, ...)` and closes only after `-32005`: https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/clients/dotnet/tests/AgentHostProtocol.Tests/interop/session-host.ts#L85-L101 | 01 |
| Only the no-common-version answer closes the connection | versioning.md: "it MUST respond with UnsupportedProtocolVersion ... and close the connection" https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/specification/versioning.md#L52-L68 | 01 |

## Proposed architecture

- **Data flow** - an invalid row owes `{ code: -32602, closed: false }`, a value the case states.
- **Layer responsibilities** - the sdk's protocol case driver alone; the host answers this way already.
- **Source-of-truth files** - [`code://packages/sdk/test/ahp-test-cases.test.ts`](../../../../packages/sdk/test/ahp-test-cases.test.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - an invalid row owes an open connection](task-01-an-invalid-row-owes-an-open-connection.md) | done | - |

## Risks and tradeoffs

- none.

## Resume state

- **Done so far:** task 01, 2026-11-02; [implemented.md](implemented.md) says what was verified.
- **Next action:** none.
- **Open questions:** none.
- **Watch out for:** row 1 is a listed divergence that leaves the connection open after `-32005`; it keeps its entry.

## Final verification checklist

- [x] Rows 12 to 22 hold the host to an open connection.
- [x] A host that closes on a malformed offer fails those rows, and passed them before.
