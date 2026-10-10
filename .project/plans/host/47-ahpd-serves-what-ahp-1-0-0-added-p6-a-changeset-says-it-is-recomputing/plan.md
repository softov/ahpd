---
title: A changeset being recomputed says so, and keeps its files
domain: host
status: built
priority: low
created: 2026-10-03
revalidated: 2026-10-04
requires:
  - plans/host/47-ahpd-serves-what-ahp-1-0-0-added/plan.md
  - plans/host/44-ahpd-speaks-ahp-1-0-0-p1-ahpd-speaks-1-0-0-and-0-9-0/plan.md
refs:
  - "[code://packages/sdk/src/host/changesets.ts#L198](../../../../packages/sdk/src/host/changesets.ts#L198) - `shown`, what every watcher of a changeset was last told, status included"
  - "[code://packages/sdk/src/host/changesets.ts#L219-L257](../../../../packages/sdk/src/host/changesets.ts#L219-L257) - `told`, which sends `changeset/statusChanged` when the status moved and the smallest file update"
  - "[code://packages/sdk/src/host/changesets.ts#L268-L282](../../../../packages/sdk/src/host/changesets.ts#L268-L282) - `contentMoved`: reads the changeset again and says nothing until the read is back"
  - "[code://packages/sdk/src/host/facts.ts#L293-L304](../../../../packages/sdk/src/host/facts.ts#L293-L304) - a git change outside the host, one of `contentMoved`'s callers"
  - "[code://packages/sdk/src/changes.ts#L883-L910](../../../../packages/sdk/src/changes.ts#L883-L910) - `state` answers `ready` with the files, for every scope"
  - "[code://packages/sdk/test/changes-refresh.test.ts#L168-L222](../../../../packages/sdk/test/changes-refresh.test.ts#L168-L222) - a real git repository in a temp directory, re-read on an outside change, a write and a tool call"
  - "npm://@microsoft/agent-host-protocol@1.0.0 - `ChangesetStatus.Recomputing`: `files` remains the previous completed result while recomputation runs, an empty one included; `ChangesetStatus` is `@nonexhaustive` (`channels-changeset/state.ts:105-125`); `changeset/statusChanged` covers `recomputing -> ready` (`channels-changeset/actions.ts:18-30`)"
  - "https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/agentHostChangesetService.ts#L1545-L1555 - VS Code says `recomputing` when the changeset has a completed result and `computing` when it has none, before it computes"
  - "https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/agentHostChangesetService.ts#L1774-L1788 - and puts the previous status back when a refresh publishes no result"
---

## Goal

A client watching a changeset sees when ahpd starts reading it again and when it is done, while the files it already has stay on screen, as VS Code's agent host shows it.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "'computing'|'ready'|changeset/statusChanged" packages/sdk/src` - every read answers `ready`; `changeset/statusChanged` is sent only by `told`, after the read, so a client never sees a changeset being read.
- `rg -n "ChangesetStatus\.(Recomputing|Computing)" src/vs/platform/agentHost` in the VS Code clone, generated protocol excluded - the mark before a compute and the restore after one that published nothing.

### Gaps

- No status is said while a changeset is re-read, which on a large repository is seconds.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| Before a re-read of a changeset whose watchers were told a finished result, `changeset/statusChanged` with `recomputing`; the read's result moves it on as today | AHP 1.0.0 `ChangesetStatus.Recomputing`; VS Code `agentHostChangesetService.ts:1545-1555` | 01 |
| A re-read that gives no result puts the previous status back | VS Code `_restoreStaticChangesetStatus` | 01 |
| `computing` for a first read is not added: a first read is answered as a snapshot after it finishes, and nothing watches before that | (defaulted: no watcher exists to tell) | - |
| `recomputing` goes to a 0.9.0 connection too | `changeset/statusChanged` is an old action, `ChangesetStatus` is `@nonexhaustive`, and VS Code sends it to every client | 01 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A changeset says recomputing while it is read again](task-01-a-changeset-says-recomputing-while-it-is-read-again.md) | done | - |

## Risks and tradeoffs

- Every re-read sends two more actions per watched changeset; a re-read already sends at least one when anything moved, and VS Code pays the same.

## Resume state

- **Done so far:** task 01, implemented 2026-10-09. `contentMoved` says `changeset/statusChanged` with `recomputing` before a re-read whose watchers already hold a result. The files stay as they are through the read, and the read moves them on as today. A read that gives nothing or throws puts the previous status back. `docs/AHP.md` says so under `changeset/statusChanged`.
- **Next action:** none; see [implemented.md](implemented.md).
- **Open questions:** none.
- **Watch out for:** `told` treats a status change with the same files as the whole update; after a `recomputing`, an unchanged read must still send `ready`, which it does because `shown` now says `recomputing`. `packages/sdk/test/operations.test.ts` has an expectation that changed with this, because the operation path re-reads through `contentMoved` too.

## Final verification checklist

- [ ] A watched changeset re-read on an outside git change sends `recomputing`, then `ready`, with the files unchanged in between.
- [ ] `pnpm test` passes.
- [ ] `plans/index.md` updated.
