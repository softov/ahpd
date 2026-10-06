---
title: Worktrees can live under one root - implemented
date: 2026-10-06
refs:
  - git://cff0471b157c6f0e3ab00932e260b6dc94c2e227
  - "[code://packages/sdk/src/repo/worktrees.ts](../../../../packages/sdk/src/repo/worktrees.ts) - `worktreesOf`, which now takes the root"
  - "[code://packages/sdk/src/types/host.ts](../../../../packages/sdk/src/types/host.ts) - `worktreesRoot` on the host's options"
  - "[code://packages/server/src/commands/options.ts](../../../../packages/server/src/commands/options.ts) - the `worktreesRoot` field and where the fold resolves it"
  - "[code://packages/server/src/commands/run.ts](../../../../packages/server/src/commands/run.ts) - the option handed to `createHost`"
---

A daemon can be told one folder to keep every session worktree in, as `worktreesRoot` in `config.json` or `--worktrees-root <dir>`, and a session with `isolation: worktree` gets its tree at `<root>/<repo>/<name>` rather than at `<repo>.worktrees/<name>` beside its repository. Told no root, nothing changed: the tree is where the reference host puts it, and a relative root in a file is read against the folder of that file while one on the command line is read against the working directory.

## What was built

- [`code://packages/sdk/src/repo/worktrees.ts`](../../../../packages/sdk/src/repo/worktrees.ts) - `worktreesOf(repository, root?)`: `<root>/<repo>` when a root is given, `<repo>.worktrees` beside the repository otherwise. The doc comment keeps why the default is beside and named as the reference names it, and says the root is this host's departure from it, citing the decision. The second parameter is optional, so the one-argument form the sdk exports keeps working.
- [`code://packages/sdk/src/types/host.ts`](../../../../packages/sdk/src/types/host.ts) - `HostOptions.worktreesRoot?: string`, an absolute folder every session tree goes under, meaningless without `worktrees`.
- [`code://packages/sdk/src/host/lifecycle.ts`](../../../../packages/sdk/src/host/lifecycle.ts) - `isolated` passes `options.worktreesRoot` to `worktreesOf`. Nothing else in the path changed: `create` already runs `mkdir(dirname(path), { recursive: true })` before `git worktree add`, so `<root>/<repo>` is made for a session the root has never been told about.
- [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - the unused `worktreesOf`/`worktreeFor` import is gone.
- [`code://packages/server/src/commands/options.ts`](../../../../packages/server/src/commands/options.ts) - `serverFields.worktreesRoot`, a string with `cli: { value: 'DIR' }`, in neither `FILE_ONLY` nor `TYPED_ONLY`, so it is a flag and a configuration key at once. `Options.worktreesRoot` and the fold below it answer it whole through `resolve`, which is this key's one difference from `paths`.
- [`code://packages/server/src/config.ts`](../../../../packages/server/src/config.ts) - `Config.worktreesRoot`, and `anchored` takes it with `users` and `connectionTokenFile`: a relative value in a file is made absolute against the folder of the file that set it.
- [`code://packages/server/src/commands/run.ts`](../../../../packages/server/src/commands/run.ts) - the root spread into the `base` host options only when it is set, beside `gitWorktrees()`.
- [`code://packages/sdk/README.md`](../../../../packages/sdk/README.md), [`code://docs/DAEMON.md`](../../../../docs/DAEMON.md) and [`code://docs/AHP.md`](../../../../docs/AHP.md) - the option row, the flag row, the anchoring sentence, and where a new tree is made.

## Verified

- `packages/sdk/test/worktrees.test.ts`, 31 tests: the new case puts a session's tree at `<root>/<repo>/<name>` and checks `git worktree list` names it; the 30 already there, all of them against `<repo>.worktrees`, are unchanged and pass. It failed first, receiving `<root>/project.worktrees/rooted` where it expects `<root>/project/rooted`.
- `packages/server/test/config-layers.test.ts`, 17 tests: a root in `$AHPD_CONFIG` resolves against that file's folder, one typed on the line against the working directory, an absolute one stays as it is, and absent stays absent. The first two failed first, both answering `undefined`, because no such key existed.
- `pnpm typecheck` and `pnpm boundary` pass. `pnpm build` passes.
- `pnpm test` **fails**, and not for this plan's sake. Two runs: the first, 222 files and 3216 tests with 13 failed across 9 files; the second, the same 222 files and 3216 tests with 4 failed across 4 files, a different and smaller set. Every failure is `Test timed out in 5000ms` in `packages/computer/*`, `packages/agent-acp/*`, `packages/sdk/test/nested-start.test.ts` or `packages/server/test/vault-port.test.ts`, and every one of those files passes when run on its own or in a small group - `packages/computer/test/computer-needs.test.ts` 55 passed alone, the four files of the second run's set 109 passed together, `nested-start.test.ts` 3 passed alone, `vault-port.test.ts` 2 passed alone. The machine has eight cores and the suite is several times oversubscribed, so the set that times out moves between runs. No failure is in a file this plan touches.
- Not run: the by-hand check in task 02's Validation, `ahpd --worktrees-root ...` with a live session. It starts a daemon, which this work was told not to do outside the tests. The tree's path is covered by the sdk case above and the daemon's reading of the key by the options cases; the wiring between the two, `run.ts` handing the option to `createHost`, is held by `pnpm typecheck` alone.

## Departures from the plan

- none. The plan's second table row `(defaulted: named after the sdk option, in the shape of paths)` is what was built, and so is the row about a relative root.

## Left for later

- `worktreesRoot` is not in `rootconfig.ts`'s `DAEMON_KEYS`, so a client holding `config:read` is not shown it and one holding `config:write` cannot edit it. The plan's task 02 named `serverFields`, `run.ts` and the two documents and did not name root config, and putting a key there is a decision about a live setting versus one that waits for a restart; it is left as it is and said here rather than decided.
- `packages/server/src/main.ts`'s help paragraph lists the keys a flag can also be, and it was already short of five of them before this plan. `worktreesRoot` is not added to it, since completing that list is not what this plan is about.
