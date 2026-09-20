---
title: The ready connect URL lives in the daemon record and never on stdout - deferred
date: 2026-09-20
---

The record is now where the ready URL lives, and the prose that tells a person how to connect has not caught up.

| What | Why it waits | Where it goes |
| --- | --- | --- |
| `docs/DAEMON.md` points at the record and its `connectUrl` | The plan left the document for a later change so the record could land first | the `documentation` domain, beside [01 - The stale prose matches the code again](../../documentation/01-correct-the-stale-prose/plan.md) |
