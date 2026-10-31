---
title: The change counters agree
created: 2026-10-31
refs:
  - git://3f426fa8bceee59782034b230d3727a463b73a27 - the commit of this repository the facts were checked at
  - "[code://packages/sdk/src/host/spawn.ts#L605](../../packages/sdk/src/host/spawn.ts#L605) - a turn's checkpoint is written under the bare id, `idOf(uri)`"
  - "[code://packages/sdk/src/host/spawn.ts#L1576](../../packages/sdk/src/host/spawn.ts#L1576) - a tool edit is observed under the session URI"
  - "[code://packages/sdk/src/host/changesets.ts#L123-L130](../../packages/sdk/src/host/changesets.ts#L123-L130) - `changesetAt` names the owner as the URI cut from the channel"
  - "[code://packages/sdk/src/host/changesets.ts#L600](../../packages/sdk/src/host/changesets.ts#L600) - the changeset read passes that URI to `state`"
  - "[code://packages/sdk/src/host/snapshots.ts#L231](../../packages/sdk/src/host/snapshots.ts#L231) - the snapshot read passes the URI too"
  - "[code://packages/sdk/src/host/actions.ts#L523](../../packages/sdk/src/host/actions.ts#L523) - the action read passes the URI too"
  - "[code://packages/sdk/src/sessions/checkpoints.ts#L49-L53](../../packages/sdk/src/sessions/checkpoints.ts#L49-L53) - the ref name is the session string with every other character made a dash"
  - "[code://packages/sdk/src/sessions/changes.ts#L747-L767](../../packages/sdk/src/sessions/changes.ts#L747-L767) - `sessionFiles` reads the checkpoints and falls back to the edit tracker"
  - "[code://packages/sdk/src/sessions/changes.ts#L41-L51](../../packages/sdk/src/sessions/changes.ts#L41-L51) - the tracker counts lines as a set difference"
  - "[code://packages/sdk/src/sessions/changes.ts#L1445-L1449](../../packages/sdk/src/sessions/changes.ts#L1445-L1449) - the session scope is `sessionFiles`"
  - "[code://packages/sdk/src/sessions/changes.ts#L1580-L1592](../../packages/sdk/src/sessions/changes.ts#L1580-L1592) - `sessionSummary`, which the catalogue calls with the bare id"
  - "[code://packages/sdk/src/sessions/changes.ts#L1902-L1912](../../packages/sdk/src/sessions/changes.ts#L1902-L1912) - `refresh` reads the uncommitted files only"
  - "[code://packages/sdk/src/sessions/changes.ts#L1914-L1925](../../packages/sdk/src/sessions/changes.ts#L1914-L1925) - the watch is on the git directory, not on the working tree"
  - "[code://packages/sdk/src/host/catalogue.ts#L452-L453](../../packages/sdk/src/host/catalogue.ts#L452-L453) - a worktree session's row is counted by its branch"
  - "[code://packages/sdk/src/host/catalogue.ts#L596-L604](../../packages/sdk/src/host/catalogue.ts#L596-L604) - `summaryMoved` sends the count it holds and reads nothing"
  - "[code://packages/sdk/src/host/catalogue.ts#L665-L695](../../packages/sdk/src/host/catalogue.ts#L665-L695) - `summaryKept` is the one place that reads a row's count"
  - "[code://packages/sdk/src/host/facts.ts#L381-L418](../../packages/sdk/src/host/facts.ts#L381-L418) - `refreshWatched` calls `summaryMoved` when the tree moved"
  - "[code://packages/sdk/test/checkpoints.test.ts#L184](../../packages/sdk/test/checkpoints.test.ts#L184) - the tests pass one id to both the checkpoint and the read"
  - https://github.com/microsoft/vscode/blob/171e90619c7/src/vs/platform/agentHost/node/agentHostChangesetSummary.ts#L11-L15 - `getSummaryChangesetKind`, checked at 171e90619c7
  - https://github.com/microsoft/vscode/blob/171e90619c7/src/vs/platform/agentHost/node/agentHostChangesetFileMonitorCoordinator.ts#L43-L55 - VS Code watches the repository roots and refreshes the subscribed changesets
---

# The change counters agree

Softov saw ahpw show three counts for one session, and wants them to agree.
The session was the cofold build, `claude-deepseek-build:/2c79b19f-3ef4-4a95-ad5d-e2bfbae386b0`, in a worktree cut from 067dcdc4.

| Where | Count | What it is |
|---|---|---|
| Branch Changes | 11 files, +538 −76 | `git diff` from the fork point to the tree now, which is correct |
| Uncommitted Changes | No changes | `git status`, which is correct |
| The row's badge | 12 files, +564 −101 | The branch count at the end of the last turn |
| Session Changes | 11 files, +391 −61 | The edit tracker, not the checkpoints |

## What others do

VS Code counts a row by its branch when the session has a worktree, and by its session otherwise, as [`getSummaryChangesetKind`](https://github.com/microsoft/vscode/blob/171e90619c7/src/vs/platform/agentHost/node/agentHostChangesetSummary.ts#L11-L15) says.
ahpd follows this in `summaryKindOf`.
While a client subscribes, VS Code watches the repository roots of the session for edits made outside the host ([`ChangesetFileMonitorCoordinator`](https://github.com/microsoft/vscode/blob/171e90619c7/src/vs/platform/agentHost/node/agentHostChangesetFileMonitorCoordinator.ts#L43-L55)).
A refresh then recomputes the subscribed changesets and the branch summary together.

## What ahpd has today

### One source, two names for a session

- A turn's checkpoint is written under the bare id ([`code://packages/sdk/src/host/spawn.ts#L605`](../../packages/sdk/src/host/spawn.ts#L605)), so the refs are `refs/agents/2c79b19f-…/checkpoints/turn/…`.
- The row's count is read with the bare id too, from `summaryKept`.
- A tool edit is observed under the session URI ([`code://packages/sdk/src/host/spawn.ts#L1576`](../../packages/sdk/src/host/spawn.ts#L1576)).
- The changeset, snapshot and action reads pass the session URI to `state` ([`code://packages/sdk/src/host/changesets.ts#L600`](../../packages/sdk/src/host/changesets.ts#L600), [`code://packages/sdk/src/host/snapshots.ts#L231`](../../packages/sdk/src/host/snapshots.ts#L231), [`code://packages/sdk/src/host/actions.ts#L523`](../../packages/sdk/src/host/actions.ts#L523)).
- With the URI, `baselineOf` looks for `refs/agents/claude-deepseek-build--2c79b19f-…/`, which does not exist.
- `sessionFiles` then answers from the edit tracker, which is keyed by the URI ([`code://packages/sdk/src/sessions/changes.ts#L747-L767`](../../packages/sdk/src/sessions/changes.ts#L747-L767)).
- So the Session Changes scope never reads the checkpoints from a client, for any session.
- The tests pass one id to both calls ([`code://packages/sdk/test/checkpoints.test.ts#L184`](../../packages/sdk/test/checkpoints.test.ts#L184)), so they do not see this.

The tracker sees only the files that the agent edited with its tools.
It did not see `packages/sdk/test/fixtures/wire.jsonl`, which the test run wrote.
It counts lines as a set difference ([`code://packages/sdk/src/sessions/changes.ts#L41-L51`](../../packages/sdk/src/sessions/changes.ts#L41-L51)), so a repeated line such as `}` is not counted.
That count over the 11 files, from the baseline to the last checkpoint, is exactly +391 −61.

### A row's count is read only during a turn

- `summaryKept` is the one place that reads a row's count ([`code://packages/sdk/src/host/catalogue.ts#L665-L695`](../../packages/sdk/src/host/catalogue.ts#L665-L695)).
- It runs on a tool call, at the end of a turn and at the baseline. Nothing else calls it.
- At the end of the builder's last turn, its test run had left `wire.jsonl` changed: 1 file, +26 −25.
- 538 + 26 is 564, and 76 + 25 is 101, which is the badge.
- The file was restored after the turn, outside the host. The badge kept the old count.
- `refreshWatched` sees a moved tree, and calls `summaryMoved` ([`code://packages/sdk/src/host/facts.ts#L381-L418`](../../packages/sdk/src/host/facts.ts#L381-L418)).
- `summaryMoved` sends the count the host holds, and reads nothing ([`code://packages/sdk/src/host/catalogue.ts#L596-L604`](../../packages/sdk/src/host/catalogue.ts#L596-L604)).
- `refresh` reads only the uncommitted files ([`code://packages/sdk/src/sessions/changes.ts#L1902-L1912`](../../packages/sdk/src/sessions/changes.ts#L1902-L1912)).
- The watch is on the git directory: the index, `HEAD` and the branch's ref ([`code://packages/sdk/src/sessions/changes.ts#L1914-L1925`](../../packages/sdk/src/sessions/changes.ts#L1914-L1925)).

## Who writes

| Writer | Files | What the change does to it |
|---|---|---|
| `maycxc/host/124-an-agents-shell-is-a-terminal-the-person-sees`, not merged, e7ada61c | `packages/sdk/src/host/snapshots.ts`, +15 −5 | The `state` call at line 231 may conflict |
| The cofold resume build, `build/agents-2c79b19f` | `packages/agent-cofold/` only | None |

The other MayCXC branches and the open PRs do not touch these files.

## The change

- The host passes the bare id to the changes source on every call: `observe`, `state`, `operations`, `checkpoint` and the summaries.
- The checkpoint refs keep their names, so the refs that sessions have now still answer.
- The Session Changes scope then reads the checkpoints, and its counts come from `git diff --numstat`.
- A test creates a session through the host, and checks that the session scope and the row's count read the same checkpoints.
- When `refreshWatched` sees the tree move, the host reads the row's count again with `summaryKept`, not only `summaryMoved`.

For this session, the fixed Session Changes would show 12 files, +564 −101.
That is correct and differs from Branch Changes: the session scope ends at the last turn's checkpoint, and the branch scope is the tree now.

## Open points

- Whether a change to the working tree alone, made outside the host, reaches the watch. `git checkout -- <file>` may not write the index. VS Code watches the repository roots, which would see it.
