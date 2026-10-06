---
title: What the review of the nine built plans found is fixed
domain: host
status: planned
priority: high
created: 2026-10-06
revalidated: 2026-10-06
requires:
  - plans/host/48-host-is-split-by-area-p9-the-method-table/plan.md
  - plans/host/48-host-is-split-by-area-p10-action-dispatch/plan.md
  - plans/host/48-host-is-split-by-area-p11-open-plans-cite-the-new-files/plan.md
  - plans/container/05-an-agent-in-a-machine-p7-a-worktree-brings-its-repository/plan.md
  - plans/container/05-an-agent-in-a-machine-p3-parts-are-built-from-one-versions-file/plan.md
  - plans/host/58-private-files-refused-cursors-and-decoded-file-uris/plan.md
  - plans/container/04-a-cofold-session-in-a-computer/plan.md
  - plans/container/03-a-dev-container-is-a-computer/plan.md
  - plans/proxy/02-the-proxy-serves-a-persons-model-calls/plan.md
  - plans/daemon/15-a-verb-declares-only-its-own-flags/plan.md
  - plans/daemon/12-a-plugin-option-is-set-from-the-command-line/plan.md
decisions:
  - decisions/shutdown-needs-config-change.md
  - decisions/a-machines-git-directory-is-read-only-but-what-a-commit-writes.md
  - decisions/dev-containers-need-allowed-folders-on-a-host-with-users.md
  - decisions/the-proxy-answers-a-providers-key-refusal-with-its-own-error.md
refs:
  - git://ca6adcb - host/48 p9-p11
  - git://b677360 - container/05 p7
  - git://269649c - container/05 p7, its handoff
  - git://4b16d32 - container/05 p3
  - git://6de1208 - host/58
  - git://a5d682b - container/04, first half
  - git://1931127 - container/04 tasks 07-17
  - git://52f98f6 - container/03
  - git://3e93f6a - proxy/02
  - git://b6485b1 - daemon/15
  - git://7279780 - daemon/12
---

## Goal

What the 2026-10-06 review of nine built plans found, and was confirmed in the code, is fixed, each with a test that fails before the fix.
The worst of it: an unsigned client can stop the daemon, and a machine can make the host user's next git run its code.
The rest are a proxy that sends a call twice, file URIs that lose a `#`, images reused without the part they lack, nested hosts that race, a file overwritten after a failed read, and flags and records that say the wrong thing.

## Reconnaissance

Each child plan holds its own refs, searches and gaps.
Every finding was read in the code at `e1c4ccc` before its task was written; where the reviewer's line was off, the task carries the line as it is now.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [A client's `shutdown` needs `config:change`, and the root connection always may](../../../decisions/shutdown-needs-config-change.md) | Softov, 2026-10-06, "A host admin grant"; the grant's name defaulted to match `ahpd restart` (p1) |
| 2 | [A machine's git directory is read-only, except the objects, refs and logs a commit writes and the session's own worktree entry](../../../decisions/a-machines-git-directory-is-read-only-but-what-a-commit-writes.md) | Softov, 2026-10-06, "Allowlist writable"; the list defaulted from what git writes (p2) |
| 3 | [On a host with a users directory, no dev container is made until `devcontainer.folders` is set](../../../decisions/dev-containers-need-allowed-folders-on-a-host-with-users.md) | Softov, 2026-10-06, "Required with users" (p5) |
| 4 | [The proxy answers a provider's 401 or 403 with its own error, and the provider's words go to the log](../../../decisions/the-proxy-answers-a-providers-key-refusal-with-its-own-error.md) | Softov, 2026-10-06, "The proxy's own error"; the status defaulted to 502 (p1) |

| What | Source | Task |
| --- | --- | --- |
| Fix what the review confirmed, one parent with a child per area | Softov, 2026-10-06, the request for this plan | all |
| A reviewed plan's task statuses are not moved by this plan; they are set `done` once host/65 is reviewed | Softov, 2026-10-06, the request for this plan | - |
| npm parts are not reproducible: deferred, not a task | Softov, 2026-10-06, the request for this plan | p4 |

### Which plan each finding comes from

| From | Finding | Child, task |
| --- | --- | --- |
| host/48 p9 | `shutdown` and `getManagedSettingsDiagnostics` are classified nowhere, and a method in neither table is admitted | p1, 01 and 02 |
| host/48 p10 | `createActions` destructures mutable `ctx` fields at factory time | p6, 04 |
| host/48 p11 | a ref note names `onDue`, where the function is `due` | p6, 05 |
| container/05 p7 | the git directory is writable but four parts; a `commondir` the agent writes is run by host git | p2, 01 |
| container/05 p7 | a later session's git directory can be redirected to another repository | p2, 02 |
| container/05 p7 | a repository root is mounted where only the folder was allowed | p2, 04 |
| container/05 p7 | a symlinked root session leaves `.git` writable | p2, 03 |
| container/05 p7 | `.git` in a root session can be moved aside and replaced | p2, 01 |
| container/05 p7 | `releaseLock` can remove a lock host git holds | p2, 05 |
| container/05 p3 | the joined image's tag ignores the parts missing from it | p4, 01 |
| container/05 p3 | a part's tag ignores the Dockerfile generator | p4, 02 |
| container/05 p3 | a failed pack is cached until restart, and its temp directory stays | p4, 03 |
| container/05 p3 | `parts-bump.mjs` writes unchecked values and proposes prereleases | p4, 04 |
| host/58 | `localPath` drops `#` and `?`, and agents still build unencoded URIs | p3, 01 and 03 |
| host/58 | the sdk still builds unencoded URIs | p3, 02 |
| host/58 | the users, policies and automations temp files are never swept | p3, 04 |
| host/58 | a stale temp file keeps its mode | p3, 05 |
| host/58 | `implemented.md` claims every URI is encoded and that two writers at once are tested | p3, 06 |
| container/04 | a restart starts a new inner host while the old one runs | p5, 01 |
| container/04 | a session with nothing inside is resumed rather than created | p5, 02 |
| container/04 | a worker chat that fails to open rejects unhandled | p5, 03 |
| container/04 | a close during `createSession` leaves an inner session behind | p5, 04 |
| container/04 | deleting a nested session that is not running keeps the inner transcript | p5, 05 |
| container/04 | `plan.md` and task 09 point at a question already answered | p6, 05 |
| container/03 | an unreadable `computers.json` is overwritten with nothing | p5, 06 |
| container/03 | dev containers with `folders` unset on a host with users | p5, 07 |
| container/03 | a computer is looked up by raw id before its label | p5, 08 |
| container/03 | `implemented.md` names `ae250ef` | p6, 05 |
| proxy/02 | every fetch failure is retried, a call the provider received included | p1, 03 |
| proxy/02 | a provider's 401 or 403 reaches the caller unchanged | p1, 04 |
| proxy/02 | `implemented.md` names `2cb298d` | p6, 05 |
| daemon/15 | `user list`, `rm`, `member`, `primary` and `add` take `--host` and `--port` and read neither | p6, 01 |
| daemon/15 | `vault set` and `vault delete` take `--config-file` and read it by nothing | p6, 02 |
| daemon/12 | a refused path prints the value it ran into; it can descend into a `$secret`; it reads inherited keys | p6, 03 |

## Tasks

| Child plan | Status | Depends on |
| --- | --- | --- |
| [p1 - The gate refuses a method it does not know, and the proxy sends a call once](../65-what-the-review-of-the-nine-built-plans-found-p1-the-gate-and-the-proxy/plan.md) | planned | - |
| [p2 - A machine cannot change what git on the host runs, or reach another repository](../65-what-the-review-of-the-nine-built-plans-found-p2-a-machines-git-directory/plan.md) | planned | - |
| [p3 - A file URI keeps every character of its path, and every temp file is private and swept](../65-what-the-review-of-the-nine-built-plans-found-p3-file-uris-and-private-files/plan.md) | planned | - |
| [p4 - An image holds what its tag says](../65-what-the-review-of-the-nine-built-plans-found-p4-parts/plan.md) | planned | - |
| [p5 - A nested host has one process per session, and a dev container is made only where it is allowed](../65-what-the-review-of-the-nine-built-plans-found-p5-nested-hosts-and-dev-containers/plan.md) | planned | - |
| [p6 - Each verb takes only what it reads, and the records name the right things](../65-what-the-review-of-the-nine-built-plans-found-p6-small-cli-and-record-fixes/plan.md) | planned | - |

## Risks and tradeoffs

- p2 changes what a machine may write in a repository; a main checkout's root is writable with six paths pinned, and a new file an agent makes there is the residual risk the decision names.
- p3 spans the sdk and four agent packages, for one replacement per agent; it is kept as one child because splitting it per agent makes four one-line plans.

## Resume state

- **Done so far:** nothing.
- **Next action:** p1, the gate; then p2. The others are independent.
- **Open questions:** none.
- **Watch out for:** every task starts with a test that fails on the code before it; a fix with no failing test first is not done. The reviewed plans' task statuses stay as they are until this plan is reviewed.

## Final verification checklist

- [ ] Every child's tasks done, each with its failing case first.
- [ ] `pnpm typecheck`, `pnpm boundary`, `pnpm test`, `pnpm build` pass.
- [ ] `plans/index.md` updated.
