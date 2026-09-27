---
title: A cofold session has files, shell, web and memory, run by cofold itself
domain: plugin
status: active
priority: high
created: 2026-09-26
revalidated: 2026-09-26
requires:
  - plans/plugin/03-agent-cofold/plan.md
changes: []
creates: []
decisions:
  - decisions/cofold-runs-its-own-tools-in-its-process.md
  - decisions/a-cofold-session-in-a-computer-runs-in-a-nested-host.md
  - decisions/a-cofold-read-outside-the-workspace-asks-in-default-mode.md
  - decisions/cofold-memory-is-per-workspace.md
  - decisions/a-session-without-a-directory-keeps-its-tools.md
  - decisions/a-cofold-turn-with-no-model-fails-and-says-where-to-name-one.md
  - decisions/web-fetch-refuses-internal-addresses.md
refs:
  - "[code://packages/agent-cofold/src/session.ts#L406-L425](../../../../packages/agent-cofold/src/session.ts#L406-L425) - `agentOf`: the per-turn agent, with the capabilities built here and the host's tools"
  - "[code://packages/agent-cofold/src/session.ts#L799](../../../../packages/agent-cofold/src/session.ts#L799) - `run(...)` with `workspace: where`, which the capabilities resolve paths against"
  - "[code://packages/agent-cofold/src/plugin.ts#L105](../../../../packages/agent-cofold/src/plugin.ts#L105) - `apply`, where the plugin's options are read"
  - "[code://packages/agent-cofold/src/agent.ts#L84-L85](../../../../packages/agent-cofold/src/agent.ts#L84-L85) - `defaultStoreRoot`, where memory goes beside the sessions"
  - "[code://packages/sdk/src/types/agent.ts#L203](../../../../packages/sdk/src/types/agent.ts#L203) - `onFileEdit`, how a backend reports an edit it made itself"
  - "[code://packages/agent-claude/src/session.ts#L1527](../../../../packages/agent-claude/src/session.ts#L1527) and [#L1652](../../../../packages/agent-claude/src/session.ts#L1652) - the pattern: Claude's write tools reported before and after"
  - "[code://packages/agent-claude/src/session.ts#L2638-L2646](../../../../packages/agent-claude/src/session.ts#L2638-L2646) - a shell call drawn with `toolKind: 'terminal'`"
  - file:///github/cofold/packages/papo/src/agent.ts - `capabilitiesOf`, the same four turned on from a config
  - file:///github/cofold/packages/agents/src/run/tools.ts - validate, `beforeTool`, policy, execute, `afterTool`
  - "file:///github/cofold/packages/tools/src/shell.ts - `shell_exec`, marked `effects: { writes: true, destructive: true }`"
---

## Goal

A cofold session can read, search, edit and write files, run a command, fetch and search the web, and keep memory, the way a Claude session can.
Cofold runs these tools itself; ahpd shows each call, asks before what the permission mode says to ask, and shows the edits.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `grep -n "capabilities" /github/cofold/packages/agents/src/types/agent.ts` - `AgentOptions.capabilities`, resolved per run with the run's `workspace`.
- `grep -n "name: '" /github/cofold/packages/tools/src/*.ts` - `read_file`, `write_file`, `edit_file`, `list_files`, `search_files`, `shell_exec`, `web_fetch`, `web_search`, `memory_read`, `memory_write`.
- `grep -n "SearchProvider" /github/cofold/packages/tools/src/types/web.ts` - `web_search` exists only when a search provider is given: Brave, Tavily or DuckDuckGo.
- `grep -n "isEdit\|effects.writes" packages/agent-cofold/src/session.ts` - the permission policy already treats a tool with `effects.writes` as an edit and knows the workspace boundary.

### Runtime path

```
turn -> agentOf(values) -> createAgent({ tools: host's, capabilities: [new] files, shell, web, memory })
model calls edit_file -> beforeTool [new] onFileEdit(before) -> policy asks or allows -> cofold executes
                      -> afterTool [new] onFileEdit(after) -> the call completes in the chat
```

### Gaps

- `agentOf` passes no capabilities.
- Nothing reports an edit a cofold tool made, so a client sees no changed file.
- A `shell_exec` call is drawn as a generic tool, not a terminal.
- No option says which tools are on or which search provider to use.

## Decisions locked in

| Decision | Task |
| --- | --- |
| [Cofold runs its own tools in its own process, as Claude does](../../../decisions/cofold-runs-its-own-tools-in-its-process.md) | 01, 02, 03 |
| [A cofold session in a computer runs in an ahpd started inside it](../../../decisions/a-cofold-session-in-a-computer-runs-in-a-nested-host.md) | - (container/04) |
| [In the default mode a cofold read outside the workspace asks first](../../../decisions/a-cofold-read-outside-the-workspace-asks-in-default-mode.md) | 05, 08 |
| [A cofold session's memory is per workspace, shared by the sessions in it](../../../decisions/cofold-memory-is-per-workspace.md) | 01 |
| [A cofold session with no working directory keeps its tools, and the permission mode confines them](../../../decisions/a-session-without-a-directory-keeps-its-tools.md) | 09 |
| [A cofold turn with no model configured fails and says to add "model" to the cofold configuration file](../../../decisions/a-cofold-turn-with-no-model-fails-and-says-where-to-name-one.md) | 13 |
| [web_fetch refuses loopback, private and link-local addresses, on every hop](../../../decisions/web-fetch-refuses-internal-addresses.md) | 06, 08 |

| What | Source | Task |
| --- | --- | --- |
| All four on by default; a plugin option `tools: { files, shell, web, memory }` turns one off, the shape papo's `ToolsConfig` has | Softov, 2026-09-26: "files, shell, web, memory"; papo's config for the shape | 01 |
| `web_search` only when a provider is configured under `tools.web.search` (`brave`, `tavily`, `duckduckgo`) | `@cofold/tools`' `web({ search })` | 01 |
| The capabilities are built here from `@cofold/tools`, not imported from papo | papo is a CLI, not a library this plugin depends on | 01 |
| A host tool that shares a capability tool's name keeps it, and the capability's tool is left out | cofold fails a run two contributors give one name to | 01 |
| A session whose store is in memory gets no memory capability | there is no directory to keep memory files in | 01 |
| The new section of `docs/PLUGINS.md` and the package README are not hard-wrapped | Softov's rule for docs | 10 |
| A `shell_exec` call's `toolInput` is the bare command on every action and part that carries one; it still runs in cofold's own process. | Softov, 2026-09-26: "Bare command, like Claude". | 11 |
| `searchOf` keeps the configured order and `searchProviders` builds the array in it. | Softov, 2026-09-26: "Configured order". | 12, 10 |
| Both checks resolve symlinks with `realpath` before comparing, a path that does not exist yet judged by its nearest existing ancestor; replaced for ahpd's check by the `resolveWithin` row below. | Softov, 2026-09-26: "yes, both". | 06, 07 |
| ahpd's check is `@cofold/tools`' `resolveWithin`, so a dangling link is followed as cofold's own tools follow it. | the second review, 2026-09-26: the hand-written copy judged a dangling link by its own name | 14 |
| ahpd depends on `@cofold/tools` `^0.1`. | Softov, 2026-09-26: "Release tools 0.1.x". | 06, 08 |
| The tool section and the README go back to one sentence per line, with today's wording. | Softov, 2026-09-27, asked what the reflow goes back to: "One sentence per line". | 20 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A cofold session's agent has the four capabilities](task-01-the-four-capabilities.md) | done | - |
| [02 - A cofold tool call is drawn and its edits are reported](task-02-calls-drawn-and-edits-reported.md) | done | 01 |
| [03 - The permission modes cover the new tools](task-03-permission-modes-cover-them.md) | done | 01 |
| [04 - Docs and the package](task-04-docs-and-package.md) | done | 02, 03 |
| [05 - cofold's harness asks for a read outside the workspace](task-05-cofold-asks-for-a-read-outside.md) | done | - |
| [06 - @cofold/tools checks real paths and refuses internal addresses](task-06-cofold-tools-check-real-paths-and-addresses.md) | done | - |
| [07 - ahpd's workspace check follows symlinks](task-07-ahpd-inside-follows-symlinks.md) | done | - |
| [08 - ahpd takes the cofold releases, and its tests pin reads and addresses](task-08-ahpd-takes-the-cofold-releases.md) | done | 05, 06 |
| [09 - The denial, the end-of-run sweep, cancel and a session with no directory are pinned by tests](task-09-the-untested-paths-are-pinned.md) | done | - |
| [10 - The docs and the package README say what the code does](task-10-docs-say-what-the-code-does.md) | done | 07, 08, 12, 13 |
| [11 - A shell call's tool input is its bare command](task-11-a-shell-call-sends-the-bare-command.md) | done | - |
| [12 - Search providers are tried in the configured order](task-12-search-providers-in-configured-order.md) | done | - |
| [13 - A turn with no model says to add "model" to the cofold configuration file](task-13-no-model-says-what-to-add.md) | done | - |
| [14 - ahpd's workspace check follows a dangling symlink, through cofold's own resolver](task-14-inside-follows-a-dangling-link.md) | done | 07, 08 |
| [15 - A declined edit sends its after when the person declines](task-15-a-declined-edit-sends-its-after-when-declined.md) | done | 09 |
| [16 - The plan closes on what is true](task-16-the-close-says-what-is-true.md) | implemented | 14, 15 |
| [17 - cofold follows a link's target one name at a time, released by Softov](task-17-cofold-follows-a-link-target-one-name-at-a-time.md) | implemented | 14 |
| [18 - The tool tests wait on time, and the mode table is one case per row](task-18-the-tool-tests-wait-on-time.md) | implemented | 15 |
| [19 - The close is true](task-19-the-close-is-true.md) | implemented | 16, 18 |
| [20 - The tool section and the README are one sentence per line again](task-20-the-tool-docs-are-one-sentence-per-line.md) | implemented | 19 |

## Risks and tradeoffs

- The tools run as the daemon's user on the daemon's machine; the permission mode is what confines them, not the workspace, so `default` asks before a write, a command, a web fetch and a read outside the workspace.
- A client that also offers its own terminal tool sees two ways to run a command; the host's `ahp_terminals` stays, since it is a terminal a person can watch.
- `web_fetch` checks an address before each request, so a name that resolves differently at the connection (DNS rebinding) is not caught.
- The workspace check resolves a path with cofold's `resolveWithin` and cofold's own tools write it in a second step, so a symlink another actor swaps between the two is not seen.
  [Plugin/22](../22-a-cofold-write-lands-where-it-was-allowed/plan.md) plans the fix.
- `@cofold/tools` 0.1.1, committed in cofold as `d9d229e` and published, judges a dangling link whose target reads `dir/../name`, with `dir` a symlink out of the workspace, as outside, and ahpd takes it as `^0.1.1`.
  The caveat that such a link is judged inside stays in `docs/PLUGINS.md` and `packages/agent-cofold/README.md` until task 19 step 6, which waits for Softov's review of tasks 16 to 19.
- Memory is shared by every session in a workspace, and its `MEMORY.md` is in every run's instructions, so what one session writes there reaches the next.
- cofold has no default model: a turn with none configured fails rather than running on one nobody chose, and task 13 makes its sentence say what to add and where.

## Resume state

- **Done so far:** tasks 01 to 15 are done: the four `@cofold/tools` capabilities per turn, edits reported through `onFileEdit`, `shell_exec` drawn as a terminal with its bare command, the mode table in `packages/agent-cofold/test/agent-cofold-tools.test.ts`, the `tools` option and the tool section in `docs/PLUGINS.md`, and `packages/agent-cofold/README.md`.
  ahpd takes `@cofold/agents` `^0.1.1` with `@cofold/tools` `^0.1.1`, the workspace check is cofold's own `resolveWithin` so a symlink out of the workspace, dangling or not, asks, search providers follow the configured order, and a turn with no model says to add `"model"` to the cofold configuration file and names its path.
  Tasks 05 and 06 are done in cofold, released as `@cofold/agents` 0.1.1 and `@cofold/tools` 0.1.0.
  Task 16 is implemented and was not passed by the second review.
  Tasks 18 and 19 are implemented: `when` waits on wall-clock time and throws, the mode table is one case per row, and the checklist, docs, comments and Resumes say what is true.
  Task 17 is implemented: its fix is committed in cofold as `d9d229e` and published as `@cofold/tools` 0.1.1, which `packages/agent-cofold/package.json` takes as `^0.1.1`.
  Task 20 is implemented: the tool section of `docs/PLUGINS.md` and `packages/agent-cofold/README.md` are one sentence per line again, with the wording they had, and nothing but line breaks moved.
- **Next action:** Softov's review of tasks 16 to 19; after it, task 19 step 6 closes the plan (the `..`-after-a-symlink caveats come out of the docs, the Risks and the checklist, since `@cofold/tools` 0.1.1 catches it).
- **Open questions:** none.
- **Watch out for:** `agentOf` is rebuilt per turn, so the capabilities are too.
  Relative paths and the memory slug resolve against the session's working directory, and against the daemon's current directory when the client named none (`session.ts:195`), as `agent-pi` and `agent-acp` do.
  A declined approval leaves cofold's own tool-call row `pending-confirmation` in `mapping.ts`, which is the client's own row to move and not this plan's.

## Final verification checklist

- [ ] VS Code: a cofold session reads a file, edits it (the edit shows as a change), and runs `ls` (drawn as a terminal).
- [ ] VS Code: in the default mode the edit and the command ask first; in `acceptEdits` the edit does not.
- [ ] VS Code: in the default mode a read of a file outside the workspace asks first.
- [x] In `acceptEdits`, a write through a symlink that leaves the workspace asks first (task 07).
- [x] In `acceptEdits`, a write through a dangling symlink whose target is outside asks first (task 14).
- [ ] In `acceptEdits`, a write through a dangling link whose target is `sublink/../name`, with `sublink` a symlink out of the workspace, asks first (task 17, after the `@cofold/tools` release).
- [x] A declined edit's `after` is sent on the decline (task 15).
- [x] `web_fetch` works; `web_search` appears only with a provider configured; `web_fetch` of `http://127.0.0.1/` or a redirect to `169.254.169.254` is refused (tasks 06, 08).
- [x] Cancelling a turn while `shell_exec` runs kills the command and anything it started (task 09).
- [ ] VS Code: a `shell_exec` row shows the bare command, not JSON (task 11 pins the input; the row was not driven, see [deferred.md](deferred.md)).
- [x] With `duckduckgo` listed before `brave`, `web_search` asks DuckDuckGo first (task 12).
- [x] With no model configured anywhere, a turn fails with a sentence that says to add `"model"` to the cofold configuration file and names its path (task 13).
- [x] `@cofold/tools` is at 0.1.x with a `^0.1` peer range, and `@ahpd/agent-cofold` takes `^0.1` (tasks 06, 08).
- [x] A session opened with no working directory still has `shell_exec` and the files tools (task 09).
- [x] `pnpm test`, `pnpm typecheck` and `pnpm boundary` green in ahpd; cofold's own run is in [deferred.md](deferred.md).
- [x] `docs/PLUGINS.md` says what confines the tools and that search follows the configured order, and `packages/agent-cofold/README.md` exists (task 10).
- [x] `plans/index.md` updated.
