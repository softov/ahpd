---
title: A response round that ends empty is announced, or the gap is recorded - deferred
date: 2026-09-20
---

The Claude Agent SDK exposes no event for a round that ended with neither text nor tool calls, so this host cannot announce one and the client gap is recorded instead.

| What | Why it waits | Where it goes |
| --- | --- | --- |
| A client settles an open reasoning section when a model round ends with no text and no tool calls | `@anthropic-ai/claude-agent-sdk@0.3.278` has no such event, so a client keeps the section open until the next part arrives and draws two rounds of thinking as one, or until the turn's `result` arrives | unplanned; it needs an SDK event for the round, and it is what ahpc screen/02 would read |
