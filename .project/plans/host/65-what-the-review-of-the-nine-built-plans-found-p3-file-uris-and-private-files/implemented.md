---
title: A file URI keeps every character of its path, and every temp file is private and swept - implemented
date: 2026-10-06
refs:
  - "[code://packages/sdk/src/fileuri.ts](../../../../packages/sdk/src/fileuri.ts)"
  - "[code://packages/sdk/src/index.ts](../../../../packages/sdk/src/index.ts)"
  - "[code://packages/server/src/daemon.ts](../../../../packages/server/src/daemon.ts)"
  - "[code://packages/server/src/commands/run.ts](../../../../packages/server/src/commands/run.ts)"
  - "[code://packages/sdk/src/policies.ts](../../../../packages/sdk/src/policies.ts)"
  - "[code://packages/sdk/src/scheduled.ts](../../../../packages/sdk/src/scheduled.ts)"
  - "[code://packages/sdk/src/users.ts](../../../../packages/sdk/src/users.ts)"
---

A folder whose name holds `#` or `?` is the same folder on both sides of the wire, so no command runs in a shorter path: `localPath` reads both characters back and `uriOf` writes them encoded, the sdk exports both, and every builder of a `file:` URI in the sdk and in the four agents is `uriOf` now. The temp files beside the users, policies and automations files are no longer readable by anybody but the account the daemon runs as, and the scratch of a writer that died is cleared at the daemon's start rather than staying forever.

## What was built

- [`code://packages/sdk/src/fileuri.ts`](../../../../packages/sdk/src/fileuri.ts) - `localPath` escapes a literal `#` and `?` to `%23` and `%3F` before the one reader both shapes share, so `C#` and `x?y` decode back to themselves instead of to the folder above them.
- [`code://packages/sdk/src/index.ts`](../../../../packages/sdk/src/index.ts) - `localPath` and `uriOf` are exported, which is what the four agents import.
- Every builder of a `file:` URI in the sdk is `uriOf(...)`: `terminals.ts`, `changes.ts` (four, one of them the key an observe deletes from a reviewed set), `nested.ts`, `debuglogs.ts` (two), `host/vscodemethods.ts` (two), `host/facts.ts` (two), `host/handshake.ts`, `host/spawn.ts`, `host/snapshots.ts`, `host/lifecycle.ts`. `host/sessionmethods.ts` keeps the directory itself as the fallback rather than a URI built to be read straight back.
- The same in the four agents, twenty sites: `agent-claude` (`session.ts` three, `catalog.ts`, `session/customizations.ts` two), `agent-pi` (`session.ts` two, `catalog.ts` two), `agent-acp` (`session.ts` two, `catalog.ts` two, `mapping.ts`) and `agent-cofold` (`session.ts` two, `agent.ts`). `agent-claude/src/input.ts` encodes on its own and was left.
- The four agents' `peerDependencies["@ahpd/sdk"]` and the eight workspace `version`s: `>=0.9` became `>=0.10` and 0.9.0 became 0.10.0, the release that exports `uriOf` being the number Softov answered (0.10.0) - see the answer's row in [plan.md](plan.md). The bump moved what reads a range rather than names one: `plugin-hello` and `plugin-alike` went to `^0.10.0`, `plugin-incompatible` to `^0.11.0`, and the two cases asserting those ranges by name with them. `plugin-compat.test.ts`'s floor table is `>=0.10` for the four agents, and its last line asks whether this workspace's own sdk satisfies each floor rather than whether 0.9.0 does.
- [`code://packages/server/src/daemon.ts`](../../../../packages/server/src/daemon.ts) - `sweepTemps(beside)` takes the files to clear scratch beside and matches `<that file>.<pid>.tmp` in each one's own directory, for a pid that is gone; `claim` sweeps the daemon's own record as it did.
- [`code://packages/server/src/commands/run.ts`](../../../../packages/server/src/commands/run.ts) - `wholeFiles(users)` is the users file the operator gave plus `policiesPath()`, `automationsPath()`, `computers.json` and `vaultPath()` under the configuration directory, and the daemon's start sweeps all five. The vault joined the list in review.
- [`code://packages/sdk/src/policies.ts`](../../../../packages/sdk/src/policies.ts), [`code://packages/sdk/src/scheduled.ts`](../../../../packages/sdk/src/scheduled.ts) and [`code://packages/sdk/src/users.ts`](../../../../packages/sdk/src/users.ts) - each removes its temp before writing it, so `mode: 0o600` is applied to a file it creates rather than to one an older writer left readable.
- `.project/plans/host/58-private-files-refused-cursors-and-decoded-file-uris/implemented.md` - says its readers decode and that the writers were this plan's, and no longer claims a test shows two writers at once leaving the file whole.

## Verified

- `npx tsc -b` clean. `npm run boundary` clean. `npx vitest run packages/sdk` 106 files and 1489 tests passed; `packages/server` 38 files and 732 tests; `packages/agent-claude`, `agent-pi`, `agent-acp` and `agent-cofold` 61 files and 722 tests.
- `fileuri.test.ts`, `host-terminals.test.ts`, `changes-uris.test.ts`: `localPath('file:///home/u/src/C#/app')` is that path, `localPath('file:///a/b?c')` is `/a/b?c`, a round trip keeps a path holding `#` and `?`, a terminal created in `<tmp>/C#/app` reports the encoded `cwd` and reads back as that folder, and a session in `<tmp>/C#/app` with no working directory given has its uncommitted changeset at that folder. Each was seen failing first (`state.changesets` undefined on the unescaped reader).
- One case per agent, a session started in a folder called `C# a b` reporting `workingDirectories` `[uriOf(where)]`: `agent-claude/test/uris.test.ts` (new), `agent-pi/test/agent-pi.test.ts`, `agent-acp/test/agent-acp-catalog.test.ts`, `agent-cofold/test/agent-cofold-store.test.ts`. All four read `file:///…/C# a b` against `file:///…/C%23%20a%20b` before the replacement.
- `rg -n '\`file://\$\{' packages/agent-*/src` finds only `agent-claude/src/input.ts:186`, and nothing at all in `packages/sdk/src`.
- `daemon.test.ts`: a real daemon over `--stdio` in a temporary configuration directory, with the scratch of four gone writers beside their files, a live writer's, `users.json.tmp` with no pid and `notes.json.7.tmp` for a file the daemon does not write - the four are removed and the other three stay. Seen failing first with the sweep taken out (`expected true to be false`).
- `policies.test.ts`, `scheduled.test.ts`, `users.test.ts`: a `<file>.<pid>.tmp` at `0644` before the save leaves the file `0600`. All three read `expected 420 to be 384` first.
- `plugin-compat.test.ts`, `plugin-list.test.ts`, `plugin-load.test.ts`, `plugin-options.test.ts`: the four agents' floor is read out of their own manifests and is `>=0.10`, `sdkVersion()` satisfies every floor on the table, and the two fixtures that must load do. All 63 passed. `packages/sdk/test/nested-proxy.test.ts`'s restart case failed once under the whole-package load, counting one ask more than it expected; it passes alone and on the next full run, and nothing here touches what it counts.

## Departures from the plan

- The scheduled store writes one change twice - once when the clock is caught up, once with the stamp - so its case puts the readable temp back from an `onChanged` listener, between the two. Read straight after `create` the file is `0600` whatever the first write left, because the second write's own temp is fresh.
- The sweeper's case is a real daemon as a process rather than a call to `sweepTemps`, because what task 04 is about is the daemon's start and the four paths it knows there. It needs the `plugin-echo` fixture, since a host with no backend refuses to start.

## Review fixes

- `packages/computer/package.json` peered `@ahpd/sdk >=0.9` while [`code://packages/computer/src/plugin.ts`](../../../../packages/computer/src/plugin.ts) reads `ctx.hasUsers`, which only 0.10's plugin context carries: a host on 0.9 would typecheck against a context that has no such field. It is `>=0.10` now, as the four agents' are. `packages/tunnel-devtunnel` still names `>=0.8`, and was left: it reads nothing this plan added.
- The `computers.json` writer in the computer package and the vault writer in the server each opened their scratch without removing a leftover first. `mode` is applied when a file is created rather than when one is opened, so a temp a former holder of this pid left at 0644 keeps that mode and the rename puts it on the file. Both `rmSync` first now, as the sdk's three writers do, and each has a case: `writes the file private even when a readable scratch at its own name was left behind` in `computer-owner.test.ts` and `writes the file private even when a readable temp at its own name was left behind` in `vault-file.test.ts`. Both read `expected 420 to be 384` before, the same assertion the sdk's three cases make.
- The vault's temp was in no sweeper's list, so a vault writer that died left its scratch for good. `wholeFiles` names `vaultPath()` now and the daemon's start sweeps five files; `daemon.test.ts`'s sweep case has the vault's scratch among the ones a gone writer left, and it failed first with `expected true to be false` - the vault's temp still there after the daemon's start.

## Left for later

- Nothing this plan set aside: the one thing that waited, the four `@ahpd/sdk` peer ranges, was answered the same day and is in the workspace now.
