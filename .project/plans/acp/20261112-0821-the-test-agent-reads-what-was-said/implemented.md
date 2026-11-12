---
title: The test agent reads what was said - implemented
date: 2026-11-12
refs:
  - git://822b9aea0 - the commit this branch was built on; the work below is uncommitted
  - "[`code://packages/agent-acp/test/fixtures/acp-server.mjs`](../../../../packages/agent-acp/test/fixtures/acp-server.mjs) - `textOf` and `paint`"
  - "[`code://packages/agent-acp/test/agent-acp-blocks.test.ts`](../../../../packages/agent-acp/test/agent-acp-blocks.test.ts) - the attachment cases that moved their script word"
  - "[`code://packages/agent-acp/test/agent-acp-turn.test.ts`](../../../../packages/agent-acp/test/agent-acp-turn.test.ts) - the new case"
  - "[`code://packages/agent-acp/test/agent-acp-ports.test.ts`](../../../../packages/agent-acp/test/agent-acp-ports.test.ts) - the pseudoterminal case, which now ends its shell"
---

The test agent now runs only the script that the person's own words name. `textOf` reads the last text block of a prompt, so the host's instructions no longer start `term`, `ask` or `write`. `paint` waits for its terminal to exit before it releases it, so the command runs even where a release would end it.

## What was built

- [`code://packages/agent-acp/test/fixtures/acp-server.mjs`](../../../../packages/agent-acp/test/fixtures/acp-server.mjs) - `textOf` returns the last text block alone, with a comment on the order of the blocks.
- [`code://packages/agent-acp/test/fixtures/acp-server.mjs`](../../../../packages/agent-acp/test/fixtures/acp-server.mjs) - `paint` calls `terminal/wait_for_exit` before `terminal/release`.
- [`code://packages/agent-acp/test/agent-acp-blocks.test.ts`](../../../../packages/agent-acp/test/agent-acp-blocks.test.ts) - the attachment cases keep the script word in the last text block, now named or labelled `blocks.*`.
- [`code://packages/agent-acp/test/agent-acp-turn.test.ts`](../../../../packages/agent-acp/test/agent-acp-turn.test.ts) - "runs only the script the person named when the instructions hold another".
- [`code://packages/agent-acp/test/agent-acp-turn.test.ts`](../../../../packages/agent-acp/test/agent-acp-turn.test.ts) - a host tool whose `instruction` holds `term` and `ask`, and a turn of `paint it`.
- [`code://packages/agent-acp/test/agent-acp-turn.test.ts`](../../../../packages/agent-acp/test/agent-acp-turn.test.ts) - only the *Paint and preview* call starts, no input is needed, and the prose holds no `term=` or `perm=`.
- [`code://packages/agent-acp/test/agent-acp-ports.test.ts`](../../../../packages/agent-acp/test/agent-acp-ports.test.ts) - the pseudoterminal case ends the fake shell once paint's terminal has started, because the fixture now waits on it.

## Verified

- `pnpm exec tsc -p tsconfig.json --noEmit` at the root is clean.
- `pnpm -C packages/agent-acp exec tsc -p tsconfig.json --noEmit` is clean after `pnpm -C packages/sdk exec tsc -p .` writes the ignored `dist`.
- The agent-acp suite passes at review, 2026-11-12: 22 files, 363 tests.
- The Windows check is not run yet.

## Departures from the plan

- The plan's watch-out says an attachment adds blocks after the text, so the last *text* block is what was said.
- The code does the opposite: `partsOf` puts the message text first, then the attachment or reference text.
- So an attachment's own block is last, and "Only the last text block" is built as written.
- The attachment cases that had their word in the message text now put it in the attachment's label or file name.
- The new case is in `agent-acp-turn.test.ts`, not the blocks test. The blocks harness hands `Start` no `terminals`, and `terminal/create` throws "this session has no shells" there. The turn harness has `shellTerminals()`, and a host tool's `instruction` is how the host's words reach the prompt.
- The pseudoterminal case in `agent-acp-ports.test.ts` ends its fake shell for the paint call. The fake pty exits only when a test says, and the fixture now waits for that exit.

## Left for later

- The Windows check.
