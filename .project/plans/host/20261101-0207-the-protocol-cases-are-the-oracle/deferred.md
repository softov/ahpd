---
title: The protocol's cases are the oracle - deferred
date: 2026-11-01
---

## What waits

- **The rest of the suite's dispatches.** 595 dispatches in 96 test files send no `clientSeq`, and many turns carry no `startedAt` or message `origin`. This plan corrected the conformance suite's. The others belong to the correction that makes the host refuse a malformed action.

## Where it goes

It waits for the host's refusal of a malformed action.
