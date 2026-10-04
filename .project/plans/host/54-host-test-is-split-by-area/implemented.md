---
title: host.test.ts is split into one test file per area, with its helpers in one module - implemented
date: 2026-10-04
refs:
  - "[code://packages/sdk/test/support/host.ts](../../../../packages/sdk/test/support/host.ts) - the helpers the host test files share"
  - "[code://packages/sdk/test/support/claude-sdk.ts](../../../../packages/sdk/test/support/claude-sdk.ts) - the fake Claude SDK each file mocks with"
---

`packages/sdk/test/host.test.ts` (7,721 lines) is gone, and its 328 tests are thirteen files named `host-<area>.test.ts`, none over 756 lines.

## What was built

- `test/support/claude-sdk.ts` - the fake SDK, importing nothing, mocked in each file with one `vi.mock` line; `resetSdk` is registered by each file with `beforeEach(resetSdk)`.
- `test/support/host.ts` - the helpers two or more files read.
- Thirteen area files: handshake, catalogue, turn, input, sessionconfig, harness, tools, terminals, files, chats, names, snapshots and github. `driving a turn` opens in both `host-turn.test.ts` and `host-input.test.ts`, so every test keeps its full name.
- Open plans and `00-host.md` cite the new files; built plans keep their refs.

## Verified

- A pure move: 328 tests before and after, and every line of the old file is in the new ones, except the imports and the fake SDK, which moved to the support modules.
- `pnpm exec tsc --noEmit`, `pnpm boundary` pass; `pnpm test` passes 197 of 198 files, the one failure `wire.test.ts`'s 5 s budget under load, which passes alone.

## Departures from the plan

- Fixed in review: some tool dropped unused destructured names in five test bodies (`const { client } = await running()` became `const {  } = ...`), and made the same kind of change in `packages/computer/src/manifest.ts` and `agent-acp-delete.test.ts`, which this plan does not touch. All were put back as they were.

## Left for later

- The tasks stay `implemented` until Softov reviews them.
