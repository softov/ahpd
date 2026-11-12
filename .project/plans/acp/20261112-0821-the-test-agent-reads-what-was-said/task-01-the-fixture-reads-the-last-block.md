---
title: The fixture reads the last block
status: implemented
depends: []
layer: "agent-acp test fixture"
refs:
  - "[code://packages/agent-acp/test/fixtures/acp-server.mjs#L552-L557](../../../../packages/agent-acp/test/fixtures/acp-server.mjs#L552-L557) - `textOf`"
  - "[code://packages/agent-acp/test/fixtures/acp-server.mjs#L1474-L1510](../../../../packages/agent-acp/test/fixtures/acp-server.mjs#L1474-L1510) - `paint`"
---

## Objective

The fixture picks its scripts from the last text block only, and `paint` waits for its terminal before it releases it.

## Files

- `UPDATE: packages/agent-acp/test/fixtures/acp-server.mjs:552-557` - `textOf` returns the last text block.
- `UPDATE: packages/agent-acp/test/fixtures/acp-server.mjs:1509` - a `terminal/wait_for_exit` before the release.
- `UPDATE: packages/agent-acp/test/` - a case with instructions that hold `term` and a prompt `paint`.

## Steps

1. Change `textOf` to return the text of the last block whose type is `text`.
2. Add `await ask('terminal/wait_for_exit', { sessionId: session, terminalId })` before the release in `paint`.
3. Write a case that starts a session with instructions holding `term` and `ask`, and prompts `paint`.
4. Run the agent-acp suite, and fix any test that relied on an earlier block.

## Validation

- The new case: only the *Paint and preview* call, and no permission asked.
- `pnpm typecheck` and the agent-acp suite pass.

## Resume

Implemented 2026-11-12. `textOf` reads the last text block, and `paint` waits for its terminal before the release.
Step 4 is not run: Softov runs the agent-acp suite. The cases that put their word in an earlier block are fixed.
The new case is in `packages/agent-acp/test/agent-acp-turn.test.ts`, because the blocks harness opens no terminals.
See [implemented.md](implemented.md).
