---
title: The proxy serves every model endpoint - implemented
date: 2026-11-05
refs:
  - git://ff352b55 - its merge on main
---

The proxy serves every model endpoint.

## What was built

- [01 - Tokens are counted](task-01-tokens-are-counted.md).
- [02 - Embeddings are served](task-02-embeddings-are-served.md).
- [03 - Responses are served](task-03-responses-are-served.md).
- [04 - Images are served](task-04-images-are-served.md).
- [05 - Audio is served](task-05-audio-is-served.md).
- [06 - Rerank is served](task-06-rerank-is-served.md).
- [07 - The docs list every endpoint](task-07-the-docs-list-every-endpoint.md).

## Verified

- CI on #243 at e2d4588a, the code of main at 3f6e3da8, passed every check, Windows included.
- Each task file says what its cases check.

## Departures from the plan

- Each task's *Resume* section says what it found while it was built.

## Left for later

- none
