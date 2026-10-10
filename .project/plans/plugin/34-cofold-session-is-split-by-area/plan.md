---
title: The cofold session is split into one file per area, and session.ts composes them
domain: plugin
status: built
priority: high
created: 2026-10-04
revalidated: 2026-10-04
requires: []
refs:
  - "[code://packages/agent-cofold/src/session.ts#L167-L1558](../../../../packages/agent-cofold/src/session.ts#L167-L1558) - `cofoldSession`, one closure of about 1,390 lines holding every area below"
  - "[code://packages/agent-cofold/src/session.ts#L37-L158](../../../../packages/agent-cofold/src/session.ts#L37-L158) - the module-level helpers: `insideDirectory`, `EDITS`, `editPathOf`, `modeOf`, `AGENT_ID`, `DEFAULT_INSTRUCTIONS`, `bag`, `str`, `DECLINED`, `answersOf`, `sessionIdOf`, `WaitingCall`"
  - "[code://packages/agent-cofold/src/session.ts#L180-L406](../../../../packages/agent-cofold/src/session.ts#L180-L406) - the closure's state: four constants, seven shared maps and lists, sixteen `let`s, and `touch`"
  - "[code://packages/agent-cofold/src/session.ts#L1198-L1557](../../../../packages/agent-cofold/src/session.ts#L1198-L1557) - the `Session` object returned, 360 lines of methods"
  - "[code://packages/agent-cofold/src/index.ts#L30](../../../../packages/agent-cofold/src/index.ts#L30) - the package entry re-exports `cofoldSession` and `sessionIdOf` from `./session.js`"
  - "[code://packages/agent-cofold/src/agent.ts#L24](../../../../packages/agent-cofold/src/agent.ts#L24) - the one caller of `cofoldSession`, at line 675"
  - "[code://packages/agent-cofold/src/transcript.ts#L43-L44](../../../../packages/agent-cofold/src/transcript.ts#L43-L44) - its own copy of `bag` and `str`, the way this package shares the two one-liners today"
  - "[code://packages/sdk/src/host/context.ts](../../../../packages/sdk/src/host/context.ts) - `HostContext`, the shape `SessionContext` copies: one typed object, each area's interface extended into it"
  - "[code://packages/sdk/src/host.ts#L707-L735](../../../../packages/sdk/src/host.ts#L707-L735) - `const ctx = { ... }` and the `Object.assign(ctx, create<Area>(ctx))` calls, the wiring `cofoldSession` copies"
---

## Goal

`packages/agent-cofold/src/session.ts` is 1,558 lines, almost all of it one `cofoldSession(...)` closure.
Softov, 2026-10-04, set the bar: no file over 1,500 lines, 1,000 is already too many, and files of roughly 300 to 700 lines are the aim.
After this plan each area of a cofold session is a file of its own under `packages/agent-cofold/src/`, and `session.ts` holds the session's state, builds the areas and returns the `Session` they make up.
Nothing a host, a client or a test sees changes: `cofoldSession` and `sessionIdOf` keep their names and their import path, and every task is a move with no behaviour change.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.
Line numbers are at `b4f1a4b`; each task after the first moves them, so every task finds its code by symbol name first.

### Searches performed

- `grep -nE "^  (const|let|function|interface) " packages/agent-cofold/src/session.ts` - 59 declarations directly inside `cofoldSession`, 16 of them `let`, mapped to the areas in *Proposed architecture*.
- Read the whole file, `L1-L1558`, and traced which `let` each function reads or writes; the result is the *Shared mutable state* table below.
- `rg -n "session\.js|sessionIdOf|cofoldSession" packages` - `index.ts:30` re-exports both names, `agent.ts:24` imports `cofoldSession`, and `test/agent-cofold-turn.test.ts:13` reaches `sessionIdOf` through `../src/index.js`; nothing imports `src/session.js` directly from a test.
- `rg -n "^const (bag|str)" packages/agent-cofold/src` - `transcript.ts:43-44` keeps its own copy of both.
- `rg -ln "code://packages/agent-cofold/src/session.ts" .project/plans` - three open plans cite lines of the file: plugin/22, host/43 p2 task 04 and host/50 task 01.
- `ls packages/agent-cofold/test` - 13 test files, all driving the session through `cofoldAgent` or a host, none reading the source as text.

### Runtime path

```
createHost -> cofoldAgent().open (agent.ts:675) -> cofoldSession -> Session.begin -> beginTurn -> startTurn -> agentOf -> run() -> read -> apply -> mapTurn -> start.emit
```

### Gaps

- `cofoldSession` keeps its state in sixteen `let`s inside the closure, so no other file can read or write them today.
- Shadowed names that a move must not "fix": `start` inside `beginTurn` (936), `waiting` as a local in `rejoin` (664), `route` (704), `stop` (757) and `beginTurn` (947), `pending` as a local in the opening block (1085), `resolve` in `owePause` (309) over `node:path`'s, and `run` as `runCommand`'s parameter (1115) over cofold's.
- The opening block at 1078-1097 runs while the session is built and calls `cut` and `reopen`, so it has to stay in `session.ts` after every factory it reaches.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| No file over 1,500 lines; 1,000 is already too many | Softov, 2026-10-04 | every task |
| Files of roughly 300 to 700 lines, one per area, with `session.ts` keeping only what composes them | Softov, 2026-10-04 | 02 to 05 |
| Every task is a pure move: no behaviour change, no rewritten logic, comments move with their code and none is added about the move | Softov, 2026-10-04 | every task |
| `cofoldSession` and `sessionIdOf` stay exported from `session.ts` | [code://packages/agent-cofold/src/index.ts#L30](../../../../packages/agent-cofold/src/index.ts#L30) and [code://packages/agent-cofold/src/agent.ts#L24](../../../../packages/agent-cofold/src/agent.ts#L24) | every task |
| The new files sit flat in `packages/agent-cofold/src/`, beside the nine there today | the request, 2026-10-04 | 01 to 05 |
| One `SessionContext` in `context.ts`, types only, built once in `cofoldSession`; a `let` that crosses files is a field read as `ctx.<name>` where it is used, and each area's factory is assigned onto it with `Object.assign(ctx, create<Area>(ctx))` | (defaulted: mirrors Softov's "One HostContext" for host/48, 2026-10-03, so the two splits read alike) | 01 to 05 |
| An area that owns `Session` methods returns them from the same factory as `methods`, typed `Pick<Session, ...>` so the arrows keep their parameter types; `session.ts` takes them off with `const { methods, ...offers } = create<Area>(ctx)`, assigns the offers onto `ctx` and spreads the methods into the returned object | [code://packages/sdk/src/host/resourcemethods.ts#L63](../../../../packages/sdk/src/host/resourcemethods.ts#L63), the `{ storeFor, methods }` shape host/48 p9 built, because each table calls functions private to its file | 02, 04, 05 |
| A file that reads `bag` or `str` keeps its own copy, as `transcript.ts` does | [code://packages/agent-cofold/src/transcript.ts#L43-L44](../../../../packages/agent-cofold/src/transcript.ts#L43-L44) | 02 to 05 |
| Each task leaves `pnpm exec tsc --noEmit`, `pnpm boundary` and `pnpm exec vitest run packages/agent-cofold` green, passes the pure-move check, and records `wc -l` of every file it touched | the request, 2026-10-04 | every task |

## Proposed architecture

Each area file exports an interface of what it offers to the other areas and one factory `create<Area>(ctx: SessionContext)` that returns it; a file that owns `Session` methods returns them beside the offers as `methods`.
Inside a factory, a constant or a shared map may be taken off `ctx` once at the top; a `let` field and a function another area offers are read as `ctx.<name>` where they are used, so the order the areas are built in does not matter and no value is copied at construction.
That `ctx.` prefix is the only edit a moved line gets besides its indentation.

| File | What it holds, from `session.ts` at `b4f1a4b` | Lines moved | Estimated size | Task |
| --- | --- | --- | --- | --- |
| `context.ts` | `SessionContext`: the shared constants and maps as bare fields, `touch`, and fifteen of the sixteen `let`s as fields, each with the doc comment it has today (232-239, 245-249, 288-305, 319-322, 326-345, 356); later tasks add `extends` for each area's interface | 0 code, about 60 comment | 100 | 01 |
| `turnagent.ts` | the agent a turn runs on and the tools it is handed: `insideDirectory` 37-51, `EDITS` and `editPathOf` 53-70, `modeOf` 72-78, `AGENT_ID` 80-88 (exported), `DEFAULT_INSTRUCTIONS` 90-91, `WaitingCall` 142-157, `announceEdit` and `settleEdit` 261-279, `waiting` 371-381, `releaseCalls` 383-390, `relay` 392-404, `instructionsOf` 408-419, `agentOf` 421-476; methods `toolCallOwner`, `completeToolCall`, `clientGone` 1475-1528 | 240 | 275 | 02 |
| `runs.ts` | a run read to its end, and a resumed, forked or rewound conversation reopened: `cut` 206-231, `doing` 478-484, `status` 486-493, `settleTurn` 495-522, `rememberPoints` 524-536, `apply` 538-617, `read` 619-653, `reopen` 990-1076 | 285 | 320 | 03 |
| `pauses.ts` | a run waiting on a person, the answer that rejoins it and the stop that ends it: `DECLINED` 96-97, `answersOf` 99-129, `owePause` and `payPause` 306-318, `rejoin` 655-672, `route` 674-710, `stopNow` and `stop` 712-763; methods `confirm` and `answer` 1386-1458 | 225 | 265 | 04 |
| `turns.ts` | a turn opened, started, failed or queued, and a shell command run as a turn: `openTurn` 765-840, `startTurn` 842-877, `refusal` 879-894, `failTurn` 896-918, `beginTurn` 920-953, `startNext` 955-988, `runCommand` 1099-1196; methods `ran` 1277-1299, `queue` 1333-1351, `unqueue` 1353-1359, `reorder` 1361-1377 | 385 | 425 | 05 |
| `session.ts` | what composes them, below | - | 345 | 01 to 05 |

What stays in `session.ts`: the header comment 1-19, the imports, `sessionIdOf` 131-140, `cofoldSession`'s doc comment and signature 159-179, `provider`, `sessionId`, `where` and `store` 180-204, the shared maps and lists with their comments (`turns` 242-243, `editing` 251-259, `pending` 280-287, `points` 346-355, `queued` 358-359, `settings` 362-369), `draft` 360-361 (read only by `chatState` and `setDraft`), `touch` 406, the `ctx` literal and the factory calls, the opening block 1078-1097, and the returned `Session` with the methods no area owns: `models`, `agentId`, `forkPoint`, `endPoint`, `customizations`, `allTurns`, `status`, `activity`, `title`, `modifiedAt`, `workingDirectories`, `sessionState`, `chatState`, `begin`, `cancel`, `steer`, `setDraft`, `setTools`, `setConfig`, `setCustomizationEnabled`, `startMcpServer`, `stopMcpServer`, `settings`, `close`.
`catalogue` stays a parameter only `models` reads.

### Shared mutable state

Every `let` below is read or written in more than one of the new files, so each becomes a field on `SessionContext` and every reader and writer uses `ctx.<name>`.

| `let` | Line | Read or written in |
| --- | --- | --- |
| `offered` | 240 | `turnagent.ts` (`agentOf`), `turns.ts` (`openTurn`), `runs.ts` (`reopen`), `session.ts` (`setTools`) |
| `active` | 244 | every area and `session.ts` |
| `handle` | 246 | `runs.ts`, `pauses.ts`, `turns.ts`, `session.ts` (`steer`) |
| `liveAgent` | 248 | `runs.ts`, `pauses.ts`, `turns.ts` |
| `activeMapping` | 250 | `runs.ts`, `pauses.ts`, `turns.ts` |
| `paused` | 295 | `runs.ts`, `pauses.ts` |
| `pausing` | 305 | `pauses.ts` (`owePause`, `payPause`, `route`, `stopNow`) |
| `cancelRequested` | 320 | `runs.ts`, `turns.ts`, `session.ts` (`cancel`) |
| `failed` | 322 | `runs.ts`, `turns.ts` |
| `title` | 323 | `turns.ts`, `session.ts` |
| `modified` | 324 | `session.ts` (`touch`, `modifiedAt`, `chatState`) |
| `closed` | 325 | `runs.ts`, `turns.ts`, `session.ts` |
| `opening` | 336 | `pauses.ts`, `turns.ts`, `session.ts` |
| `refused` | 345 | `turns.ts`, `session.ts` |
| `activity` | 357 | `runs.ts` (`doing`), `session.ts` |

`pausing` is written only inside `pauses.ts`, and `modified` only inside `session.ts`; both still go on the context with the rest, because task 01 moves every `let` at once and a later task should not have to reopen it.
`draft` is the one `let` that stays a local of `cofoldSession`.
The maps and lists (`turns`, `editing`, `pending`, `points`, `queued`, `settings`) are never reassigned, so they are put on the context by shorthand and keep their declarations, and their comments, in `session.ts`; `waiting` is read only by `turnagent.ts` and moves there whole.

### The pure-move check

```
git add -N packages/agent-cofold/src
diff <(git diff -U0 -- packages/agent-cofold/src | grep -E '^-[^-]' | sed -E 's/^-[[:space:]]*//; s/ctx\.//g' | sort) \
     <(git diff -U0 -- packages/agent-cofold/src | grep -E '^\+[^+]' | sed -E 's/^\+[[:space:]]*//; s/ctx\.//g' | sort)
```

A line only on the `<` side is code that was removed and not put back, and there must be none apart from the `let` declarations task 01 turns into fields.
A line only on the `>` side is wiring: imports, a factory's signature, destructuring and return, an interface, a `SessionContext` field, a spread, a `bag` or `str` copy; the task's *Resume* records how many there were.

- **Data flow** - unchanged: the host calls a `Session` method, which is the same function in a different file.
- **State flow** - the state is created in `cofoldSession` and handed to every factory through `ctx`; nothing is copied off it at construction.
- **Layer responsibilities** - `@ahpd/agent-cofold` only; no other package changes.
- **Source-of-truth files** - [`code://packages/agent-cofold/src/session.ts`](../../../../packages/agent-cofold/src/session.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The session's mutable state is one context](task-01-the-session-state-is-one-context.md) | done | - |
| [02 - The agent a turn runs on is one file](task-02-the-turn-agent-is-one-file.md) | done | 01 |
| [03 - Reading and reopening a run is one file](task-03-reading-a-run-is-one-file.md) | done | 02 |
| [04 - A paused run's answers and stops are one file](task-04-a-paused-runs-answers-are-one-file.md) | done | 03 |
| [05 - Opening a turn and the queue are one file](task-05-opening-a-turn-and-the-queue-are-one-file.md) | done | 04 |

## Risks and tradeoffs

- plugin/22 (a cofold write lands where it was allowed) also edits `agent-cofold`: its refs name `insideDirectory` at `session.ts#L37-L51` and the capabilities call at `#L446`, both of which move to `turnagent.ts` in task 02; whichever lands second rebases onto the other and finds the code by name.
- host/43 p2 task 04 cites `session.ts#L1239` (`sessionState`, which stays) and host/50 task 01 cites `session.ts#L188-L194` (`sessionId`, which stays); their line numbers shift, and this plan does not edit them.
- Every task edits `session.ts` and `context.ts`, so the five land in order on one branch; `turns.ts` and `runs.ts` import `AGENT_ID` from `turnagent.ts`, which is why 02 comes before them.
- A `let` read through `ctx` and copied into a local at a factory's top would freeze it, and nothing would fail to compile; every `let` is read as `ctx.<name>` at the point of use.
- Spreading a method table moves its keys within the returned object; nothing in the repository enumerates a `Session`'s keys, so the order has no effect, and each table is spread where its first method sits today.
- `SessionContext` is one wide object any area can reach into; the type in `context.ts` is where its reach is read.
- `context.ts` (about 100 lines) is under the 300 Softov aims for, because it holds types only; folding it into an area would make every other area import that one.

## Resume state

- **Done so far:** all five tasks. `context.ts` holds `SessionContext` (97 lines) and `session.ts` builds one `ctx` after `touch` and composes the areas into it: `turnagent.ts` (284) the agent a turn runs on, `runs.ts` (318) the cut, the read and the reopen, `pauses.ts` (259) the answers and the stop, `turns.ts` (418) the turn that opens, the queue and the shell command. `session.ts` is 370 lines and holds only what composes them.
- **Next action:** none. Every task was reviewed against main on 2026-10-10 and is `done`; the work is in `ac4c1ab`.
- **Departures from the plan so far:** task 03 needed `owePause`, `payPause` and `startNext` on the context before their own tasks land, so it put the three on `SessionContext` as plain function fields and `session.ts` assigned them onto `ctx`; tasks 04 and 05 lifted them out as the plan describes, and none is left. That fork is the plan's, not the build's, and should be confirmed - see task 03's *Resume*. Task 04's file list names a `str` copy in `pauses.ts` that nothing there reads, so none was added. The pure-move check ran from a scratch script, because `git add -N` and process substitution are unavailable in this shell; that changes how the check is invoked and nothing about what it compares. Task 05's four methods keep their parameter types as `Session['ran']` and the rest rather than by being spelled out, which the file list's `Pick<Session, ...>` allows and a shorter spelling does not break. One blemish the build could not fix: the five new files end without a trailing newline, where every file already in `src/` ends with one, because the editor tools in this shell trim it and the shell was not allowed to append it. `printf '\n' >> packages/agent-cofold/src/{context,turnagent,runs,pauses,turns}.ts` settles it; nothing reads the difference and `tsc` does not care.
- **Open questions:**
  1. Who rewrites the session.ts refs in plugin/22, host/43 p2 and host/50 once this is built - proposed: the same follow-up host/48 p11 was, outside this plan's five tasks.
- **Watch out for:** line numbers are at `b4f1a4b` and move after each task, so find code by symbol name; the shadowed locals named in *Gaps* stay shadowed; a `let` is never copied off the context.

## Final verification checklist

- [x] `wc -l packages/agent-cofold/src/*.ts` shows no file over 700 lines and `session.ts` under 400. `session.ts` 370, `turns.ts` 418, `runs.ts` 318, `turnagent.ts` 284, `pauses.ts` 259, `context.ts` 97. `agent.ts` is 703 and was already there; no file this plan made is over 700.
- [x] `packages/agent-cofold/src/index.ts` is unchanged.
- [x] `pnpm exec tsc --noEmit`, `pnpm boundary` and `pnpm exec vitest run packages/agent-cofold` pass, and so does the whole `pnpm test` - 207 files, 2867 tests.
- [x] The pure-move check, run over the whole plan's diff, shows only wiring on the `>` side: 1224 removed and 1459 added, and the 31 lines with no counterpart are the fifteen `let`s, four method signatures now typed `Session['ran']` and the rest, `const AGENT_ID = 'cofold';`, six redrawn import lines and five lines the `ctx.` prefix respelled.
- [x] `plans/index.md` updated.
