---
title: ahpd runs on the current cofold release, and keeps no copy of what cofold now ships
domain: plugin
status: planned
priority: high
created: 2026-10-09
revalidated: 2026-10-09
requires:
  - plans/plugin/35-cofold-uses-what-cofold-ships/plan.md
changes: []
creates: []
decisions:
  - decisions/permission-modes-live-in-the-harness.md
refs:
  - "[code://packages/agent-cofold/src/pauses.ts#L43-L178](../../../../packages/agent-cofold/src/pauses.ts#L43-L178) - `owePause`, `payPause`, `rejoin`, `route`, `stopNow` and `stop`: the workaround for a `run()` handle that took no answer"
  - "[code://packages/agent-cofold/src/runs.ts#L78-L228](../../../../packages/agent-cofold/src/runs.ts#L78-L228) - `settleTurn`, `apply` and `read`: the pause bookkeeping and the synthesized `run.finished`"
  - "[code://packages/agent-cofold/src/runs.ts#L244-L316](../../../../packages/agent-cofold/src/runs.ts#L244-L316) - `reopen`, which replays a stored run and attaches `resume()` after a restart"
  - "[code://packages/agent-cofold/src/context.ts#L54-L77](../../../../packages/agent-cofold/src/context.ts#L54-L77) - the context fields `liveAgent`, `paused` and `pausing`"
  - "[code://packages/agent-cofold/src/session.ts#L301-L323](../../../../packages/agent-cofold/src/session.ts#L301-L323) - `cancel` and `steer`"
  - "[code://packages/agent-cofold/src/agent.ts#L130-L170](../../../../packages/agent-cofold/src/agent.ts#L130-L170) - the copies `PERMISSION_MODES`, `PERMISSION_DESCRIPTIONS`, `EFFORT_LEVELS` and `effortOf`"
  - "[code://packages/agent-cofold/src/agent.ts#L370-L376](../../../../packages/agent-cofold/src/agent.ts#L370-L376) - `modelOf` forces `features: { reasoning: true }` beside the effort"
  - "[code://packages/agent-cofold/src/config.ts#L21-L31](../../../../packages/agent-cofold/src/config.ts#L21-L31) - `HarnessProvider`, the same shape as cofold's `ProviderConfig`"
  - "[code://packages/agent-cofold/src/config.ts#L118-L129](../../../../packages/agent-cofold/src/config.ts#L118-L129) - the copy of `splitModel`"
  - "[code://packages/agent-cofold/src/capabilities.ts#L22-L118](../../../../packages/agent-cofold/src/capabilities.ts#L22-L118) - the copies `SearchConfig`, `ToolsConfig`, `searchProviders`, and `withoutTaken` and `capabilitiesOf`"
  - "[code://packages/agent-cofold/src/turnagent.ts#L30-L48](../../../../packages/agent-cofold/src/turnagent.ts#L30-L48) - `EDITS` and `editPathOf`, the tool-name table for the changeset"
  - "[code://packages/agent-cofold/src/turnagent.ts#L300-L342](../../../../packages/agent-cofold/src/turnagent.ts#L300-L342) - the capabilities, the edit hooks and the policy given to `createAgent`"
  - "[code://packages/agent-cofold/src/tools.ts#L165-L224](../../../../packages/agent-cofold/src/tools.ts#L165-L224) - `toolMetaOf`, `intentionOf`, `toolInputOf` and `describe`, the per-name subject table"
  - "[code://packages/agent-cofold/src/mapping.ts#L434-L510](../../../../packages/agent-cofold/src/mapping.ts#L434-L510) - `tool.proposed` and `approval.requested`, which title a row from the name table"
  - "[code://packages/agent-cofold/src/transcript.ts#L80-L87](../../../../packages/agent-cofold/src/transcript.ts#L80-L87) - `invocationOf`, the same title read back from the store"
  - "[code://packages/agent-cofold/src/index.ts#L14-L29](../../../../packages/agent-cofold/src/index.ts#L14-L29) - the public names this plan moves to cofold"
  - npm://@cofold/agents@^0.2.1 - the run handle answers its own pause, modes and effort as data, `tool.proposed.subject`, `Tool.writes`, `Capability.exclude`, steer parts
  - npm://@cofold/tools@^0.3.0 - every tool's `subject`, the file tools' `writes`, `standardCapabilities`, `TOOLS_SCHEMA`, and a write refused until the file is read
  - npm://@cofold/model-openai-compat@^0.2.0 - a reasoning param turns reasoning on, `ProviderConfig`, `splitModel`, `providersOf`, `providerFor`, `PROVIDER_SCHEMA`
  - npm://@cofold/store-file@^0.2.0 - `SessionRecord.activeWriterPid`
  - git://release-2026-10-06..release-2026-10-09 - the cofold range this plan certifies, read in `/github/cofold`
  - file:///github/cofold/.project/plans/agent/05-a-run-answers-its-own-pause/deferred.md - the ahpd work agent 05 left: drop the pause workaround
  - file:///github/cofold/.project/plans/agent/06-modes-and-effort-are-library-data/deferred.md - the ahpd work agent 06 left: drop the mode and effort copies
  - file:///github/cofold/.project/plans/tools/02-tools-declare-what-they-touch/deferred.md - the ahpd work tools 02 left: drop the tool-name tables
  - file:///github/cofold/.project/plans/tools/03-the-library-takes-the-config-object/deferred.md - the ahpd work tools 03 left: take the configuration exports
  - file:///github/cofold/.project/plans/tools/04-a-harness-can-turn-off-read-before-write/plan.md - the cofold plan that adds `requireRead`, which task 09 takes
---

## Goal

ahpd takes the current cofold release: agents 0.2.1, tools 0.3.0, model-openai-compat 0.2.0 and store-file 0.2.0.
Every cofold change in that range is either used by ahpd or recorded here with the reason ahpd needs nothing.
The code ahpd wrote while cofold lacked a feature goes, and ahpd uses cofold's version.
A person sees the same sessions, approvals, questions and tool rows as before, with the small differences the certification lists.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `git diff --ignore-cr-at-eol --stat release-2026-10-06..release-2026-10-09` over the four packages' `src` - 32 files change; the rest of the raw diff is the LF commit 5da7143.
- `git log release-2026-10-06..release-2026-10-09` over the four packages - five commits change code.
  529cdb1 has agent 05, agent 06, tools 02 and tools 03; 92e2e00 has the 0.2.0 versions.
  42406d6 has agent 07, d39935f has plugin 22, and 620814f has agents 0.2.1 and tools 0.3.0.
- `rg "ahpd" /github/cofold/.project/plans/*/*/deferred.md` - four rows wait on ahpd: agent 05, agent 06, tools 02, tools 03; agent 07's row is papo's.
- `rg "owePause|payPause|rejoin|pausing|\.paused|liveAgent" packages/agent-cofold/src` - `pauses.ts`, `runs.ts`, `context.ts`, `turns.ts:119` and `session.ts:167-170`.
- `rg "PERMISSION_LABELS|capabilitiesOf|splitModel|HarnessProvider|toolsOf|DEFAULT_TOOLS|SearchConfig|ToolsConfig|EFFORT_LEVELS|effortOf|PERMISSION_MODES"` outside `agent-cofold/src` - only agent-cofold's own tests and agent-pi's own mode list; no other package imports these names from `@ahpd/agent-cofold`.
- `npx vitest run packages/agent-cofold` on the new ranges, in the parked worktree `build-agents-cofold-uptake` - 169 pass and 25 fail; `pnpm typecheck` passes, because 0.2 is type-compatible.

### Runtime path

```
a turn -> run() -> handle.events: ... approval.requested -> run.paused -> run.finished{awaiting} -> (person answers) handle.submit -> approval.resolved -> run.resumed -> ... -> run.finished
confirm / answer -> route -> ctx.handle.submit            (no rejoin, no wait on a pause)
cancel / close -> stop -> ctx.handle.cancel               (a paused run denies "The turn was stopped" and ends cancelled)
restart -> reopen -> replay stored events -> resume({ afterSeq }) -> the same handle answers this pause and any later one
tool.proposed { subject } -> the row's title, intention and shell input
tool.writes(input) -> the changeset's before and after, when the file is inside the workspace
```

### What cofold changed, and where each change goes

| cofold change | Source | ahpd |
| --- | --- | --- |
| A `run()` handle takes `approve`, `deny` and `answer` across its own pause | agent 05, decision 122 | task 02 |
| The stream goes on after `run.finished{awaiting}`: the resolution, `run.resumed`, more events, then the last `run.finished` | agent 05 | task 02 |
| The handle synthesizes a `run.finished` when the run published none | agent 05 | task 02 removes the fallback in `read` |
| `handle.outcome` resolves once, at the real end | agent 05 | task 02 |
| A run can pause more than once on one handle | agent 05 | task 02, a test |
| A paused run stays in `liveRuns`, so a same-process `resume()` is refused `writer_busy` | agent 05 | task 02 removes `rejoin`, which would now fail |
| `cancel()` on a paused handle denies the request "The turn was stopped" and ends `cancelled` | agent 05, decision 120 | task 02: `stop` cancels the handle, paused or not |
| `submit` on a closed handle throws `not_running` | agent 05 | task 02: `route` and `steer` keep their `catch` |
| A steer sent during a pause waits in the queue and lands after the answer | agent 05 | task 02, a test; before, the closed handle dropped it |
| A `resume()` handle answers its own later pauses, and `startSeq` follows `afterSeq` | agent 05 | task 02: `reopen` keeps `resume()`, a test |
| `handle.status()` is `awaiting` during a pause | agent 05 | no change, because ahpd's status reads its own `pending` map |
| `RunHandle.detach()` leaves a paused run unanswered | agent 05 | no change, because close stops the run, and a stopped run denies its request |
| The heartbeat stops at a pause; the abort timer is `unref`'d and a pause counts toward `timeoutMs` | agent 05 | no change, because ahpd sets no `timeoutMs` and starts no second run while a turn is open |
| `PERMISSION_MODES` | agent 06 | task 03 |
| `PERMISSION_MODE_DESCRIPTIONS` | agent 06 | task 03 |
| `EFFORT_LEVELS`, `effortOf` and the type `EffortLevel` | agent 06 | task 03 |
| `PermissionModeRules.isEdit` is optional, and its default is `tool.writes !== undefined` | agent 06 | no change, because ahpd's `isEdit` reads `effects.writes`, which a host tool declares ([decision](../../../decisions/permission-modes-live-in-the-harness.md)) |
| `acceptEdits` judges the file `tool.writes(input)` names, else `input.path` | agent 06 | task 05: `memory_write` under `acceptEdits` now asks, a test |
| A `params.reasoning` turns `features.reasoning` on | model-openai-compat 0.2.0 | task 03 removes the forced feature |
| `tool.proposed.subject`, and `Tool.subject` on every cofold tool | tools 02, decision 117 | task 04 |
| `tool.proposed` is sent after the `beforeTool` hook | tools 02 | task 05: the edit's `before` now comes before the row's start, a test |
| `Tool.writes` on `write_file`, `edit_file` and `memory_write` | tools 02 | task 05 |
| `Capability.exclude` | tools 02 | task 06 |
| `standardCapabilities(config, { workspace, memoryDir })` | tools 03 | task 06 |
| `SearchConfig` and `ToolsConfig` | tools 03 | task 06 |
| `TOOLS_SCHEMA` | tools 03 | task 06: strict by default, with `strictTools: false` to bypass it |
| `ProviderConfig` and `splitModel` | tools 03 | task 06 |
| `providersOf` and `providerFor` | tools 03 | no change, because ahpd holds one provider per endpoint and key ([plugin 35](../35-cofold-uses-what-cofold-ships/plan.md)) and resolves a reference with fallbacks cofold does not know |
| `PROVIDER_SCHEMA` | tools 03 | no change, because `harnessConfig` drops one bad provider and keeps the rest, and a key the harness adds must not drop a provider |
| A write re-checks the file it opened | plugin 22 task 02, tools 0.3.0 | task 07, no code |
| A write to a file the session did not read, or that changed since, is refused | plugin 22 task 03, tools 0.3.0 | task 07: the tests read first |
| No option turns that refusal off | tools 0.3.0 | task 09 takes cofold tools 04, which adds `files: { requireRead: false }` |
| `ResolvedPath.real` | plugin 22 | no change, because `insideDirectory` reads `.inside` only |
| A steer carries `parts` | agent 07 | no change here, because ahpd's text steer is the same call; [plugin 36](../36-a-cofold-turn-reads-its-attachments/plan.md) sends parts |
| `SessionRecord.activeWriterPid` | store-file 0.2.0 | no change, because `reopen` reads the run's status, not the writer claim |
| Decision 109, the cost is recorded on the run | cofold | no change, because ahpd reads `outcome.cost` as before |
| Decision 124, turns stay in each program | cofold | no change, because `turnsOf` and `mapTurn` stay in ahpd |
| LF line endings, README badges | 5da7143, 50285be | no change, because no published code moves |

### The tests the release fails, and the task that fixes each

| Test file | Test | Why it fails | Task |
| --- | --- | --- | --- |
| `agent-cofold-approval.test.ts` | runs an approved tool, takes the entry down and finishes the turn | the answer goes to `rejoin`, which is refused | 02 |
| `agent-cofold-approval.test.ts` | offers allow once, allow the tool for this session, and deny | `tools/ahp.strict.schema.json` is missing, because `node tools/schema.mjs` did not run | 01 |
| `agent-cofold-approval.test.ts` | allows the tool for the rest of the session when that is picked | the pause path | 02 |
| `agent-cofold-approval.test.ts` | asks again next time when the approval was only for once | the pause path | 02 |
| `agent-cofold-approval.test.ts` | denies a tool, carries the reason and does not run it | the pause path | 02 |
| `agent-cofold-approval.test.ts` | keeps two open approvals independent, each answered by its own call id | the pause path | 02 |
| `agent-cofold-approval.test.ts` | mirrors a question at the session and answers it back into the run | the pause path | 02 |
| `agent-cofold-approval.test.ts` | declines a question as a deny rather than an empty answer | the pause path | 02 |
| `agent-cofold-approval.test.ts` | raises a chatInput entry for cofold's own ask tool and answers it back | the pause path | 02 |
| `agent-cofold-approval.test.ts` | declines cofold's own ask tool as a denial the model reads | the pause path | 02 |
| `agent-cofold-plugin.test.ts` | resumes a paused run and shows the open turn once to a client that subscribes after | the pause path | 02 |
| `agent-cofold-store.test.ts` | reopens a paused run through start.resume without replaying the input | the pause path after `reopen` | 02 |
| `agent-cofold-store.test.ts` | answers a request the replay announced before the resumed run had a handle | the pause path after `reopen` | 02 |
| `agent-cofold-tools.test.ts` | sends a declined edit its after before the next ask | the pause path | 02 |
| `agent-cofold-tools.test.ts` | takes an approval given inside the emit that asks for it, and runs the tool | `route` waits on a pause that no longer closes the handle | 02 |
| `agent-cofold-tools.test.ts` | takes a decline given inside the emit that asks for it, and sends the after | the same | 02 |
| `agent-cofold-tools.test.ts` | asks before a shell command and sends its bare command on the request | close rejoins, the rejoin is refused, and the run stays `awaiting` | 02 |
| `agent-cofold-tools.test.ts` | a read outside the workspace: every mode answers as the table says | the same | 02 |
| `agent-cofold-tools.test.ts` | an edit inside the workspace: every mode answers as the table says | the same; then the unread file, if it fails again | 02, 07 |
| `agent-cofold-tools.test.ts` | an edit outside the workspace: every mode answers as the table says | the same | 02, 07 |
| `agent-cofold-tools.test.ts` | an edit through a symlink out of the workspace: every mode answers as the table says | the same | 02, 07 |
| `agent-cofold-tools.test.ts` | an edit through a dangling symlink whose target is outside: every mode answers as the table says | the same | 02, 07 |
| `agent-cofold-tools.test.ts` | an edit through a dangling link whose target has .. after a symlink out of the workspace: every mode answers as the table says | the same | 02, 07 |
| `agent-cofold-tools.test.ts` | a shell command: every mode answers as the table says | the same | 02 |
| `agent-cofold-tools.test.ts` | a web fetch: every mode answers as the table says | the same | 02 |

`agent-cofold-tools.test.ts` "reports a file edit through onFileEdit" passes in the parked worktree only because its fix is there: it edits a file it never read. Task 07 carries that fix.

### Gaps

- ahpd answers a pause through `rejoin`, which 0.2 refuses `writer_busy`; every approval and question is lost.
- A close or a cancel on a paused run rejoins, is refused, and leaves the run `awaiting` for ever.
- ahpd holds six copies of cofold names: the modes, their descriptions, the effort levels, `effortOf`, `splitModel` and the configuration types.
- A tool row is titled by an ahpd table of tool names; a tool cofold adds is titled by its name.
- The changeset finds an edit by a table of tool names.
- The memory capability's own `acceptEdits` judgment used the model's relative path against the workspace, so a `memory_write` was allowed as an edit inside it.

## Decisions locked in

| Decision | Tasks |
| --- | --- |
| [A permission mode is a harness policy, and the thinking level is a model request](../../../decisions/permission-modes-live-in-the-harness.md): ahpd supplies `inside` and `isEdit` | 03, 05 |

| What | Source | Task |
| --- | --- | --- |
| One plan takes the whole release and certifies every change, and nothing is built before Softov reads it | Softov, 2026-10-09, after the first take of the release broke 25 tests: "certify that nothing ... is missing" | 01-08 |
| Drop `owePause`, `payPause`, `rejoin` and `route`'s waits, and `runs.ts`'s pause bookkeeping and synthesized `run.finished` | cofold agent 05 `deferred.md` | 02 |
| A stop cancels the handle, which denies an open request and ends the run `cancelled` | cofold decision 120; the stop already settled every held entry first | 02 |
| `reopen` keeps `resume()`, for a run a restart left paused | `resume()` is still the only way into a run from a new process | 02 |
| Use cofold's `PERMISSION_MODES`, `PERMISSION_MODE_DESCRIPTIONS`, `EFFORT_LEVELS` and `effortOf`; keep `PERMISSION_LABELS`; drop the forced `features.reasoning` | cofold agent 06 `deferred.md`: "ahpd keeps its own labels" | 03 |
| `describe`, `intentionOf` and `toolInputOf` read `subject` from `tool.proposed`; `toolMetaOf` stays | cofold tools 02 `deferred.md`; cofold sends no tool kind, so the terminal kind stays ahpd's | 04 |
| `editPathOf` becomes `tool.writes(input)`, kept only when it is inside the workspace | cofold tools 02 `deferred.md`; `EDITS`'s own note: "a changeset is only told about the files it can read" | 05 |
| `withoutTaken` becomes `Capability.exclude` | cofold tools 02 `deferred.md` | 06 |
| `capabilitiesOf` becomes `standardCapabilities`; ahpd passes `memoryDir` itself, and none for a store in memory | cofold tools 03 `deferred.md` | 06 |
| `HarnessProvider`, `SearchConfig`, `ToolsConfig` and `splitModel` come from cofold; `harnessConfig` and `harnessConfigPath` stay | cofold tools 03 `deferred.md` | 06 |
| The `tools` option checks against `TOOLS_SCHEMA`; `strictTools: false` keeps today's loose check and `toolsOf` | Softov, 2026-10-09, asked "Adopt the strict TOOLS_SCHEMA?": "strict with option to bypass" | 06 |
| A run stored before 0.2, which has no `subject`, titles its rows by the tool name | Softov, 2026-10-09, asked how old runs are titled: "By tool name" | 04 |
| Plugin 36 is its own build, right after this plan, and requires it | Softov, 2026-10-09: "Separate, right after" | - |
| A `tools` option `files: { requireRead: false }` turns off the read-first rule; it is on by default | Softov, 2026-10-09, asked "Should cofold's file tools get an opt-out for the read-before-write rule?": "Opt-out, on by default" | 09 |
| plugin 22 task 04 moves here and is dropped there | plugin 22's task 04 is the same range move | 07 |
| `@ahpd/agent-cofold` exports cofold's names under the names it exports today, and drops `capabilitiesOf` | (defaulted: no ahpd package imports them; the package is public, so a name stays where it costs nothing) | 08 |

## Proposed architecture

- **Data flow** - the configuration types, the mode list and the effort list are cofold's. ahpd keeps its labels, `harnessConfig`, `toolsOf` and the choice of `memoryDir`.
- **Event flow** - ahpd reads one handle per turn to its last `run.finished`. A pause is a span inside that stream, from the request to its resolution.
- **State flow** - `pending` is the one record of an open request; the context loses `liveAgent`, `paused` and `pausing`.
- **Layer responsibilities** - `pauses.ts` answers and stops through `ctx.handle`. `runs.ts` maps events, settles the turn on the last `run.finished`, and reopens after a restart. `tools.ts` titles from `subject`, `turnagent.ts` finds edits from `tool.writes`, and `capabilities.ts` calls `standardCapabilities` with `exclude`.
- **Source-of-truth files** - [`code://packages/agent-cofold/src/pauses.ts`](../../../../packages/agent-cofold/src/pauses.ts), [`code://packages/agent-cofold/src/runs.ts`](../../../../packages/agent-cofold/src/runs.ts), [`code://packages/agent-cofold/src/capabilities.ts`](../../../../packages/agent-cofold/src/capabilities.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - ahpd takes the cofold release](task-01-ahpd-takes-the-cofold-release.md) | todo | - |
| [02 - A paused run is answered and stopped on its own handle](task-02-a-paused-run-is-answered-on-its-own-handle.md) | todo | 01 |
| [03 - Modes and effort are cofold's lists](task-03-modes-and-effort-are-cofolds-lists.md) | todo | 01 |
| [04 - A tool row is titled by the subject cofold sends](task-04-a-tool-row-is-titled-by-its-subject.md) | todo | 01 |
| [05 - An edit is the file the tool says it writes](task-05-an-edit-is-the-file-the-tool-writes.md) | todo | 01 |
| [06 - The tools and providers are configured by cofold's types](task-06-tools-and-providers-use-cofolds-config.md) | todo | 01 |
| [07 - A test reads a file before it writes it](task-07-a-test-reads-before-it-writes.md) | todo | 02 |
| [08 - The package exports and documents what it now takes from cofold](task-08-exports-and-docs.md) | todo | 03, 04, 05, 06 |
| [09 - The tools option can turn off the read-first rule](task-09-a-harness-can-turn-off-read-first.md) | todo | 06, 07, 08, cofold tools 04 release |

## Risks and tradeoffs

- Tasks 01 and 02 land together: the range move alone breaks every approval. The build is one branch, and no commit sits between them.
- A run stored by cofold 0.1 has no `subject` on its `tool.proposed`, so a reopened old session titles its rows by the tool name.
- A title for a path tool is now the path relative to the workspace, where it was the model's spelling; a path outside shows absolute.
- `memory_read` rows are now titled by the file, where they showed the tool name.
- cofold keeps what a session read in process memory, so after a daemon restart the model must read a file again before it writes it. `requireRead: false` turns the rule off (task 09).
- Task 09 waits on a cofold release. Tasks 01-08 can merge before it, and cofold tests that release against them.
- [host 61](../../host/61-agents-share-their-session-kit-presets-and-input-checks/plan.md) task 01 rewrites `runs.ts` status and activity; whichever lands second rebases.
- The parked worktree `build-agents-cofold-uptake` holds the range move, one test fix and edits to plugin 22. The build starts from main and takes those by hand.

## Resume state

- **Done so far:** nothing; planned 2026-10-09.
- **Next action:** Softov reads this plan; then [task-01-ahpd-takes-the-cofold-release.md](task-01-ahpd-takes-the-cofold-release.md).
- **Open questions:** none.
- **Watch out for:** a pause no longer ends the stream, so nothing may treat `run.finished{awaiting}` as the end of a read. `apply` still records no `endPoint` for it. Run `node tools/schema.mjs` before the suite.

## Final verification checklist

- [ ] Every row of "What cofold changed" names a task that is `done`, or says why ahpd needs nothing.
- [ ] Each of the 25 tests above passes, and none was deleted to get there.
- [ ] `rg "owePause|payPause|rejoin|pausing|liveAgent|EDITS|searchProviders|withoutTaken" packages/agent-cofold/src` finds nothing.
- [ ] `pnpm install && node tools/schema.mjs && pnpm build && pnpm typecheck && pnpm boundary && npx vitest run --maxWorkers=2 --testTimeout=10000` pass.
- [ ] [plugin 22](../22-a-cofold-write-lands-where-it-was-allowed/plan.md) task 04 is `dropped` and points here.
- [ ] An edit of an unread file succeeds with `files: { requireRead: false }`.
- [ ] `plans/index.md` updated.
