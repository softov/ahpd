---
title: The protocol's cases are the oracle - deferred
date: 2026-11-01
---

## What waits

- **A case starts from its `initial`.** The host builds its root, session and chat state itself, so nothing can seed a case's state. Each case starts from the host's own state until the host keeps its state as the protocol reducers' output. Then the driver seeds `initial` and holds the result to `expected`.
- **A case naming a chat other than the default one.** Cases 272 and 273 name a peer chat. They run on the default chat until a case can be seeded.
- **The rest of the suite's dispatches.** 595 dispatches in 96 test files send no `clientSeq`, and many turns carry no `startedAt` or message `origin`. This plan corrected the conformance suite's. The others belong to the correction that makes the host refuse a malformed action.
- **Stamps taken in one step.** The held clock makes two stamps the host takes during one step equal. In real time they can differ by milliseconds: a turn's `modifiedAt` and the `startedAt` its echo carries are taken by separate reads of the clock. A host whose state is the reducers' output takes one, and the case then shows it.

## Where it goes

The first two wait for the host's state to be the reducers' output, and the third for the host's refusal of a malformed action.
