---
title: host.ts is split into one file per area, and the URI routing and the grant tables are files of their own
domain: host
status: active
priority: high
created: 2026-10-03
revalidated: 2026-10-04
requires:
  - plans/plugin/29-a-tool-call-says-when-it-ran/plan.md
refs:
  - "[code://packages/sdk/src/host.ts#L632-L11657](../../../../packages/sdk/src/host.ts#L632-L11657) - `createHost`, one closure of about 11,000 lines holding every area below"
  - "[code://packages/sdk/src/host.ts#L156-L630](../../../../packages/sdk/src/host.ts#L156-L630) - the module-level tables and pure helpers: `NEEDS`, `UNGATED`, `dispatchNeeds`, `ACTION_HOMES`, `spaceOf`, `baseOf`, `Claiming`, `schemeOf`, `GATE`"
  - "[code://packages/sdk/src/host.ts#L7349-L11656](../../../../packages/sdk/src/host.ts#L7349-L11656) - `accept`, the per-connection half: the gate, the method table (`handlers`, 7762-9811) and `applyDispatch` (9876-11478)"
  - "[code://packages/sdk/src/index.ts#L25](../../../../packages/sdk/src/index.ts#L25) - the package entry re-exports `createHost`, `HOST_CLOSE_WAIT_MS`, `ROOT` and `refusalReason` from `./host.js`"
  - "[code://packages/sdk/src/host.ts#L11658](../../../../packages/sdk/src/host.ts#L11658) - `ROOT`, `isRootChannel` and `Summary` exported at the end"
  - "[code://packages/sdk/test/users-gate.test.ts#L135-L163](../../../../packages/sdk/test/users-gate.test.ts#L135-L163) - reads `host.ts` as text and finds the handlers by an 8-space indent, so it has to follow the handlers when they move"
  - "[code://packages/sdk/src/calllinks.ts#L12-L47](../../../../packages/sdk/src/calllinks.ts#L12-L47) - a piece of host state already moved out: `createCallLinks(): CallLinks`, an interface and a factory"
  - "[code://packages/sdk/src/types/host.ts#L427-L431](../../../../packages/sdk/src/types/host.ts#L427-L431) - the pattern the seam copies: every host tool is handed one context object (`HostTool.run(input, at: ToolCall)`)"
  - "[code://packages/server/src/commands/registry.ts](../../../../packages/server/src/commands/registry.ts) - the one folder of per-area files under one owner in this repository, beside `packages/sdk/src/types/`"
---

## Goal

`packages/sdk/src/host.ts` is 11,658 lines, almost all of it one `createHost(options)` closure with about 265 inner functions.
Softov, 2026-10-03: "this file packages/sdk/src/host.ts is a good files.. split in more files... please.. organize the url matching routing. etc NEEDS in another file."
After this plan each area of the host is its own file, the grant tables and the URI routing first among them, and `host.ts` is the entry that wires them together.
Nothing a client, a plugin or a test sees changes: every export keeps its name and its import path, and every child is a move with no behaviour change.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.
Line numbers are at `1eb8c8f`; plugin/29 lands before this plan and shifts them, so every child finds its code by symbol name first.

### Searches performed

- `grep -nE "^  (const|let|function|interface|type) " packages/sdk/src/host.ts` - 291 declarations directly inside `createHost`, mapped to the areas in *Proposed architecture*.
- `grep -nE "^      (const|let) " packages/sdk/src/host.ts` past line 7349 - inside `accept`: `tokensFor`, `expire`, `storeFor`, `capabilityFor`, `ownRecord`, `excusedBy`, `denied`, `admit`, `containers`, `handlers` (47 methods), `applyDispatch`, `notifications`.
- `rg -l "src/host\.js'" packages examples` - 69 files, all tests; they import `createHost` (62), `ROOT` (17), `GATE` (1), `HOST_CLOSE_WAIT_MS` (1).
- `rg -n "host\.ts" packages/sdk/test` - `users-gate.test.ts:142` reads the source; `host-files.test.ts:120` and `:172` use the file only as a file to list and read, which is unaffected.
- `find packages/*/src -mindepth 1 -type d` - `packages/sdk/src/types/`, `packages/server/src/commands/` and `packages/server/src/proxy/`; every other package is flat.
- `rg -l "code://packages/sdk/src/host.ts" .project/plans` - 26 open plan folders cite the file, listed per child and rewritten by p11.

### Gaps

- `createHost` declares its shared state (`claims`, `sessions`, `byChat`, `owners`, `terminals`, `connections`, `kept`, `learned`) and the interfaces for it (`Held`, `LiveSubagent`, `Learned`, `Origin`) inside the closure, so no other file can name them today.
- The handler classification test finds handlers by indentation in one file.
- Statements run while the host is built (`for (const dir_ of browsable())` at 2601, `options.automations?.onChanged` at 2616, the `agent.probe()` loop at 2654, `readStored` at 4397, `options.automations?.onDue` at 7282) must keep their order once the functions they call live in other files.

## Decisions locked in

| What | Source | Plan |
| --- | --- | --- |
| `host.ts` is split by area, with the grant tables and the URI routing in files of their own | Softov, 2026-10-03: "split in more files... please.. organize the url matching routing. etc NEEDS in another file." | p1, p2 |
| Every child is a move: no behaviour change, no renamed exported symbol, comments move with their code and none is added about the move | the request, 2026-10-03 | every child |
| `host.ts` stays the entry: `createHost`, `HOST_CLOSE_WAIT_MS`, `ROOT`, `refusalReason`, `GATE`, `isRootChannel` and `Summary` are still exported from it | [code://packages/sdk/src/index.ts#L25](../../../../packages/sdk/src/index.ts#L25) and the 69 test files that import `../src/host.js` | every child |
| Pure tables and pure functions move first, then each stateful area in a child of its own | the request, 2026-10-03 | p1 first |
| Each child leaves `pnpm exec tsc --noEmit`, `pnpm boundary` and `pnpm test` green, and records `wc -l packages/sdk/src/host.ts` | the request, 2026-10-03 | every child |
| The plan runs after plugin/29 merges and before host/43, host/44 p2, host/44 p3, host/45, host/46 and host/47 | the request, 2026-10-03 | all |
| Open plans that cite `host.ts` have their refs rewritten to the new files once the split is done | the request, 2026-10-03 | p11 |
| `git.ts`, `github.ts` and `worktrees.ts` move to `packages/sdk/src/repo/`, names inside unchanged, every import and the `@ahpd/sdk` exports updated; `changes.ts` stays | Softov, 2026-10-03, asked "git / GitHub / worktrees: where should they live?": "sdk/src/repo now, plugin later" | p3 |
| The split files go in a folder, `packages/sdk/src/host/` | Softov, 2026-10-03, asked "Where do the split files go?": "Folder src/host/" | every child |
| One `HostContext`, a typed object in `host/context.ts` (type only, no logic) holding the shared maps, the funnel (`dispatch`, `broadcast`, `seenBy`, `refuse`) and the options, built once in `createHost` and handed to every area's factory, the way every host tool is handed a `ToolCall`; no per-file deps lists; a `let` that crosses files becomes a field on it | Softov, 2026-10-03, asked "How do the new files reach the host's shared state?": "One HostContext" | p2 to p10 |
| About 29 files, as drafted in *Proposed architecture* | Softov, 2026-10-03, asked "How fine a split?": "~29 files as drafted" | every child |
| `applyDispatch` is two files: `host/actions.ts` with the checks and the host-wide families, `host/chatactions.ts` with the session and chat branches as one function called at one seam | Softov, 2026-10-03, asked "applyDispatch is 1,600 lines of branches. How is it split?": "Two files" | p10 |
| Each area's factory adds the functions it offers to the context (`Object.assign(ctx, createRouting(ctx))`), so a later area reaches an earlier or a later one through `ctx` at call time; the per-connection half is a `ConnectionContext` in the same file, built once in `accept` | (defaulted: one context means one place to reach every area, and `accept`'s state is per connection) | p2 to p10 |
| The handler classification test reads every file that holds handlers | [code://packages/sdk/test/users-gate.test.ts#L142](../../../../packages/sdk/test/users-gate.test.ts#L142) reads one file by indentation, and would pass while seeing none of the moved handlers | p9 |

## Proposed architecture

A folder `packages/sdk/src/host/` beside `host.ts`.
Each stateful file exports a factory `create<Area>(ctx: HostContext)` that returns what the area offers, and `createHost` assigns it onto the context.
Inside a factory, a shared map, an option or a funnel function may be taken off `ctx` once at the top; a `let` field and a function another area offers are read as `ctx.<name>` where they are used, so the order the areas are built in does not matter and no value is copied at construction.
That `ctx.` prefix is the only edit a moved line gets besides its indentation.

| File | What it holds | Lines moved (about) | Child |
| --- | --- | --- | --- |
| `host/context.ts` | `HostContext` and `ConnectionContext`: types only; each child adds the fields of the area it moves | grows with each child | p2 to p10 |
| `host/common.ts` | what every area reads: `need`, `reason`, `CLOSING`, `BANG` | 30 | p1 |
| `host/state.ts` | the interfaces of the shared state: `Held`, `LiveSubagent`, `Learned`, `Origin`, `NameKind`, `Claimed`, and the `Claiming` map | 90 | p1 |
| `host/channels.ts` | URI names with no state: `ROOT`, `isRootChannel`, `AUTOMATIONS`, `MARKS`, `uriOf`, `schemeOf`, `Space`, `spaceOf`, `baseOf`, `ChannelKind`, `URI_KEYS`, `named`, `chatUriFor`, `subagentChatUri`, `toolCallOfSubagentChat`, `WORKER_ACTIONS`, `isAutomations` | 170 | p1 |
| `host/gate.ts` | the grant and method tables: `GREETINGS`, `NEEDS`, `UNGATED`, `dispatchNeeds`, `computerNeeds`, `PER_CONNECTION`, `seesConfig`, `Home`, `ACTION_HOMES`, `HOME_WORDS`, `GATE`, `refusalReason`, and from inside the closure `DECLARED` and `REVERSE` | 290 | p1 |
| `host/routing.ts` | which channel a URI means and how it is spelt back: `spaceHere`, `heldAs`, `names`, `nameOf`, `ownName`, `sessionOfChat`, `sessionFor`, `chatOf`, `meantBy`, `sessionHolding`, `channelKind`, `sessionChannel`, `homeOf`, `spelledFor`, `respell`, `respelledIn`, `spellingOf`, `answeredAs`, `claimable`, `unheld` | 430 | p2 |
| `host/relay.ts` | a URI a client published, routed to that client: `ownId`, `claimsId`, `ownerOf`, `ask`, `clients`, `relayed`, `elsewhere` | 180 | p2 |
| `host/admission.ts` | one connection's gate: `read`, `capabilityFor`, `ownRecord`, `excusedBy`, `denied`, `admit` | 200 | p2 |
| `host/changesets.ts` | a session's changesets: `dirOf`, `catalogueOf`, `changesetAt`, `changesetOf`, `inFlight`, `opKey`, `operationContext`, `operationsOf`, `operationsMoved`, `shown`, `told`, `contentMoved`, `changesetsOf` | 300 | p3 |
| `host/facts.ts` | git and GitHub facts, pull requests, artifacts and the directory watches: `githubFacts`, `metaOf`, `captureBaseline`, `promotePullRequest`, `setArtifacts`, `describes`, `metaMoved`, `toldIn`, `watchedIn`, `refreshWatched`, `startWatchingDir`, `refreshPullRequests`, `recordPullRequest`, `readFacts`, `refreshFacts` | 460 | p3 |
| `host/telemetry.ts` | OTLP and the host's own log: `LOGS`, `TRACES`, `METRICS`, `telling`, `attributed`, `fire`, `log`, `turning`, `calling`, `spanned`, `measured`, `telemetered` | 280 | p4 |
| `host/auth.ts` | what needs signing into and which credentials a backend is lent: `asked`, `asking`, `loginId`, `resourcesOf`, `agentsFor`, `lent`, `advertised`, `metadataFor`, `channelAwaiting` | 165 | p4 |
| `host/owners.ts` | whose work it is and what it is charged to: `charged`, `ownerFor`, `principals`, `principalFor`, `forWhom`, `senders`, `senderOf`, `charge`, `checked`, `scoping`, `settle` | 200 | p4 |
| `host/machines.ts` | the machine a session runs in: `sessionMachines`, `enteredIn`, `inMachine`, `leaveForgotten`, `machineFor`, `admitted`, `placedIn` | 200 | p4 |
| `host/sessionconfig.ts` | a session's config and schema: `SEEDS`, `isolating`, `mergedConfig`, `hostSchema`, `propertyOf`, `published`, `sessionSchema`, `runningSchema`, `seeded`, `contributedDefaults`, `storedConfig`, `mineOf` | 470 | p5 |
| `host/root.ts` | root state and root config: `descriptors`, `rootConfig`, `ROOT_CONFIG_SCHEMA`, `daemonSchema`, `daemonProperties`, `daemonKey`, `restartNeeded`, `advertisedSchemes`, `rootState` | 260 | p5 |
| `host/catalogue.ts` | the session list and its rows: `startedBy`, `chatSummary`, `subagentSummary`, `restoredSubagentSummary`, `statusOf`, `urgency`, `drivingOf`, `modifiedOf`, `activityOf`, `activeSessionsMoved`, `changesOf`, `summaryOf`, `sessionAdded`, `summaryMoved`, `learnModels`, `listing`, `waitingFor`, `readStored` | 530 | p6 |
| `host/history.ts` | sessions that already happened: `history`, `reading`, `subHistory`, `restoredSubagents`, `restoredParentChat`, `linkedTurns`, `titles`, `catalogue`, `past` | 170 | p6 |
| `host/snapshots.ts` | `value` and `snapshotOf`, the state a subscribe answers | 370 | p6 |
| `host/spawn.ts` | a backend's session started and its workers: `absorb`, `unstamped`, `withWorkerUri`, `stampedCalls`, `withSender`, `sendSubagent`, `openSubagent`, `formerChatUri`, `titleOf`, `keepTitle`, `keepProvider`, `spawn` | 650 | p7 |
| `host/lifecycle.ts` | a session moved, restarted, removed and opened, and a message's turn: `removeSession`, `restart`, `moveSession`, `restartChat`, `HOSTS_OWN`, `backendsOwn`, `isolated`, `beginOrRun`, `beginTurn`, `modelIn`, `messageFrom`, `messageAttachments`, `openSession` | 700 | p7 |
| `host/tooling.ts` | the tools and titles a session is offered: `permitted`, `advancedTools`, `contributed`, `compactPrompts`, `strategies`, `strategyOf`, `shapedDefinition`, `toolDefinitions`, `clientTools`, `retool`, `chatMeant`, `moving`, `renameChat`, `toolContext`, `mcpFor`, `served`, `boundTools`, `instructions` | 345 | p8 |
| `host/terminals.ts` | the host's terminals: `claimOf`, `commanded`, `terminalInfo`, `heldTerminals`; in p9 also `createTerminal` and `disposeTerminal` | 180, then 80 | p8, p9 |
| `host/automations.ts` | the automation runtime: `runState`, `origins`, `linked`, `settleRun`, the bodies of the `onChanged` and `onDue` callbacks (registered from `host.ts` where they are today), `beginAutomation`, `startForAutomation`; in p9 also `listAutomationTriggerDefinitions`, `runAutomation`, `fetchAutomationRuns` | 5 in p6, 235 in p8, then 65 | p6, p8, p9 |
| `host/handshake.ts` | introduction and sign-in on a connection: `initialize`, `ping`, `reconnect`, `authenticate`, `tokensFor`, `expire`, `forgetExpiry` | 530 | p9 |
| `host/resourcemethods.ts` | `storeFor` and every `resource*` method, `createResourceWatch`, `invokeChangesetOperation` | 320 | p9 |
| `host/sessionmethods.ts` | `subscribe`, `fetchTurns`, `completions`, `listSessions`, `createSession`, `createChat`, `disposeChat`, `disposeSession`, `resolveSessionConfig`, `sessionConfigCompletions` | 790 | p9 |
| `host/vscodemethods.ts` | the `vscode/*` worktree, artifact and debug-log methods with `stateFileOf`, `shutdown`, the diagnostics methods with `resolved` and `PROXY_ENV`, and the dev container relay (`containers`, `containerAsk`, `namedContainer`, `vscode/devContainers/*`) | 490 | p9 |
| `host/actions.ts` | `applyDispatch` up to the chat switch: the family check, the dispatch gate, annotations, `root/configChanged`, changesets, automations, the session flags, `session/activeClientSet`, terminals | 520 | p10 |
| `host/chatactions.ts` | the rest of `applyDispatch`: a worker's chat, a session not running, and the switch on a chat or session action | 1,080 | p10 |

Beside `host/`, `packages/sdk/src/repo/` takes `git.ts`, `github.ts` and `worktrees.ts` unchanged (p3).
A later plan, not this one, lifts `repo/` into a default-loaded plugin package that registers the `directories`, `worktrees` and `github` ports through `PluginHost`, the way `packages/computer` registers `computers`.

What stays in `host.ts`: the imports and re-exports, `HOST_CLOSE_WAIT_MS`, `WAIT_LIMIT`, `logs` (the debug-log store), the shared state maps (`claims`, `agents`, `connections`, `presence`, `watches`, `kept`, `sessions`, `byChat`, `subagents`, `owners`, `names`, `terminals` and the rest), the funnel (`broadcast`, `seenBy`, `applying`, `asking`, `dispatch`, `refuse`, `releaseWatch`, `leaves`), the calls that build each factory in order, the statements that run at construction, the returned `Host` (`setTools`, `close`, `turning`), and `accept`'s shell (`connection`, `handshook`, the ordering of dispatches, `notifications`, `handle`).
Estimated at 1,500 to 2,000 lines.

- **Data flow** - unchanged: a request reaches `accept().handle`, which looks the method up in `handlers`, now built by spreading each family's table; a dispatch reaches `applyDispatch`, now in `host/actions.ts`.
- **State flow** - the shared maps are created in `createHost` and handed to the factories that read them; a map one area alone writes moves into that area's factory.
- **Layer responsibilities** - sdk only; no other package changes.
- **Source-of-truth files** - [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts)

## Tasks

| Plan | Status | Depends on |
| --- | --- | --- |
| [p1 - The grant tables and the URI names are files of their own](../48-host-is-split-by-area-p1-the-grant-and-uri-tables/plan.md) | done | plugin/29 |
| [p2 - The URI routing, the client relay and the connection gate are files of their own](../48-host-is-split-by-area-p2-routing/plan.md) | done | p1 |
| [p3 - Changesets and git and GitHub facts are files of their own, and the repository ports live in repo/](../48-host-is-split-by-area-p3-changesets-and-facts/plan.md) | done | p2 |
| [p4 - Telemetry, sign-in requirements, owners and machines are files of their own](../48-host-is-split-by-area-p4-telemetry-owners-and-machines/plan.md) | done | p2 |
| [p5 - Session config and root config are files of their own](../48-host-is-split-by-area-p5-session-and-root-config/plan.md) | done | p4 |
| [p6 - The catalogue, past sessions and snapshots are files of their own](../48-host-is-split-by-area-p6-catalogue-and-transcripts/plan.md) | done | p3, p5 |
| [p7 - Starting, restarting and removing a session are files of their own](../48-host-is-split-by-area-p7-session-lifecycle/plan.md) | done | p6 |
| [p8 - Session tools, terminals and automations are files of their own](../48-host-is-split-by-area-p8-tools-terminals-and-automations/plan.md) | done | p7 |
| [p9 - The method table is split by family](../48-host-is-split-by-area-p9-the-method-table/plan.md) | done | p8 |
| [p10 - Action dispatch is split by family](../48-host-is-split-by-area-p10-action-dispatch/plan.md) | done | p9 |
| [p11 - Open plans cite the new files](../48-host-is-split-by-area-p11-open-plans-cite-the-new-files/plan.md) | done | p10 |

## Risks and tradeoffs

- Every open host plan touches `host.ts`, so this plan conflicts with all of them; it runs as one wave between plugin/29 and host/43, and the children land in order on one branch.
- Construction order: a factory reads another area's function through `ctx` when it is called, never when it is built, and the statements that run while the host is built stay in `host.ts`, after every factory they call, in today's order.
- A move that changes nothing is easy to break silently: a `let` (`serverSeq`, `closed`, `advancedTools`, `restartNeeded`, `contributed`, `contributing`, `handshook`, `alive`) becomes a field on the context and every reader and writer uses `ctx.<name>`; taking one off `ctx` into a local at construction would freeze it.
- One context is one wide object any file can reach into; the type in `host/context.ts` is where its reach is read.
- A file under `host/` never imports `../host.js`, which would be a cycle: a moved body that reads a module-level constant still in `host.ts` takes the constant with it, or moves it to `host/common.ts` when `host.ts` still reads it too.
- The handler classification test passes vacuously once the handlers leave `host.ts` unless p9 changes it in the same commit.

## Resume state

- **Done so far:** p1 to p11 built and merged (p1 to p4 in `c78dbeb`, p5 to p8 in `f1b3bd1`, p9 to p11 in `ca6adcb`); `host.ts` is 1,141 lines, from 11,658, with `packages/sdk/src/host/` holding 30 files.
- **p3's dead copies are gone.** The reviewer removed `git.ts`, `github.ts` and `worktrees.ts` from `packages/sdk/src/` when p1-p4 landed; only `packages/sdk/src/repo/` holds them now.
- **Next action:** Softov's review of p9 to p11, which moves them to `done`; this plan is then built.
- **Requires:** plugin/29, which is in the tree (commit `804a549`).
- **Blocks:** host/43, host/44 p2, host/44 p3, host/45, host/46 and host/47, which all edit `host.ts` and run after this plan, against the new files.
- **Open questions:** none.
- **Watch out for:** line numbers in every child are at `1eb8c8f` and plugin/29 moves them; find code by symbol name. `users-gate.test.ts:142` reads `host.ts` as text, and p9 is what makes it read every file. A `let` in the closure is never copied off the context.

## Final verification checklist

- [x] p1 to p11 built. p1 to p8 in `f1b3bd1`; p9, p10 and p11 in this worktree, uncommitted.
- [x] `wc -l packages/sdk/src/host.ts` is under 2,000. It is 1,141.
- [x] `rg -n "from '\.\./src/host\.js'|from '\.\./\.\./sdk/src/host\.js'" packages` still resolves every import, and `packages/sdk/src/index.ts` is unchanged apart from p3's three re-export lines.
- [x] `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass.
- [ ] `plans/index.md` updated - left alone on purpose, because the instructions for this run say not to edit it.
