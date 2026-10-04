---
title: host.test.ts is split into one test file per area, with its helpers in one module
domain: host
status: planned
priority: high
created: 2026-10-04
revalidated: 2026-10-04
requires: []
refs:
  - "[code://packages/sdk/test/host.test.ts](../../../../packages/sdk/test/host.test.ts) - 7,945 lines, 328 tests in 51 top-level `describe` blocks and two top-level `it`s, the file this plan empties"
  - "[code://packages/sdk/test/host.test.ts#L34-L137](../../../../packages/sdk/test/host.test.ts#L34-L137) - the fake Claude SDK: the `sdk` state in `vi.hoisted` and the `vi.mock('@anthropic-ai/claude-agent-sdk')` factory every block depends on"
  - "[code://packages/sdk/test/host.test.ts#L139-L209](../../../../packages/sdk/test/host.test.ts#L139-L209) - the modules loaded after the mock, `machine`, `serving`, `peer`, `open`, `hello` and the `beforeEach` that empties `sdk`"
  - "[code://packages/sdk/test/host.test.ts#L534-L579](../../../../packages/sdk/test/host.test.ts#L534-L579) - `running`, `actions`, `settle` and `emit`, the helpers most blocks after line 581 call"
  - "[code://packages/sdk/test/scenario.ts](../../../../packages/sdk/test/scenario.ts) - the pattern the helper module copies: a module beside the suites, not collected because it is not `*.test.ts`, imported by the suites that need it"
  - "[code://vitest.config.ts](../../../../vitest.config.ts) - no `include`, so vitest's default collects `*.test.ts` and leaves `test/support/` alone"
  - "[code://packages/sdk/test/conformance.test.ts#L31-L46](../../../../packages/sdk/test/conformance.test.ts#L31-L46) - one of four other suites (`conformance`, `wire`, `toolpolicy`, `toolauth`) with a fake SDK of its own, which this plan leaves alone"
  - "[code://packages/sdk/src/host](../../../../packages/sdk/src/host) - the 30 area files host/48 split `host.ts` into, whose names the test files follow"
  - "[code://.project/plans/host/00-host.md](../../../../.project/plans/host/00-host.md) - its *Tests* section names `test/host.test.ts` as the main suite"
  - npm://vitest@3.2.7 - `vi.mock` is hoisted above the imports of the file that calls it, and its factory may return a promise
---

## Goal

`packages/sdk/test/host.test.ts` is 7,945 lines, the largest file in the repository now that [host/48](../48-host-is-split-by-area/plan.md) split `packages/sdk/src/host.ts` into `packages/sdk/src/host/<area>.ts`.
Softov, 2026-10-04: no file over 1,500 lines, and 1,000 is already too many; test files of roughly 300 to 800 lines.
After this plan the suite is 13 test files named `host-<area>.test.ts` after the areas host/48 drew, each between about 485 and 760 lines, and the fake SDK and the helpers they share are two modules under `packages/sdk/test/support/`.
It is a pure move: no test is rewritten, renamed, removed or added, and `packages/sdk` runs the same tests under the same names before and after.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.
Line numbers are at `b4f1a4b`; task 01 shifts every line below it, so tasks 02 to 07 find each block by its `describe` name first.

### Searches performed

- `grep -nE "^(describe|it)\(" packages/sdk/test/host.test.ts` - 51 top-level `describe` blocks and two top-level `it`s; every gap between them is blank or a block comment that belongs to the block after it.
- `grep -cE "^\s*(it|test)(\.[a-z]+)?\(" packages/sdk/test/host.test.ts` - 328, and `pnpm exec vitest list packages/sdk/test/host.test.ts` lists 328; no `it.each`, `it.skip` or `it.only`.
- `pnpm exec vitest list packages/sdk | wc -l` at `b4f1a4b` - **1,316 tests** in `packages/sdk`, 328 of them in `host.test.ts`.
- `grep -nE "^\s+(describe|beforeEach|afterEach)\(" packages/sdk/test/host.test.ts` - three nested `describe`s (`what kind of row a tool call is` at 690, `an approval that can be kept` at 1088, `the session tools` at 5075) and three nested hooks (`a session's config across a restart` at 2581 and 2585, `the pull request a create-pr recorded` at 7731); all move inside their block.
- Which top-level names each block reads, by a scan of each block's body: `sdk`, `peer`, `hello`, `running`, `actions`, `settle` and `emit` are read by most blocks; `REPO` only by `the host's filesystem` and `completing an at-sign`; `ETX` only by `interrupting a terminal`.
- `rg -n "host\.test" packages/sdk/test/host.test.ts` - none; the file names `host.ts` only as a file to list and read (3745, 3812, 3891, 3897), which a move does not change.
- `rg -l "packages/sdk/test/host.test.ts" .project/plans` - 21 plan folders, 70 refs; the 10 not built (claude/10, container/05 p7, host/30, host/44, host/44 p3, host/45, host/47 p1, host/47 p3, host/49, host/50) are rewritten by task 08.

### Runtime path

```
vitest -> host-<area>.test.ts -> vi.mock factory loads support/claude-sdk.ts -> support/host.ts (serving, peer, running, emit) -> createHost -> the blocks' expects
```

### Gaps

- The fake SDK is declared with `vi.hoisted` and `vi.mock` inside the test file, and `vi.mock` only takes effect for the file that calls it, so every new test file needs its own `vi.mock` line.
- A `vi.mock` factory cannot load a module that imports the mocked module: `support/host.ts` imports `claude.js`, which imports `@anthropic-ai/claude-agent-sdk`, so the fake needs a module of its own that imports nothing.
- `driving a turn` is one `describe` of 801 lines, over the 800 aim on its own.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| No file over 1,500 lines; 1,000 is already too many | Softov, 2026-10-04 | every task |
| Test files of roughly 300 to 800 lines | Softov, 2026-10-04 | 02 to 07 |
| A pure move: no test is rewritten, renamed, removed or added, and the same number of tests runs in `packages/sdk` before and after | Softov, 2026-10-04 | every task |
| One test file per area, `packages/sdk/test/host-<area>.test.ts`, following host/48's areas where a block belongs to one | Softov, 2026-10-04 | 02 to 07 |
| What several files need is one helper module, `packages/sdk/test/support/host.ts` | Softov, 2026-10-04 | 01 |
| Each task passes `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm exec vitest run packages/sdk`, and the test count in `packages/sdk` equals the count recorded before task 01 (1,316 at `b4f1a4b`) | Softov, 2026-10-04 | every task |
| The fake SDK is `packages/sdk/test/support/claude-sdk.ts`, which imports nothing; each test file mocks with one line, `vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake)` | (defaulted: `vi.mock` is per file, and a factory that loaded `support/host.ts` would import the module it is mocking) | 01 |
| `beforeEach`'s body becomes `resetSdk()` in `support/claude-sdk.ts`, and each test file registers it with `beforeEach(resetSdk)` | (defaulted: a hook registered as a side effect of an import is invisible in the file it runs in) | 01 |
| `driving a turn` is split across `host-turn.test.ts` and `host-input.test.ts`, each opening `describe('driving a turn', ...)`, so every test keeps its full name | (defaulted: the block is 801 lines, and the confirmation and question tests are an area of their own) | 03 |
| A constant one file alone reads moves into that file: `REPO` into `host-files.test.ts`, `ETX` into `host-terminals.test.ts` | (defaulted: the helper module holds what several files need, nothing else) | 05, 06 |
| Blocks keep their order: inside a new file, and inside `host.test.ts` until it is gone, they stand in the order they had | (defaulted: vitest runs a file's tests in order, and a test that leaned on an earlier one keeps its neighbour) | 02 to 07 |
| `host.test.ts` is deleted when its last block moves | (defaulted: a pure move leaves no empty file) | 07 |
| Open plans that cite `host.test.ts`, and the *Tests* line of `00-host.md`, cite the new files; built plans keep their refs | (defaulted: as host/48 p11 did for `host.ts`) | 08 |

## Proposed architecture

Two support modules and 13 test files, all under `packages/sdk/test/`.
Line ranges are at `b4f1a4b` and include the block comment above a block; the estimate adds about 15 lines of imports, the `vi.mock` line and `beforeEach(resetSdk)`.

| File | What it holds (`describe` names, lines at `b4f1a4b`) | Tests | Lines (about) | Area in `src/host/` | Task |
| --- | --- | --- | --- | --- | --- |
| `support/claude-sdk.ts` | the `sdk` state (34-73, out of `vi.hoisted`), the fake module as `fake` (77-137), `resetSdk` (the body of 190-209) | - | 135 | - | 01 |
| `support/host.ts` | the comment at 24-32, `sessionQueries` (75), the modules loaded after the mock (139-154) re-exported, `machine`, `serving`, `peer`, `open`, `hello` (159-188), `running`, `actions`, `settle`, `emit` (534-579) | - | 130 | - | 01 |
| `host-handshake.test.ts` | `the handshake` (211-295), `what it will not pretend` (428-531), `a client that dropped, coming back` (3613-3724), `authenticating` (4518-4750), `telling a client how far along something is` (5720-5750), `a client this host has not met` (7306-7351) | 36 | 630 | `handshake.ts`, `admission.ts`, `gate.ts` | 02 |
| `host-catalogue.test.ts` | `the catalogue` (297-426), `a session that already happened` (1724-1844), `paging a long history` (2165-2268), `the flags a client sets` (2388-2427), `a session read from its transcript` (2429-2575), `one conversation, one row` (2791-2810), the top-level `it`s `takes a client into a session it is serving from a transcript` (6630-6653) and `takes a client into a session the catalogue has listed, before anybody reads it` (7353-7379) | 30 | 635 | `catalogue.ts`, `history.ts` | 02 |
| `host-turn.test.ts` | `driving a turn` (581-1050, and 1345-1381: `tells every client when a session goes`, `moves serverSeq with state`), `what the client is told about its own turn` (2362-2386), `one tool call, one row` (2812-2948), `a compacted context` (3963-3988), `running a failed turn again` (4752-4797) | 26 | 760 | `chatactions.ts`, `lifecycle.ts` | 03 |
| `host-input.test.ts` | `driving a turn` (1052-1343: confirmations, `an approval that can be kept`, questions and their drafts, a cancelled block), `a message typed while a turn is running` (3074-3216), `what a chat says about itself` (5752-5796) | 20 | 500 | `chatactions.ts` | 03 |
| `host-sessionconfig.test.ts` | `choosing a model` (1846-2162), `a session's config across a restart` (2577-2789) | 25 | 545 | `sessionconfig.ts` | 04 |
| `host-harness.test.ts` | `what the harness offers` (1384-1721), `what a slash offers` (2270-2360), `what goes after a slash` (2950-2989), `turning a customization on and off` (3436-3537), `a skill is not a prompt` (3539-3611) | 32 | 665 | `tooling.ts` | 04 |
| `host-tools.test.ts` | `tools the host contributes` (4977-5383), `the MCP servers a session is offered` (5385-5461), `tools a client contributes` (5463-5718) | 26 | 760 | `tooling.ts` | 05 |
| `host-terminals.test.ts` | `ETX` (156-157), `a command typed into the conversation` (3990-4251), `a shell on this machine` (4253-4459), `a terminal a backend opens` (4461-4516), `interrupting a terminal` (6310-6344) | 21 | 580 | `terminals.ts` | 05 |
| `host-files.test.ts` | `REPO` (15-22), `where the agent works` (2991-3072), `the host's filesystem, as far as a client may see it` (3726-3878), `completing an at-sign` (3880-3922), `more than one directory` (4799-4975) | 25 | 485 | `resourcemethods.ts`, `sessionconfig.ts` | 06 |
| `host-chats.test.ts` | `two people on one chat` (3924-3961), `dropping the turns after one` (5798-5946), `a chat made out of another` (5948-6149), `more than one chat in a session` (6151-6307) | 21 | 565 | `chatactions.ts`, `sessionmethods.ts` | 06 |
| `host-names.test.ts` | `a chat asked for by the name a client computed` (6655-6713), `a session a client names` (6715-6832), `a session asked for by the name a client computed` (6834-6971), `a session asked for by the name its creator used` (6973-7148) | 25 | 510 | `routing.ts` | 07 |
| `host-snapshots.test.ts` | `what it says it is doing` (3218-3434), `the fields a client reads by name` (6346-6628), `a session's annotations` (7150-7304) | 25 | 675 | `snapshots.ts`, `actions.ts` | 07 |
| `host-github.test.ts` | `what GitHub knows about the branch` (7381-7621), `what a session recorded` (7623-7718), `the pull request a create-pr recorded` (7720-7945) | 16 | 580 | `facts.ts` | 07 |

The test column adds up to 328, the count `host.test.ts` holds today.

- **Data flow** - unchanged: each block calls the same helpers, now imported from `./support/host.js` instead of declared above it.
- **State flow** - `sdk` is one object per test file, as today: vitest gives each file its own module graph, so the `sdk` a test file imports and the one the mock's factory loads are the same instance, and `resetSdk` empties it before every test.
- **Layer responsibilities** - `packages/sdk/test` only; no source file changes.
- **Source-of-truth files** - [`code://packages/sdk/test/host.test.ts`](../../../../packages/sdk/test/host.test.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The fake SDK and the shared helpers are modules of their own](task-01-the-helpers-are-a-module.md) | todo | - |
| [02 - The handshake and the catalogue are test files of their own](task-02-handshake-and-catalogue.md) | todo | 01 |
| [03 - A turn and what a client puts into it are test files of their own](task-03-turn-and-input.md) | todo | 02 |
| [04 - Session config and what the harness offers are test files of their own](task-04-session-config-and-harness.md) | todo | 03 |
| [05 - Tools and terminals are test files of their own](task-05-tools-and-terminals.md) | todo | 04 |
| [06 - Files and chats are test files of their own](task-06-files-and-chats.md) | todo | 05 |
| [07 - Names, snapshots and GitHub are test files of their own, and host.test.ts is gone](task-07-names-snapshots-and-github.md) | todo | 06 |
| [08 - Open plans cite the new test files](task-08-open-plans-cite-the-new-files.md) | todo | 07 |

## Risks and tradeoffs

- The mock is the one thing that can break silently: a test file whose `vi.mock` line is missing or wrong runs the real SDK, which starts a CLI and fails or hangs; task 01 proves the mechanism on `host.test.ts` itself before any block moves.
- A block that reads a helper nobody exported fails `tsc`, but an import nobody reads passes it (`noUnusedLocals` is off); each task imports only what its blocks call, checked by eye against the scan in *Searches performed*.
- Every open plan that edits `host.test.ts` conflicts with this one; tasks 02 to 07 run back to back on one branch, and task 08 points those plans at the new files.
- Splitting `driving a turn` puts one `describe` name in two files; `vitest list` shows the file in front of the name, so a reader of a failure sees which half.
- Order inside a file can matter to a test that reads state an earlier one left; blocks keep their order, and `resetSdk` runs before each test as `beforeEach` does today.

## Resume state

- **Done so far:** nothing; planned 2026-10-04 at `b4f1a4b`.
- **Next action:** [task-01-the-helpers-are-a-module.md](task-01-the-helpers-are-a-module.md).
- **Count before:** 1,316 tests in `packages/sdk` at `b4f1a4b`, 328 of them in `host.test.ts`; task 01 records it again before its first edit.
- **Open questions:**
  1. Keep `driving a turn` whole in one file of about 830 lines instead of splitting it? - proposed: split, as in the table, since 830 is over the 800 aim.
- **Watch out for:** line numbers are at `b4f1a4b` and task 01 moves them all; find each block by its `describe` name. The `vi.mock` factory loads `support/claude-sdk.ts`, never `support/host.ts`.

## Final verification checklist

- [ ] `packages/sdk/test/host.test.ts` does not exist.
- [ ] `wc -l packages/sdk/test/host-*.test.ts packages/sdk/test/support/*.ts` shows no file over 800 lines.
- [ ] `pnpm exec vitest list packages/sdk | wc -l` is 1,316, or the count task 01 recorded.
- [ ] `pnpm exec vitest list packages/sdk | sed 's/^[^ ]* > //' | sort` equals the same list taken before task 01.
- [ ] `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm exec vitest run packages/sdk` pass.
- [ ] `rg -n "test/host\.test\.ts" .project/plans` matches only built or dropped plans and this plan's family.
- [ ] `plans/index.md` updated.
