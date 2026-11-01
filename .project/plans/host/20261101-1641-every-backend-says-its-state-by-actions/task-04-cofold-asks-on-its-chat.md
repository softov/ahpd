---
title: cofold asks on its chat
status: done
depends: []
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/mapping.ts](../../../../packages/agent-cofold/src/mapping.ts) - `input.requested`, which raises a session entry alone"
---

## Objective

A question a cofold run asks goes on its chat by `chat/inputRequested`, beside the session's entry.
So the chat holds the request a client answers.

## Files

- `UPDATE: packages/agent-cofold/src/mapping.ts:628-651` - `chat/inputRequested` goes out before the session's entry.
- `UPDATE: packages/agent-cofold/src/runs.ts:131-137` - the run holds the request from its first announcement.

## Steps

1. Say `chat/inputRequested` with the request when a run asks a question.
2. Keep the session's `chatInput` entry beside it.
3. Run cofold's suites.

## Validation

- A test fails before the change, with no input request on the chat, and passes after it.
- `pnpm exec vitest run packages/agent-cofold/test` passes.

## Resume

Done; [implemented.md](implemented.md) says what was built.
The run holds the request from its first announcement, the chat's or the session's, so a client answering inside either finds it.
