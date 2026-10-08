---
title: session.ts is split into one file per area
domain: acp
status: built
priority: high
created: 2026-10-04
revalidated: 2026-10-04
requires:
  - plans/host/52-deleting-a-session-deletes-the-backends-copy/plan.md
refs:
  - "[code://packages/agent-acp/src/session.ts#L213-L2105](../../../../packages/agent-acp/src/session.ts#L213-L2105) - `acpSession`, one closure of about 1,900 lines holding every area below"
  - "[code://packages/agent-acp/src/session.ts#L66-L204](../../../../packages/agent-acp/src/session.ts#L66-L204) - the module-level constants and pure helpers: `bag`, `UNTITLED`, `NOT_AN_ANSWER`, `advertised`, `inline`, `referencing`, `CLOSE_GRACE_MS`, `HOST_TOOLS`, `serversFor`, `AUTH_REQUIRED`"
  - "[code://packages/agent-acp/src/session.ts#L255-L372](../../../../packages/agent-acp/src/session.ts#L255-L372) - the session's state, 31 `let`s and `const`s with their comments, read and written across every area"
  - "[code://packages/agent-acp/src/session.ts#L1720-L2105](../../../../packages/agent-acp/src/session.ts#L1720-L2105) - the returned `Session`, whose `models`, `confirm`, `ran`, `queue`, `unqueue`, `reorder` and `setConfig` belong to areas of their own"
  - "[code://packages/agent-acp/src/index.ts#L18](../../../../packages/agent-acp/src/index.ts#L18) - the package entry re-exports `acpSession` from `./session.js`"
  - "[code://packages/agent-acp/src/agent.ts#L17](../../../../packages/agent-acp/src/agent.ts#L17) - the agent imports `acpSession` from `./session.js`"
  - "[code://packages/sdk/src/host/context.ts](../../../../packages/sdk/src/host/context.ts) - the pattern this split copies: one context type that extends every area's interface, with the shared state as commented fields"
  - "[code://packages/sdk/src/host/relay.ts](../../../../packages/sdk/src/host/relay.ts) - an area's shape: an exported interface and a `create<Area>(ctx)` factory that returns it"
---

## Goal

`packages/agent-acp/src/session.ts` is 2,105 lines, almost all of it one `acpSession(options, start)` closure.
Softov, 2026-10-04: no file over 1,500 lines, and 1,000 is already too many; files of roughly 300 to 700 lines are the aim.
After this plan each area of an ACP session is its own file under `packages/agent-acp/src/session/`, and `session.ts` only builds the shared state and composes the areas into the returned `Session`.
Nothing a client, the host or a test sees changes: `acpSession` keeps its name, its signature and its import path, and every task is a move with no behaviour change.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.
Line numbers are at `b4f1a4b`; host/52 lands before this plan and its task 03 edits `agent.ts` and `catalog.ts`, not `session.ts`, but every task still finds its code by symbol name first.

### Searches performed

- Read `session.ts` in full and mapped every declaration inside `acpSession` to the areas in *Proposed architecture*.
- Per `let`, every reader and writer, to find which state crosses areas and which one area alone holds; the result is in *State flow*.
- `rg -n "session\.js'" packages/agent-acp` - `src/index.ts:18` and `src/agent.ts:17` import `acpSession`; nothing else imports the file.
- `rg -n "src/session|session\.ts" packages/agent-acp/test` - no test imports or reads `session.ts`; the eleven test files drive the bridge through `acpAgent` and the scripted fixture server.
- `cat packages/agent-acp/tsconfig.json` - `include` is `src/**/*.ts`, so a folder under `src/` builds without a change.
- `rg -l "code://packages/agent-acp/src/session.ts" .project/plans` - nine open plans cite the file by line: container/04, container/05 p1, container/05 p2, host/43 p2, host/43 p4, host/47 p1, host/47 p3, host/50, plugin/18; and `acp/00-acp.md` does in *What stays*.

### Runtime path

```
Agent.create(start) -> acpSession(options, start) -> SessionContext built once
  -> createConfig, createHandlers, createOpening, createTurn, createQueue assigned onto it
  -> the returned Session, whose members read the context
```

### Gaps

- `acpSession` declares its shared state as `let`s inside the closure, so no other file can reach them today.
- The areas call each other in a cycle (`finish` calls `startNext`, which calls `begin`, which calls `run`, which calls `finish`), so no order of files lets one import another's functions directly.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| No file over 1,500 lines; 1,000 is already too many | Softov, 2026-10-04 | every task |
| Files of roughly 300 to 700 lines, and `session.ts` keeps only what composes the areas, under 1,000 lines | Softov, 2026-10-04 | 06 |
| Every task is a pure move: no behaviour change, no rewritten logic, comments move with their code and none is added about the move | Softov, 2026-10-04 | every task |
| `acpSession`, its signature and the `./session.js` path are unchanged; `index.ts` and `agent.ts` are not touched | [code://packages/agent-acp/src/index.ts#L18](../../../../packages/agent-acp/src/index.ts#L18) and [code://packages/agent-acp/src/agent.ts#L17](../../../../packages/agent-acp/src/agent.ts#L17) | every task |
| The plan runs after host/52 merges, because that build edits `packages/agent-acp` now | the request, 2026-10-04 | all |
| The split files go in a folder, `packages/agent-acp/src/session/`, beside `session.ts` | (defaulted: the way `packages/sdk/src/host/` sits beside `host.ts`, whose folder Softov chose for host/48; a flat `src/` with six more files is the other way) | 01 |
| One `SessionContext`, a type in `session/context.ts` with no logic, built once in `acpSession` and handed to every area's factory; it extends each area's interface; a `let` that crosses files is a field on it, read and written as `ctx.<name>` where it is used | mirrors host/48's "One HostContext", Softov, 2026-10-03, [code://packages/sdk/src/host/context.ts](../../../../packages/sdk/src/host/context.ts) | 01 to 06 |
| Each area exports an interface and a `create<Area>(ctx: SessionContext)` factory, and `acpSession` assigns it onto the context (`Object.assign(ctx, createConfig(ctx))`) | mirrors [code://packages/sdk/src/host/relay.ts](../../../../packages/sdk/src/host/relay.ts) | 02 to 06 |
| A shared field's comment moves to the field in `SessionContext`, where every file reads it; the initializer in `acpSession` carries none | (defaulted: the comment documents the declaration, and the declaration is now the field) | 01 |
| A `let` one area alone reads and writes moves into that area's factory as a `let`, with its comment: `offers` and `listedModels` to config, `endpoint`, `asked`, `extras` and `signIns` to opening; `activity`, `modified` and `draft` stay in `session.ts` | (defaulted: a field nobody else reads would widen the context for nothing) | 02, 04 |
| A `Session` member that belongs to an area moves as `const <name>: Session['<name>'] = <the body unchanged>` on that area's interface, and the returned object in `session.ts` names it in today's place (`models: ctx.models`), so the member order is unchanged | (defaulted: the smallest wiring that keeps the returned object whole in one place) | 02, 03, 06 |

## Proposed architecture

A folder `packages/agent-acp/src/session/` beside `session.ts`.
Each area file exports an interface and a factory `create<Area>(ctx: SessionContext)` that returns it, and `acpSession` assigns the result onto `ctx`.
Inside a factory, a value never reassigned (`options`, `start`, `provider`, `emit`, `where`, `inside`, `settings`, `turns`, `seeds`, `replay`, `queued`, `permissions`, `terminals`, and the funnel `touch`, `doing`, `status`) may be taken off `ctx` once at the top; a reassigned field and every function of another area are read as `ctx.<name>` where they are used, so the order the areas are built in does not matter and nothing is frozen at construction.
That `ctx.` prefix is the only edit a moved line gets besides its indentation.
A function still in `session.ts` that a moved body calls is put on `ctx` in the same change and declared on `SessionContext`; it moves to its area's interface when its area moves.

| File | What it holds | Moved from `session.ts` | Lines (about) | Task |
| --- | --- | --- | --- | --- |
| `session/context.ts` | `SessionContext`: `options`, `start`, `provider`, `emit`, `where`, `inside`, the funnel (`touch`, `doing`, `status`), the 25 shared fields with their comments, and `extends` each area's interface as it lands | the comments and types of 255-262, 288-306, 317-333, 336-344, 346-347, 350-372 | 130 | 01, then one line per task |
| `session/common.ts` | what every area reads: `bag`, `UNTITLED`, `messageOf` | 66, 68-69, 374 | 10 | 01 |
| `session/config.ts` | the server's modes, config options and models, and the schema drawn from them: `offers`, `listedModels`, `learnModes`, `modelOption`, `modeOption`, `keyOf`, `controlOptions`, `learnOffers`, `learnModels`, `configChanged`, `offersChanged`, `choicesOf`, `optionControl`, `schemaOf`, `chooseModel`, and the members `models` and `setConfig` | 271-287, 400-510, 530-590, 1273-1311, 1724-1737, 1936-2052 | 390 | 02 |
| `session/handlers.ts` | what the server sends this session and what is answered: `commandLeaf`, `receivedUpdate`, `uriOf`, `readTextFile`, `writeTextFile`, `environmentOf`, `openTerminal`, `terminalOf`, `terminalOutput`, `waitForTerminalExit`, `killTerminal`, `releaseTerminal`, `askPermission`, `settlePermissions`, and the member `confirm` | 512-528, 592-927, 1888-1925 | 425 | 03 |
| `session/opening.ts` | the server spawned, signed in and the session opened on it: `advertised`, `HOST_TOOLS`, `serversFor`, `AUTH_REQUIRED`, `endpoint`, `asked`, `toolsServer`, `extras`, `signIns`, `placed`, `signIn`, `signInFailure`, `open` | 90-99, 125-204, 237-253, 307-316, 929-1152 | 365 | 04 |
| `session/turn.ts` | one prompted turn, from opening to its end: `NOT_AN_ANSWER`, `inline`, `referencing`, `openTurn`, `finish`, `stopReasonFor`, `saidUsage`, `attachmentUri`, `named`, `contentOf`, `blocksFor`, `run` | 71-88, 101-114, 1154-1271, 1313-1539 | 405 | 05 |
| `session/queue.ts` | what runs next and the host's own shell turn: `runCommand`, `begin`, `startNext`, and the members `ran`, `queue`, `unqueue`, `reorder` | 1541-1718, 1791-1814, 1840-1879 | 260 | 06 |
| `session.ts` | what stays, below | 1-24, 116-123, 206-235, 334-335, 345, 348-349, 376-398, 1720-1723, 1738-1790, 1816-1838, 1881-1886, 1927-1934, 2054-2105 | 320 | every task |

What stays in `session.ts`: the file's header comment, the imports, `CLOSE_GRACE_MS`, `acpSession`'s head (`provider`, `emit`, `where`, `directories`, `inside`), the `ctx` literal that initializes every shared field, the local `activity`, `modified` and `draft`, the funnel (`touch`, `doing`, `status`), the five `Object.assign` calls, and the returned `Session` with `uri`, `chatUri`, `agentId`, `customizations`, `allTurns`, `status`, `activity`, `title`, `setTitle`, `modifiedAt`, `workingDirectories`, `sessionState`, `chatState`, `begin`, `cancel`, `setDraft`, `answer`, the three refusals, `settings` and `close`.

The pure-move check, run after each task against the commit before it:

```
git add -N packages/agent-acp/src/session
norm() { grep "^$1[^$1]" | sed -E "s/^\\$1[[:space:]]*//; s/\bctx\.//g" | sort; }
comm -23 <(git diff -U0 HEAD -- packages/agent-acp/src | norm -) <(git diff -U0 HEAD -- packages/agent-acp/src | norm +)
```

It prints the removed lines that reappear nowhere once indentation and the `ctx.` prefix are set aside; every line it prints is an import, an export or wiring (a `let` that became a field, a member that became `ctx.<name>`, an `Object.assign`), and the task's *Resume* says so.

- **Data flow** - unchanged: a turn reaches `begin`, now in `session/queue.ts`, which reaches `run` in `session/turn.ts`, which opens the server through `open` in `session/opening.ts`.
- **Event flow** - unchanged: the server's notifications and requests reach the handlers in `session/handlers.ts`, which `open` hands to `connectAcp`.
- **State flow** - shared, on `SessionContext`: `settings`, `turns`, `seeds`, `commands`, `modes`, `active`, `mapping`, `cumulative`, `live`, `acpSessionId`, `closes`, `takes`, `replay`, `loading`, `opening`, `cancelRequested`, `closed`, `failed`, `title`, `renamed`, `record`, `watchedTurn`, `queued`, `permissions`, `terminals`; of these, `commands`, `modes`, `active`, `mapping`, `cumulative`, `live`, `acpSessionId`, `closes`, `takes`, `loading`, `opening`, `cancelRequested`, `closed`, `failed`, `title`, `renamed`, `record` and `watchedTurn` are reassigned and so are always read as `ctx.<name>`; private to one area: `offers`, `listedModels` (config), `endpoint`, `asked`, `extras`, `signIns` (opening); local to `session.ts`: `activity`, `modified`, `draft`.
- **Layer responsibilities** - agent-acp only; no other package changes.
- **Source-of-truth files** - [`code://packages/agent-acp/src/session.ts`](../../../../packages/agent-acp/src/session.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The session's shared state is one context](task-01-the-shared-state-is-one-context.md) | done | - |
| [02 - Config, modes and models are one file](task-02-config-and-models.md) | done | 01 |
| [03 - What the server sends the session is one file](task-03-what-the-server-sends.md) | done | 02 |
| [04 - Spawning, signing in and opening are one file](task-04-opening.md) | done | 03 |
| [05 - A prompted turn is one file](task-05-a-prompted-turn.md) | done | 04 |
| [06 - The queue and the shell turn are one file](task-06-the-queue-and-the-shell-turn.md) | done | 05 |

Every task edits `session.ts`, so they land in order on one branch; the order puts each area after the ones it calls where the cycle allows, which leaves two temporary wires (`open` for task 02, `startNext` for task 05).

## Risks and tradeoffs

- A reassigned field taken off `ctx` into a local at the top of a factory would freeze it at construction and break silently; every reassigned field in *State flow* is read as `ctx.<name>` where it is used.
- A factory that took another area's function off `ctx` at construction would hold `undefined` for any area built after it; another area's function is always called as `ctx.<name>`, and nothing in `acpSession` runs at construction today (`toolsServer` and `open` are both lazy), so the build order carries no statement order to keep.
- Names that become context members are shadowed in two moved bodies: `runCommand`'s parameter `run` and `run`'s local `signIn`; both are read as `ctx.run` and `ctx.signInFailure` elsewhere, so the shadowing is harmless and is left as it is, because renaming is rewriting.
- One context is one wide object any area file can reach into; the type in `session/context.ts` is where its reach is read.
- A file under `session/` never imports `../session.js`, which would be a cycle; what an area needs from `session.ts` comes through `ctx`, and the constants it needs move with it or to `session/common.ts`.
- The nine open plans and `acp/00-acp.md` that cite `session.ts` by line go stale; they find code by symbol name, and rewriting their refs is a later change of its own, as host/48 p11 was, not part of this plan.
- The pure-move check sets aside indentation and `ctx.` only, so a changed word anywhere shows up as a printed line.
- No test in `packages/agent-acp/test` queues, unqueues or reorders a message, or runs a session in a machine, so `queue`, `unqueue`, `reorder` and `placed` are guarded by the type check and the pure-move check alone.

## Resume state

- **Done so far:** all six tasks. `packages/agent-acp/src/session.ts` is 321 lines (was 2,105) and holds only the header comment, the imports, `CLOSE_GRACE_MS`, `acpSession`'s head, the `ctx` literal, `activity`, `modified` and `draft`, the funnel, the five `Object.assign` calls and the returned `Session`, whose area members are named as `ctx.<name>` in today's places. Beside it, `src/session/` holds `common.ts` (9), `context.ts` (123), `config.ts` (398), `handlers.ts` (452), `opening.ts` (372), `turn.ts` (408) and `queue.ts` (264). Each task's *Resume* records what it moved, its gates and its departures.
- **Next action:** none. Reviewed and closed on 2026-10-07.
- **Requires:** host/52 merged, which it had.
- **Open questions:** none open. The one this plan asked about - the folder `src/session/` rather than six files flat in `src/` - was answered by the decisions table and built as the folder. Two departures from the plan's wording, both recorded in the tasks' *Resume* and neither a fork: the `ctx` literal is cast `as unknown as SessionContext` (a plain cast is checked before the areas are assigned and rejects the literal), and `setConfig` and `ran` are typed `NonNullable<Session['<name>']>` because they are optional on `Session`.
- **Watch out for:** the nine open plans and `acp/00-acp.md` that cite `session.ts` by line are stale, as *Risks and tradeoffs* says; find code by symbol. `plans/index.md` was not edited, by the request that ran this plan.

## Final verification checklist

- [x] `wc -l packages/agent-acp/src/session.ts packages/agent-acp/src/session/*.ts`: `session.ts` 321, under 1,000; the largest area file is `handlers.ts` at 452, under 700.
- [x] `pnpm exec tsc --noEmit`, `pnpm boundary` and `pnpm exec vitest run packages/agent-acp` pass after every task, and `pnpm test` passes at the end.
- [x] The pure-move check prints only imports, exports and wiring after every task: 29, 31, 38, 43, 50 and 55 lines across the six tasks, each recorded in its *Resume*.
- [x] `packages/agent-acp/src/index.ts` and `packages/agent-acp/src/agent.ts` are unchanged.
- [ ] `plans/index.md` updated - not done, by the request that ran this plan.
