---
title: A cofold turn reads its message's attachments, and sends an image only to a model that takes images - implemented
date: 2026-10-09
refs:
  - git://a2f0af4
  - "[code://packages/agent-cofold/src/turns.ts](../../../../packages/agent-cofold/src/turns.ts)"
  - "[code://packages/agent-cofold/src/session.ts](../../../../packages/agent-cofold/src/session.ts)"
---

A message sent to a cofold session now reaches the model with its attachments.
Pasted text and references go as text, and a small image goes as an image part when the model takes images.
A queued message keeps its attachments, and a steering message sends them as the run's parts.

## What was built

- [`code://packages/agent-cofold/src/turns.ts`](../../../../packages/agent-cofold/src/turns.ts) - `partsFor` turns a message into cofold's parts through the shared `partsOf`, and `startTurn` reads them before the run starts.
- [`code://packages/agent-cofold/src/session.ts`](../../../../packages/agent-cofold/src/session.ts) - `begin` passes its attachments on, and `steer` sends the parts after the text.
- [`code://packages/agent-cofold/test/agent-cofold-attachments.test.ts`](../../../../packages/agent-cofold/test/agent-cofold-attachments.test.ts) - seven cases on the `input` a run starts with.

## Verified

- `agent-cofold-attachments.test.ts` covers, among its seven cases, an image on an images model, the same image on a text-only model, pasted text, a picked file, a queued message and a steer.
- Full gates on the review tree: schema, build, typecheck, boundary and vitest.

## Departures from the plan

- The fourth row of the second decisions table said a steer names each attachment by path until cofold's `steer` takes parts. `@cofold/agents@0.2` already takes parts, so a steer sends its parts now.

## Left for later

- A steer whose read of its attachments outlives the run is dropped without a report, because the host has no event for a steering message.
