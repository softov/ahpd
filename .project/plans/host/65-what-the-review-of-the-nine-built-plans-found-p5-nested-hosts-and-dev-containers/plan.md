---
title: A nested host has one process per session, and a dev container is made only where it is allowed
domain: host
status: planned
priority: high
created: 2026-10-06
revalidated: 2026-10-06
requires:
  - plans/host/65-what-the-review-of-the-nine-built-plans-found/plan.md
  - plans/container/04-a-cofold-session-in-a-computer/plan.md
  - plans/container/03-a-dev-container-is-a-computer/plan.md
decisions:
  - decisions/dev-containers-need-allowed-folders-on-a-host-with-users.md
  - decisions/a-nested-session-resumes-its-inner-transcript-by-id.md
  - decisions/a-nested-host-is-configured-by-the-machine-profile-only.md
refs:
  - "[code://packages/sdk/src/host/lifecycle.ts#L409-L470](../../../../packages/sdk/src/host/lifecycle.ts#L409-L470) - a restart: the chats closed, `talking` from `agentId()`, then `spawn`"
  - "[code://packages/sdk/src/nested.ts#L511-L548](../../../../packages/sdk/src/nested.ts#L511-L548) - `openWorker`"
  - "[code://packages/sdk/src/nested.ts#L560-L569](../../../../packages/sdk/src/nested.ts#L560-L569) - `opensWorker`, which starts it with `void`"
  - "[code://packages/sdk/src/nested.ts#L756-L772](../../../../packages/sdk/src/nested.ts#L756-L772) - `createSession` skipped on resume, and the refusal when the inner host has none"
  - "[code://packages/sdk/src/nested.ts#L817](../../../../packages/sdk/src/nested.ts#L817) - `agentId`, always the session id"
  - "[code://packages/sdk/src/nested.ts#L964-L983](../../../../packages/sdk/src/nested.ts#L964-L983) - `close`, which returns at once"
  - "[code://packages/sdk/src/host/lifecycle.ts#L342-L381](../../../../packages/sdk/src/host/lifecycle.ts#L342-L381) - `removeSession`"
  - "[code://packages/computer/src/owners.ts#L124-L153](../../../../packages/computer/src/owners.ts#L124-L153) - `read`, which answers `{}` for a file it cannot read"
  - "[code://packages/computer/src/owners.ts#L164-L178](../../../../packages/computer/src/owners.ts#L164-L178) - `write`"
  - "[code://packages/computer/src/plugin.ts#L443-L454](../../../../packages/computer/src/plugin.ts#L443-L454) - `devcontainer.folders`"
  - "[code://packages/computer/src/plugin.ts#L481-L490](../../../../packages/computer/src/plugin.ts#L481-L490) - `folderFor`"
  - "[code://packages/sdk/src/types/plugin.ts#L95-L117](../../../../packages/sdk/src/types/plugin.ts#L95-L117) - the plugin context, which says nothing of a users directory"
  - "[code://packages/computer/src/plugin.ts#L104-L110](../../../../packages/computer/src/plugin.ts#L104-L110) - `secretUnreadable` in the profile schema, the two-valued key `nestedDelete` sits beside"
  - "[code://packages/computer/src/runtime.ts#L1752-L1762](../../../../packages/computer/src/runtime.ts#L1752-L1762) - `containerOf`"
---

## Goal

A nested session that restarts has one inner host at a time and keeps its conversation, a session with nothing inside yet is created there rather than resumed, and nothing in a nested session can take the daemon down or leave an orphan inside.
A computers file that cannot be read is never overwritten, a host where people sign in makes no dev container until its operator names the folders, and a computer is found by its own label before any other container's name.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "unhandledRejection" packages/*/src` - nothing; an unhandled rejection ends the daemon.
- `rg -n "chat.close\(\)" packages/sdk/src/host/lifecycle.ts` - the restart closes each chat at 411 and spawns at 462 without waiting.
- `rg -n "users" packages/sdk/src/types/plugin.ts` - the plugin context has no word on a users directory.

### Gaps

- `close` returns at once and the old inner host lives up to `DISPOSE_WAIT` plus `KILL_AFTER`, while the restart has already started the new one on the same session, and the old one's `disposeSession` is sent for the inner session the new one is resuming (finding E1).
- `agentId()` is the session id from the start, so a restart before the first turn resumes a session the inner host never persisted (E2).
- `subagent(...)` in `openWorker` runs after an `await` and outside the `try` (E3).
- `close` during `createSession` shuts the host down without disposing what it made (E4).
- Deleting a nested session that is not running deletes the outer record only (E5).
- `read` answers `{}` for a file it could not read, and the next write drops every record (F1).
- `containerOf` asks `docker inspect <id>` before the label, so any container, image or volume with that name is taken for the computer, and `remove` runs `rm -f` on it (F3).

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [On a host with a users directory, no dev container is made until `devcontainer.folders` is set](../../../decisions/dev-containers-need-allowed-folders-on-a-host-with-users.md) | Softov, 2026-10-06, "Required with users" |
| 2 | [A nested session resumes its inner transcript by id](../../../decisions/a-nested-session-resumes-its-inner-transcript-by-id.md) | container/04, the decision task 01 keeps |

| What | Source | Task |
| --- | --- | --- |
| A restart stops the inner host without disposing its session, and waits until it is gone; a removal disposes it | the review, container/04; decision 2 | 01 |
| Resume only a session the inner host holds, else create it | the review, container/04 | 02 |
| `computers.json` that could not be read is not written over; the write is refused and logged | the review, container/03 | 06 |
| Deleting a nested session that is not running is a profile setting, `nestedDelete`: `inside` (the default) starts the inner host in its machine when the machine is there and deletes the inner copy too; `record` deletes the outer record only. The name is `(defaulted: a profile key beside secretUnreadable, since a nested host is configured by its machine's profile only)` | Softov, 2026-10-06, asked "A nested session that is not running is deleted: start its inner host to delete the inner copy, or delete the outer record only?": "configurable?", his standing preference that two valid ways become an option | 05 |
| A computer is looked up by its label first, and by raw id only when the container carries this plugin's label | the review, container/03 | 08 |

## Proposed architecture

- **Layer responsibilities** - sdk: 01-05 (`nested.ts`, `host/lifecycle.ts`), and the plugin context field 07 needs · computer: 06-08 (`owners.ts`, `plugin.ts`, `runtime.ts`).
- **Source-of-truth files** - [`code://packages/sdk/src/nested.ts`](../../../../packages/sdk/src/nested.ts), [`code://packages/computer/src/plugin.ts`](../../../../packages/computer/src/plugin.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A restart waits for the old inner host and keeps its session](task-01-a-restart-waits-for-the-old-inner-host.md) | todo | - |
| [02 - A session the inner host does not hold is created, not resumed](task-02-a-session-the-inner-host-does-not-hold-is-created.md) | todo | 01 |
| [03 - A worker chat that will not open is logged, not thrown](task-03-a-worker-chat-that-will-not-open-is-logged.md) | todo | - |
| [04 - A close during create disposes what was made](task-04-a-close-during-create-disposes-what-was-made.md) | todo | 01 |
| [05 - Deleting a nested session that is not running](task-05-deleting-a-nested-session-that-is-not-running.md) | todo | 01 |
| [06 - An unreadable computers file is not overwritten](task-06-an-unreadable-computers-file-is-not-overwritten.md) | todo | - |
| [07 - A host with users makes dev containers only from named folders](task-07-a-host-with-users-makes-dev-containers-only-from-named-folders.md) | todo | - |
| [08 - A computer is found by its label first](task-08-a-computer-is-found-by-its-label-first.md) | todo | - |

## Risks and tradeoffs

- Task 01 makes a restart of a nested session take as long as the old inner host takes to stop, bounded by `KILL_AFTER`.
- Task 07 stops dev containers on a host that has a users file and no `folders`, at its next start; the refusal names the option.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-a-restart-waits-for-the-old-inner-host.md](task-01-a-restart-waits-for-the-old-inner-host.md).
- **Open questions:** none.
- **Watch out for:** the nested cases run a real child in `nested-process.test.ts`; a timing case needs the old process's exit, not a sleep.

## Final verification checklist

- [ ] Each task's case fails on the code before it and passes after.
- [ ] `pnpm exec vitest run packages/sdk/test/nested-*.test.ts packages/computer/test/computer-*.test.ts` passes.
- [ ] `docs/COMPUTER.md` says what a host with users needs for dev containers.
- [ ] `plans/index.md` updated.
