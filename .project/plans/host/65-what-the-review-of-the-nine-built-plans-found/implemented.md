---
title: What the review of the nine built plans found is fixed - implemented
date: 2026-10-06
refs:
  - git://0cdbb95
  - "[code://packages/sdk/src/host/admission.ts](../../../../packages/sdk/src/host/admission.ts) - the fail-closed branch, p1"
  - "[code://packages/computer/src/gitdir.ts](../../../../packages/computer/src/gitdir.ts) - what a machine may write in a repository, p2"
  - "[code://packages/sdk/src/fileuri.ts](../../../../packages/sdk/src/fileuri.ts) - every character of a path kept, p3"
  - "[code://packages/computer/src/parts.ts](../../../../packages/computer/src/parts.ts) - a part's tag says what is in it, p4"
  - "[code://packages/sdk/src/nested.ts](../../../../packages/sdk/src/nested.ts) - one inner host at a time, p5"
  - "[code://packages/server/src/commands/options.ts](../../../../packages/server/src/commands/options.ts) - a verb's own flags, and a path that refuses without printing a value, p6"
---

Everything the 2026-10-06 review of nine built plans found, and confirmed in the code, is fixed: a method in neither gate table is refused rather than served, an unsigned client can no longer stop the daemon, a machine can no longer make the host user's next git run its code or reach another repository, the proxy retries only a call that never arrived and answers a provider's key refusal with its own error, a file URI keeps every character of its path and the temp files are private and swept, an image's tag says which parts are in it, a nested session has one inner host at a time, an unreadable `computers.json` is never overwritten, a dev container on a host with users is made only from folders the operator named, a computer is found by the name this host gave it, and the flags and records that said the wrong thing say the right one.

## What was built

Each child's `implemented.md` is the account of its own work, task by task:

- [p1 - the gate and the proxy](../65-what-the-review-of-the-nine-built-plans-found-p1-the-gate-and-the-proxy/implemented.md) - a method in neither table is refused; `shutdown` needs `config:change`; the classification test reads the names the host serves; the proxy retries only a call that never arrived and answers a provider's 401 or 403 with its own error.
- [p2 - a machine's git directory](../65-what-the-review-of-the-nine-built-plans-found-p2-a-machines-git-directory/implemented.md) - the git directory is read-only except what a commit writes; a later session cannot be redirected to another repository; paths are compared real; a root is mounted only where allowed; a lock is removed only when it is the machine's.
- [p3 - file URIs and private files](../65-what-the-review-of-the-nine-built-plans-found-p3-file-uris-and-private-files/implemented.md) - `localPath` keeps a `#` and a `?`; the sdk and the four agents build encoded URIs; the users, policies and automations temp files are swept and private.
- [p4 - an image holds what its tag says](../65-what-the-review-of-the-nine-built-plans-found-p4-parts/implemented.md) - a part's tag covers the Dockerfile generator and the parts the image is missing ([deferred.md](../65-what-the-review-of-the-nine-built-plans-found-p4-parts/deferred.md): npm parts are not reproducible).
- [p5 - nested hosts and dev containers](../65-what-the-review-of-the-nine-built-plans-found-p5-nested-hosts-and-dev-containers/implemented.md) - a restart waits for the old inner host; a session the inner host does not hold is created; a worker chat that will not open is logged; a close during a create disposes what was made; deleting a nested session that is not running is `nestedDelete`; an unreadable `computers.json` is not written over; a host with users makes no dev container until `devcontainer.folders` names the folders; a computer is found by this host's own name.
- [p6 - small CLI and record fixes](../65-what-the-review-of-the-nine-built-plans-found-p6-small-cli-and-record-fixes/implemented.md) - only `user token` takes `--host` and `--port`; `vault set` and `vault delete` refuse `--config-file`; a `--plugin-option` path refuses by key and never prints the value, reads own keys only, and refuses a step into a `$secret`; `createActions` binds no mutable host state; six records name the right function, question, commit and next task.

## Verified

- Every task's case was seen failing on the code before its fix and passing after, except p6's task 04, which the plan's Risks says has nothing to fail first (the stale bindings are read by nothing) and whose check is the grep.
- `npx tsc -b` clean, at every child's close and again at the end. `pnpm boundary` clean: every package's imports are declared, none undeclared.
- `pnpm build` was not run. It rewrites the eight packages' tracked `dist`, which nothing this plan decided asked for, and no child ran it either; the checker and the tests resolve the sources (`tsconfig.json`'s `paths`, `vitest.config.ts`'s aliases), so the gates above are against what is written.
- `pnpm test` for the three packages the review's fixes landed in: `packages/sdk` 106 files, 1496 tests; `packages/server` 38 files, 735 tests; `packages/computer` 17 files, 285 tests. The computer package was run as its checklist names it, with the file parallelism the default gives.
- The four agents: `@ahpd/agent-claude` 22 files, 198 tests; `@ahpd/agent-cofold` 15 files, 187 tests; `@ahpd/agent-acp` 13 files, 174 tests; `@ahpd/agent-pi` 11 files, 163 tests.
- Two gates caught things the task files did not, and both are recorded in the child that hit them: the computer package found the throw p5 task 08 left in `containerOf` (fixed by `undefined` from the lookup and a refusal in the five verbs that act), and the same run found `computer-uptime.test.ts`'s adopted-container case sitting 0.1s under the 5s default (now a 20s cap with its reason in the comment).
- The first full run of the review round found three failures, all of them that round's own leavings rather than a child's work: the p3 peer raise to `@ahpd/sdk >=0.10` left two fixtures encoding the old floor, `computer-devcontainer.test.ts`'s install case (its plugin context version, 0.9.77) and `plugin-compat.test.ts`'s `@ahpd/computer` floor row with the comment above it, and both are 0.10 now; the third was `computer-disposable.test.ts`'s `afterEach` failing with `ENOTEMPTY` on the temp directory its own scripted docker may still be writing to, which passes alone and is now removed with the retries `nested-proxy.test.ts` already uses.
- The review round's own gates, run together after its twelve fixes and those three: `npx tsc -b` clean, `pnpm boundary` clean (every package's imports declared, none undeclared), and `npx vitest run` over the whole repository - 227 files, 3331 tests, all passing.
- The work is uncommitted on `0cdbb95`; nothing was pushed and no daemon was restarted.

## Departures from the plan

- p5 task 08's lookup reads the record before the label rather than the label before the record, which the task's wording names; the rule the task states holds either way, and its Resume and the child's `implemented.md` say why.
- p6 task 03's refusal says the kind of value rather than the value, which the plan decided, and the case that pinned the value was rewritten so that what the message must not contain is asserted.

## Review fixes

Softov's review of 2026-10-06 found twelve things across the six children. Each is fixed in the child that owns it, with the case that failed first named there, and no task status was moved for any of them.

- p1, two behaviours and one record. A provider's 401 or 403 sentence reached the log as it came, with the key it quoted still in it; `refusalWords` now takes four shapes out of the line - a value this call was made with, an `sk-`-prefixed one, a `Bearer` value, and a run of twenty or more token characters after the word `key`. The comment above that branch said the next candidate would be called with the same key, which is not why a refusal is not retried; it gives the decision's own reason now - a key refusal is this host's own configuration, answered with this host's error. And the child's account said four `NEEDS` rows were added where two were.
- p2, one behaviour. A main checkout pinned six names and left two writable that the linked-worktree branch already pins: a machine could rewrite `<gitDir>/worktrees/<sibling>/commondir` to point that sibling at a directory of its own whose `config` sets `core.fsmonitor`, which the host user's next git there runs, and `objects/info/alternates` names where git reads objects from. Both are read-only binds now, so the list is eight; the decision, `docs/COMPUTER.md` and the two mount cases carry them. What is deliberately *not* fixed is named in p2's own Review fixes: a symbolic link a machine plants under the writable `logs/` or `objects/` while it runs stays exposed until host/67 gives a machine's git a git directory of its own.
- p3, two behaviours. `packages/computer` peered `@ahpd/sdk >=0.9` while its plugin reads `ctx.hasUsers`, which only 0.10's context carries, so a host on 0.9 typed against a context without the field. And the `computers.json` writer and the server's vault writer each opened their scratch without removing a leftover first, so an older holder of the pid left a 0644 temp that `mode: 0o600` never applied to - and the vault's temp name was in no sweeper's list, so a vault writer that died left its scratch for good.
- p4, two behaviours. `ensureJoined` asked the ahpd source for its hash whenever the file named an ahpd part, whether or not that part had built, so a checkout with no `pnpm build` threw out of the whole join instead of answering that part missing and making the machine without it. And `packOf` read the tarball at `resolve(file)` rather than at `resolve(into, file)`, so a `pnpm` printing the name alone was looked for in the working directory.
- p5, two behaviours, both in `nested.ts`. A restart could wait for ever on the host it had stopped: `gone` resolved only on the child's `close` and an `error`, and `close` comes only once the pipes have closed, so a machine whose host left a daemon or a background job holding its stdout never reached it. `gone` resolves on `exit` too, and both of the restart's waits are capped at `HANDOVER_WAIT`, `KILL_AFTER` plus a margin, after which the restart is logged as going on without it. And a `close` that arrived while the host inside was still being started returned at once, because `host` is set only when `startInside` answers - so a restart started the new host over the old one. `bringUp()`'s promise is kept and waited for, and the start reads `closed` as soon as it has a process, so the wait ends with the old host already stopping.
- p6, one behaviour and one record. A `--plugin-option` refusal still quoted the flag as typed, `a.presets.x.model=sk-live-9f2c` with the value in it; every refusal about one quotes the path alone now, through `pathOf`, and the flag with nothing before its `=` is refused as an empty path. The child's ref and closing line named `e1c4ccc` where the base commit is `0cdbb95`.

Three of the twelve have no case, which is what the review allowed for record and comment fixes: p1's row count and p6's commit are records, and p1's comment is a comment. The redaction then left `npx tsc -b` failing on a candidate's optional `key`, and p1's Review fixes records it as the one fix of this round that is a type rather than a behaviour.

## Left for later

- The reviewed plans' task statuses: they are set `done` once this plan is reviewed, as decision `A reviewed plan's task statuses are not moved by this plan` (the plan's second table) says. Every task this plan built is `implemented` and awaits Softov's review.
