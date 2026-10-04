---
title: session.ts is split into one file per area, and session.ts only composes them
domain: claude
status: planned
priority: high
created: 2026-10-04
revalidated: 2026-10-04
requires: []
decisions: []
refs:
  - "[code://packages/agent-claude/src/session.ts#L714-L4234](../../../../packages/agent-claude/src/session.ts#L714-L4234) - `createSession`, one closure of about 3,500 lines holding every area below"
  - "[code://packages/agent-claude/src/session.ts#L1-L712](../../../../packages/agent-claude/src/session.ts#L1-L712) - the module-level code: `EFFORTS`, `Published`, the shell init helpers, `PendingInput`, `keptLabel`, `customizationsOf`, `agentNameOf`, `permissionFor`, `listsOf`, `contributed`, `ClaudeSessionOptions`"
  - "[code://packages/agent-claude/src/session.ts#L3451-L4233](../../../../packages/agent-claude/src/session.ts#L3451-L4233) - `self`, the `Session` literal, about 780 lines of state readers and methods"
  - "[code://packages/agent-claude/src/index.ts#L22-L23](../../../../packages/agent-claude/src/index.ts#L22-L23) - the package entry re-exports `createSession`, `EFFORTS`, `EFFORT_LABELS` and `Published` from `./session.js`"
  - "[code://packages/agent-claude/src/claude.ts#L3](../../../../packages/agent-claude/src/claude.ts#L3) - imports `createSession`, `EFFORT_LABELS`, `EFFORTS` from `./session.js`"
  - "[code://packages/agent-claude/src/probe.ts#L2](../../../../packages/agent-claude/src/probe.ts#L2) - imports `customizationsOf`, `EFFORT_LABELS`, `EFFORTS` from `./session.js`"
  - "[code://packages/agent-claude/test/kept-label.test.ts#L3](../../../../packages/agent-claude/test/kept-label.test.ts#L3) - imports `keptLabel` from `../src/session.js`; `customizations.test.ts` imports `customizationsOf` and `agent-claude-agent-pick.test.ts` imports `agentNameOf` the same way"
  - "[code://packages/sdk/src/host/context.ts#L31-L40](../../../../packages/sdk/src/host/context.ts#L31-L40) - `HostContext`, the pattern this plan mirrors: one typed context, a `let` that crosses files is a field read as `ctx.<name>`"
  - "[code://packages/sdk/src/host.ts#L707-L735](../../../../packages/sdk/src/host.ts#L707-L735) - how `createHost` builds the context and assigns each area's factory onto it"
---

## Goal

`packages/agent-claude/src/session.ts` is 4,234 lines, almost all of it one `createSession(options)` closure.
Softov, 2026-10-04: no file over 1,500 lines, 1,000 is already too many, and files of roughly 300 to 700 lines are the aim.
After this plan each area of a Claude session is its own file under `packages/agent-claude/src/session/`, and `session.ts` only builds the context, wires the areas together and returns the `Session`.
Nothing a host, a client or a test sees changes: every export keeps its name and its import path, and every task is a move with no behaviour change.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.
Line numbers are at `b4f1a4b`; every task finds its code by symbol name first, because the tasks before it move the lines.

### Searches performed

- Read `session.ts` whole and grouped every declaration by what it is about, which is the table in *Proposed architecture*.
- `grep -nE "^  (const|let|function|interface) " packages/agent-claude/src/session.ts` - the declarations directly inside `createSession`, mapped to the areas below.
- `rg -n "session\.js'" packages/agent-claude` - `index.ts`, `claude.ts`, `probe.ts` and 15 test files import from `./session.js` or `../src/session.js`: `createSession`, `EFFORTS`, `EFFORT_LABELS`, `Published`, `customizationsOf`, `keptLabel`, `agentNameOf`.
- `rg -n "vi\.mock\(" packages/agent-claude/test` - 13 tests mock `@anthropic-ai/claude-agent-sdk` before importing `session.js`; the mock replaces the specifier for every module, so it reaches `query` and `createSdkMcpServer` wherever they are imported from.
- `rg -n "session\.ts" packages/agent-claude/test` - only a comment in `agent-claude-declarations.test.ts:15`; no test reads the source as text.
- `grep -c ctx packages/agent-claude/src/session.ts` - 0, so a pure-move check can strip `ctx.` from both sides of the diff.
- `rg -l "code://packages/agent-claude/src/session.ts" .project/plans` - ten open plans cite the file: claude/10, container/05 p1 and p5, host/43 p2 and p4, host/47 p2, p3 and p4, host/49 and host/50.

### Gaps

- `createSession` holds its mutable state as about 24 `let`s (`active`, `title`, `failed`, `handle`, ...) that every area reads or writes, so no other file can reach them today.
- `mainScope` reads and writes `active` and `streaming` through getters and setters, so it has to follow those two onto the context.
- Six statements run while the session is built, in this order, and must keep it: the stored model taken into `chosen` at 822-824, `setShellInit` at 890, `declared.ahp = contributed(...)` at 1393, `let handle = startQuery(running, true)` at 2618, `void describe()` at 3063 and `void consume()` at 3337.
- `stopWorker` calls `self.cancel('')`, so the composed `Session` has to be reachable from the file `stopWorker` moves to.
- Six comments sit away from the declaration they describe (837 above `settings`, 1463 above `edits`, 1605 above `inputNeededSet`, 2620-2627 above `carried`, 2897-2904 above `refreshMcp`, 3538-3543 above `setConfig`); a pure move keeps each with the declaration directly below it.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| No file over 1,500 lines; 1,000 is already too many | Softov, 2026-10-04 | every task |
| Files of roughly 300 to 700 lines, one per area, in a folder `packages/agent-claude/src/session/`; `session.ts` keeps only what composes them and stays under 1,000 lines | Softov, 2026-10-04 | every task |
| Every task is a pure move: no behaviour change, no new feature, no rewritten logic; comments move with their code and none is added about the move | Softov, 2026-10-04 | every task |
| `session.ts` stays the entry: `createSession`, `EFFORTS`, `EFFORT_LABELS`, `Published`, `customizationsOf`, `INTERNAL_AGENT`, `agentNameOf`, `keptLabel`, `permissionFor` and `ClaudeSessionOptions` are still exported from it, re-exported where they moved | [code://packages/agent-claude/src/index.ts#L22-L23](../../../../packages/agent-claude/src/index.ts#L22-L23), `claude.ts`, `probe.ts` and the tests that import `../src/session.js` | every task |
| One `SessionContext` in `session/context.ts` (types only), built once in `createSession` and handed to each area's factory `create<Area>(ctx)`, which returns what the area offers and is assigned onto it (`Object.assign(ctx, createParts(ctx))`); a `let` that crosses files becomes a field, its comment moves onto that field, and every reader and writer uses `ctx.<name>` | (defaulted: mirrors host/48's "One HostContext", Softov, 2026-10-03, [code://packages/sdk/src/host/context.ts#L31-L40](../../../../packages/sdk/src/host/context.ts#L31-L40)) | 02 to 08 |
| A `Session` method moves with its area, in a `methods` table the factory returns beside what it offers, and `self` spreads the tables | (defaulted: host/48 p9's method families, `{ storeFor, methods }`) | 02 to 08 |
| A map or array one area declares moves into that area's factory with its comment and is offered on the context when another file reads it | (defaulted: host/48's "a map one area alone writes moves into that area's factory", applied to keep each comment beside its code) | 02 to 08 |
| Each task is validated by `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm exec vitest run packages/agent-claude` and a pure-move check, and records `wc -l` of `session.ts` and of each new file | Softov, 2026-10-04 | every task |
| This plan lands before host/50 and the other open plans that edit `session.ts`, or they rebase over it | Softov, 2026-10-04 | all |

## Proposed architecture

A folder `packages/agent-claude/src/session/` beside `session.ts`.
Each stateful file exports a factory `create<Area>(ctx: SessionContext)` and an interface of what it offers, which `SessionContext` extends, the way `HostContext` extends `Routing` and the rest.
Inside a factory, an option, a const map or a function of the same file is used directly; a `let` field and a function another area offers are read as `ctx.<name>` where they are used, so the order the areas are built in does not matter and nothing is copied at construction.
That `ctx.` prefix, the `export` keyword and the indentation are the only edits a moved line gets.
A file under `session/` never imports `../session.js`, which would be a cycle.

| File | What it holds | Lines today (at `b4f1a4b`) | Estimated lines | Task |
| --- | --- | --- | --- | --- |
| `session/common.ts` | `bag`, `list`, `str` | 64-66 | 10 | 01 |
| `session/customizations.ts` | the customization list the CLI reports, and the agent a uri names: `Published`, `customizationsOf`, `INTERNAL_AGENT`, `AGENT_FILE_MOST`, `agentNameOf` | 32-39, 200-528 | 350 | 01 |
| `session/context.ts` | `SessionContext` (types only) and `ClaudeSessionOptions`; the comments of the `let`s that become fields (`allowed`, `failed`, `gone`, `ran`, `agentId`, `activity`, `draft`, `chosen`, `beginning`, `settings`, `values`, `offering`, `peers`, `steering`, `running` and `handle`) | 674-712, the `let` comments in 733-855, 909-917, 1367-1374, 1417-1427, 2610-2617 | 240 | 02, grows with each task |
| `session/config.ts` | a session's config: `EFFORTS`, `EFFORT_LABELS`, `ShellInitScript`, `MAX_SHELL_INIT_SCRIPT`, `shellInitScripts`, `sourcing`, `permissionFor`, `listsOf`, `initScript`, `sourced`, `setShellInit`, `sourceFirst`; methods `setConfig`, `settings` | 17-30, 79-111, 530-586, 862-889, 891-897, 3538-3616 | 240 | 02 |
| `session/clienttools.ts` | the host's and the clients' tools as the in-process MCP server, and the calls a client runs: `shaped`, `contributed`, `called`, `providedBy`, `unclaimed`, `expecting`, `opening`, `claim`, `byClient`, `releaseCalls`, `ranByClient`; methods `setTools`, `toolCallOwner`, `completeToolCall`, `clientGone` | 588-672, 918-981, 4055-4105 | 220 | 02 |
| `session/parts.ts` | what a turn holds and what the session says about it: `touch`, `doing`, `busyWith`, `retitle`, `usageOf`, `spent`, `newTurn`, `count`, `sum`, `sayUsage`, `paid`, `costOf`, `status`, `inputNeededSet`, `inputNeededRemoved`, `openTurn`, `addPart`, `holdPart`, `stampStart`, `stampEnd`, `untimed`, `failurePart`, `addFailure` | 1446-1461, 1479-1490, 1492-1730 | 290 | 03 |
| `session/workers.ts` | subagents and their chats: `parts`, `calling`, `Scope`, `mainScope`, `scopes`, `Spawning`, `spawning`, `background`, `tasks`, `byAgent`, `ended`, `dropped`, `SPAWN_GRACE`, `scopeFor`, `openWorker`, `releaseHeld`, `recordSpawn`, `scopeOfCall`, `emitOn`, `settleOpen`, `endWorker`, `workerBlock`; method `stopWorker` | 991-1000, 1019-1359, 2241-2259, 3982-3998 | 410 | 04 |
| `session/stream.ts` | the SDK's frames translated into chat actions: `INPUT_SIDE`, `OUTPUT_SIDE`, `resultText`, `serverOf`, `rounds`, `edits`, `streamed`, `assistant`, `results`, `editing`, `pastLines` | 68-77, 194-198, 899-907, 1002-1017, 1463-1477, 1732-2239, 2999-3003 | 590 | 05 |
| `session/asking.ts` | permissions and questions put to a person: `PendingInput`, `KEPT_IN`, `keptLabel`, `pending`, `settled`, `canUseTool`, `answeredInputs`; methods `confirm`, `setAnswer`, `answer` | 113-192, 719-732, 2261-2426, 3005-3013, 4000-4053, 4107-4201 | 440 | 06 |
| `session/query.ts` | the CLI's query and the loop that reads it: `UUID`, `fromPreset`, `waiting`, `input`, `startQuery`, `reported`, `ends`, `take`, `switchAgent`, `consume` | 41-42, 856-860, 1361-1365, 1428-1444, 2428-2609, 2631-2650, 2688-2735, 3065-3336 | 580 | 07 |
| `session/servers.ts` | the MCP servers and what the CLI offers: `onServer`, `declared`, `wanted`, `discover`, `refreshMcp`, `serverNamed`, `describe`; methods `setCustomizationEnabled`, `startMcpServer`, `authenticated`, `awaiting`, `stopMcpServer` | 982-989, 1375-1383, 1395-1414, 2897-2997, 3015-3062, 3618-3735 | 325 | 07 |
| `session/turns.ts` | a turn started, refused, queued, steered, resumed and cancelled: `queued`, `busy`, `carried`, `refuseTurn`, `beginTurn`, `startNext`, `runCommand`; methods `begin`, `setTitle`, `ran`, `steer`, `queue`, `setDraft`, `unqueue`, `reorder`, `resume`, `cancel` | 787-795, 835-836, 2620-2629, 2652-2686, 2737-2895, 3339-3449, 3738-3980 | 595 | 08 |

What stays in `session.ts`: the imports and the re-exports, the module comment at 44-62, `createSession` with the `ctx` literal (the shared `let`s with their initial values, `turns`, `settings`, `values`, `options`), the factory calls, the six construction statements in today's order with their comments (the stored model at 808-824, `setShellInit` at 890, `declared.ahp` at 1384-1393, `startQuery` at 2618, `describe` at 3063, `consume` at 3337), and `self`: the state readers at 3451-3536 (`uri` to `chatState`), the spread method tables, and `close` at 4203-4231.
Estimated at 330 lines, from 4,234.

- **Data flow** - unchanged: an SDK frame reaches `consume` in `session/query.ts`, which hands it to `streamed`, `assistant` or `results` in `session/stream.ts`; a host call reaches a `Session` method spread into `self`.
- **State flow** - the shared `let`s are fields on one `SessionContext` built in `createSession`; a map lives in the factory of the area that declares it and is offered on the context.
- **Layer responsibilities** - agent-claude only; no other package changes, and `index.ts` is unchanged.
- **Source-of-truth files** - [`code://packages/agent-claude/src/session.ts`](../../../../packages/agent-claude/src/session.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The shared helpers and the customization list are files of their own](task-01-common-and-customizations.md) | todo | - |
| [02 - The context, the session config and the client tools are files of their own](task-02-context-config-and-client-tools.md) | todo | 01 |
| [03 - What a turn holds is a file of its own](task-03-turn-parts.md) | todo | 02 |
| [04 - Subagents and their chats are a file of their own](task-04-workers.md) | todo | 03 |
| [05 - The stream translation is a file of its own](task-05-stream.md) | todo | 04 |
| [06 - Asking a person is a file of its own](task-06-asking.md) | todo | 05 |
| [07 - The query and the MCP servers are files of their own](task-07-query-and-servers.md) | todo | 06 |
| [08 - The turn lifecycle is a file of its own, and session.ts only composes](task-08-turns.md) | todo | 07 |

## Risks and tradeoffs

- Other plans edit this file soon: host/50 changes `sessionId` in `startQuery` (cited at `session.ts#L2308`, which is already stale; the code is at 2571 and 2598), and claude/10, container/05 p1 and p5, host/43 p2 and p4, host/47 p2 to p4 and host/49 cite it too - this split lands before them or they rebase over it, and each finds its code by symbol name in the new file.
- A `let` copied off the context freezes it: a `let` in the closure is never copied off the context into a local at construction, and every reader and writer, including the code still in `session.ts`, uses `ctx.<name>` from the task that makes it a field.
- `mainScope` is the trap of that rule: its getters and setters become `get turn() { return ctx.active; }` and `get streaming() { return ctx.streaming; }`, and the main scope's `parts` and `calling` maps stay the same objects `consume` clears at the end of a turn.
- Construction order: no factory runs anything when it is built besides declaring its maps and functions; the six construction statements stay in `session.ts`, after every factory, in today's order, so the shell script is written, the `ahp` server declared and the query built exactly as now.
- A function still in `session.ts` that a moved file calls goes on the context from `session.ts` until its own task moves it (for example `doing` for `ranByClient` in task 02, `emitOn` for `openTurn` in task 03).
- One context is one wide object any file can reach into; the type in `session/context.ts` is where its reach is read.
- `self.cancel('')` in `stopWorker` becomes `ctx.self.cancel('')`, with `ctx.self` set once `self` is built; nothing calls `stopWorker` during construction.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-common-and-customizations.md](task-01-common-and-customizations.md).
- **Open questions:**
  1. Do the ten open plans that cite `session.ts` get their refs rewritten to the new files? - proposed: not in this plan, which was asked not to edit other plans; each finds its code by symbol name, and a later pass like host/48 p11 rewrites them if Softov wants it.
- **Watch out for:** line numbers are at `b4f1a4b` and each task moves the ones after it; find code by symbol name. A `let` in the closure is never copied off the context. A misplaced comment moves with the declaration directly below it and is not fixed here.

## Final verification checklist

- [ ] Tasks 01 to 08 done.
- [ ] `wc -l packages/agent-claude/src/session.ts` is under 1,000, and no file under `packages/agent-claude/src/session/` is over 700.
- [ ] `index.ts`, `claude.ts`, `probe.ts` and every test still import from `./session.js` or `../src/session.js` unchanged.
- [ ] `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm exec vitest run packages/agent-claude` pass.
- [ ] The pure-move check over the whole plan finds only imports, exports and context wiring.
- [ ] `plans/index.md` updated.
