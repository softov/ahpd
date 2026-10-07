---
title: The host declares workspaceTrust, keeps it per connection, and asks before a session moves - implemented
date: 2026-10-06
refs:
  - git://fb1f022
  - "[code://packages/sdk/src/host/root.ts#L186-L199](../../../../packages/sdk/src/host/root.ts#L186-L199) - `workspaceTrust` in `ROOT_CONFIG_SCHEMA`"
  - "[code://packages/sdk/src/host/gate.ts#L320](../../../../packages/sdk/src/host/gate.ts#L320) - `PER_CONNECTION`"
  - "[code://packages/sdk/src/host/trust.ts](../../../../packages/sdk/src/host/trust.ts) - `trusted`, `trustRefused`, `autoApproved`, `requireTrust`"
  - "[code://packages/sdk/src/host/owners.ts#L114](../../../../packages/sdk/src/host/owners.ts#L114) - `sentBy`, the connection each running turn arrived on"
  - "[code://packages/sdk/src/types/agent.ts#L162](../../../../packages/sdk/src/types/agent.ts#L162) - `Start.trusted`"
  - "[code://packages/sdk/src/host/spawn.ts#L425](../../../../packages/sdk/src/host/spawn.ts#L425) - `trustedBy`, read from the turn's connection, and from a worktree's repository"
  - "[code://packages/sdk/src/host/lifecycle.ts#L623](../../../../packages/sdk/src/host/lifecycle.ts#L623) - `moveSession` asks before it restarts"
  - "[code://packages/sdk/src/repo/worktrees.ts#L46-L49](../../../../packages/sdk/src/repo/worktrees.ts#L46-L49) - where a worktree sits beside the repository it was cut from"
  - "[code://packages/sdk/src/host/chatactions.ts#L336](../../../../packages/sdk/src/host/chatactions.ts#L336) - `session/workingDirectorySet` and `workingDirectoryReplaced`"
  - "[code://packages/sdk/test/host-trust.test.ts](../../../../packages/sdk/test/host-trust.test.ts) - what a backend is told"
  - "[code://packages/sdk/test/host-files.test.ts#L615-L836](../../../../packages/sdk/test/host-files.test.ts#L615-L836) - the seven move cases"
  - "[code://packages/sdk/test/root-config.test.ts](../../../../packages/sdk/test/root-config.test.ts) - the declaration, the per-connection keep, and `trusted`"
---

`workspaceTrust` is a root config key now, declared the way VS Code declares it. It is kept on the connection that pushed it rather than in the host's shared record, so one window's trust is that window's. A backend starts with a `trusted(folder)` answer read from the connection that sent the turn that started or restarted it. On a host with people that connection must also own the session; with no connection, or somebody else's, every folder is untrusted. A session in a worktree the host made reads the trust of the repository it was cut from ([the decision](../../../decisions/a-worktree-inherits-its-repositorys-trust.md)). Every window is asked about a folder it can name, and none about a path only the host has seen. A session does not enter a folder until the window that asked has vouched for it. That covers the agent's `set_workspace` and a client's `session/workingDirectorySet` or `session/workingDirectoryReplaced`. The window vouches by a pushed `trustedUris` entry or by answering `vscode/requestWorkspaceTrust`. Anything but `{ trusted: true }` refuses the move with `Workspace trust was not granted for '<folder>'`, and the yes is kept on that connection for the backends the restart starts. A folder and every entry that vouches for it are read as the folders they name. So `..` and a symlink out of a trusted folder do not walk past it. An entry that names no folder here vouches for nothing.

## What was built

- [`code://packages/sdk/src/host/root.ts`](../../../../packages/sdk/src/host/root.ts) - `workspaceTrust`, an object of `enabled` and `trustedUris`, `required` both and `readOnly`, copied from VS Code's `agentHostSchema.ts:864-877`. It sits right after `defaultShell` and in front of `artifactToolsCompactPrompts`, which is where it was pulled forward to.
- [`code://packages/sdk/src/host/gate.ts`](../../../../packages/sdk/src/host/gate.ts) - `workspaceTrust` is in `PER_CONNECTION` beside `defaultShell`, with the reason written out. Kept in the shared record, the last window to connect would decide what every session on the host loads from its project.
- [`code://packages/sdk/src/host/trust.ts`](../../../../packages/sdk/src/host/trust.ts) - new. `trusted(folder, value, said)` is the one reading of a pushed value. Nothing pushed is untrusted, `enabled: false` trusts everything, and otherwise a `trustedUris` entry is the folder or its parent, with `/ab` never a child of `/a`. The third argument is the folders the same connection said yes to one at a time. `settled(path)` is the one reading of a path as the folder it names. It runs `realpathSync` on the longest part that exists, with the rest put back on it. So `..` after a symlink is the parent of the target and not of the link. Every side of every comparison goes through it. An entry that names no folder here - `''`, `file://`, a `file:` URI whose host is not this machine - vouches for nothing rather than for `/`. `sameFolder` is that reading as an equality, for a worktree and its repository. `trustRefused(folder)` is the sentence. `autoApproved(config, rootConfig)` is VS Code's own test, `globalAutoApproveEnabled` or the session's `autoApprove`. `requireTrust({ folder, sender, autoApproved })` returns at once for a folder that is trusted already. Otherwise it asks `vscode/requestWorkspaceTrust` `{ workspace }`, throws the sentence on anything but `{ trusted: true }`, and records the folder on the connection that said yes.
- [`code://packages/sdk/src/types/agent.ts`](../../../../packages/sdk/src/types/agent.ts) - `Start.trusted?: (folder: string) => boolean`, with the comment saying what absent means: a backend must read it as untrusted.
- [`code://packages/sdk/src/types/host.ts`](../../../../packages/sdk/src/types/host.ts) - `Connection.trustedFolders`, the folders this connection said yes to, kept until it pushes a new `workspaceTrust`; a push clears them in `actions.ts`.
- [`code://packages/sdk/src/host/spawn.ts`](../../../../packages/sdk/src/host/spawn.ts) - `trustedBy` reads `sender.config?.workspaceTrust` for the turn's connection, and answers false with no sender at all. It compares `ctx.ownerFor(sender)` with the session's owner only on a host that has people ([the decision](../../../decisions/the-sender-decides-on-a-host-with-no-people.md)). A session the host has in a worktree reads the trust of that worktree's repository instead ([the decision](../../../decisions/a-worktree-inherits-its-repositorys-trust.md)). A queued message's connection follows it to the turn it became, and a turn that has ended is let go of beside its sender.
- [`code://packages/sdk/src/host/owners.ts`](../../../../packages/sdk/src/host/owners.ts) - `sentBy: Map<string, Connection>` sits beside `senders`, written in `beginOrRun` under the same id. So the window that asked can be asked something back after the turn is over.
- [`code://packages/sdk/src/host/tooling.ts`](../../../../packages/sdk/src/host/tooling.ts) - `moving` holds a `Move`, which carries the asking `Connection`; `setWorkspace` records it from `sentBy` while the turn is still running.
- [`code://packages/sdk/src/host/lifecycle.ts`](../../../../packages/sdk/src/host/lifecycle.ts) - `moveSession` asks about the folder before it decides or restarts anything. The second question it used to ask, about the worktree, is gone. `restart` → `isolated` hands its `before` callback the repository alone, because a worktree reads its repository's trust ([the decision](../../../decisions/a-worktree-inherits-its-repositorys-trust.md)). That callback asks only when the repository is not the folder the move named. `restart` and `beginOrRun` take the asking `Connection` rather than an owner. The move passes its own sender on, so the backend started there is told the right trust.
- [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts) - `session/workingDirectorySet` and `workingDirectoryReplaced` work out the folder being entered before writing anything. They ask about it, and only then write `owner.additional`/`owner.workingDirectory` and restart. A refusal goes back through `no(...)` as the action's `rejectionReason`. The restart carries no `before` callback, since the worktree it makes needs no question of its own.
- [`code://packages/sdk/src/host/actions.ts`](../../../../packages/sdk/src/host/actions.ts) - a push carrying `workspaceTrust` clears that connection's `trustedFolders`. A `replace` push clears them too: the window is answering for every folder at once, which puts the folder-by-folder yeses behind it.
- [`code://packages/sdk/src/host/sessionmethods.ts`](../../../../packages/sdk/src/host/sessionmethods.ts) - the first message of a chat passes its connection to `beginOrRun`, as the four `chatactions.ts` call sites now do.
- [`code://packages/sdk/test/host-trust.test.ts`](../../../../packages/sdk/test/host-trust.test.ts) - new: what a backend is told. A window's own trust and not another's, and a folder inside a trusted one beside a sibling that is not. Somebody else's turn from a resumed session, and an automation. The sender's push on a host with no people, and a worktree's repository. A folder written with `..` in it, and the entries that vouch for nothing.

## Verified

- Task 04: steps 1, 3, 5 and 6 failed first, before any of the implementation above. The run was `Tests 4 failed | 3 passed | 31 skipped` in `packages/sdk/test/host-files.test.ts`. The four cases were stays-when-the-window-says-no, refuses-when-the-client-answers-`-32601`, asks-about-the-worktree-as-well, and refuses-a-folder-a-client-adds. Steps 2 and 4 passed before the change too, which is what they are for. So did the objective's own session-`autoApprove` case. Together they say the question is not asked where it must not be, and that a yes is still a move. The worktree case was the plan's reading of an isolated move. The review of 2026-10-06 settled that a worktree needs no question. So the case now asserts the opposite, and it is named for that.
- `npx tsc -b` clean.
- `pnpm boundary` clean, all eight packages "declared, none undeclared".
- `npx vitest run packages/sdk` - 107 files, 1512 tests, all passed. `packages/sdk/test/root-config.test.ts` and the move cases in `host-files.test.ts`, `host-tools.test.ts` and `nested-process.test.ts` included.
- The work is uncommitted on `fb1f022`. The task files' "fails on `e1c4ccc`" is the plan's revalidation base, an ancestor of `fb1f022`; the build was made and checked on `fb1f022`.

## What the review of 2026-10-06 changed

Softov's review of p1, p2 and p3 found five things. Each was made to fail before the fix. Each fix was then turned off again, and exactly its own cases failed.

- A folder is read as the folder it names, and so is every entry that vouches for it. The text it was written as does not decide: `trusted('/home/a/../../etc', { enabled: true, trustedUris: ['file:///home/a'] })` answered true and answers false now. A symlink inside a trusted folder is judged by its target, so a link out of it opens nothing. `trust.ts`'s `settled` does that reading for both sides of every comparison, and `requireTrust` settles the folder it is given. The wire case drives `sessiontools.ts`'s `set_workspace` and `lifecycle.ts`'s `requireTrust`: a `set_workspace` to `<trusted>/../../etc` asks about the folder it resolves to.
- An entry that names no folder here vouches for nothing. `''` and `file://` used to settle to `/` and trust every folder. A `file:` URI whose host is neither empty nor `localhost` names another machine's folder, which is not a folder here either.
- A worktree the host made reads its repository's trust, in `trustedBy` and in `moveSession`'s `before` callback ([the decision](../../../decisions/a-worktree-inherits-its-repositorys-trust.md)). The separate question about the worktree is gone. `packages/sdk/test/host-files.test.ts`'s isolated-move case asserts one question, about the folder the move named.
- On a host with no people directory the sender's push decides, and the owner comparison runs only on a host that has people ([the decision](../../../decisions/the-sender-decides-on-a-host-with-no-people.md)). `ownerFor` answers `undefined` for every connection there, so the comparison refused every folder. No pushed `workspaceTrust` reached a backend at all.
- A window's yes to `vscode/requestWorkspaceTrust` is kept on that connection as `trustedFolders`, read beside the pushed value. A backend restarted by the move is told the same thing. A new `workspaceTrust` push, and a `replace` push, clear it. The test asserts what the restarted backend was told, not only that the move happened.

The gates after those changes, run together:

- `npx tsc -b` clean.
- `pnpm typecheck` clean.
- `pnpm boundary` clean, all eight packages "declared, none undeclared".
- `pnpm build` clean.
- `npx vitest run packages/sdk packages/agent-claude packages/agent-pi packages/agent-acp` - 156 files, 2067 tests, all passed.
- The same suite run a package at a time gave 107 files and 1521 tests in `packages/sdk`. `agent-claude` with `agent-pi` gave 35 and 369, and `agent-acp` gave 14 and 177.
- The first pass failed `packages/sdk/test/nested-start.test.ts` on its 5 s timeout. Alone it takes 3.7 s, and it passed alone and in the second full run. Load is the cause, not this plan: the case starts a nested host and reads no trust.

## Departures from the plan

- The plan's task 04 names the agent's `setWorkspace` and a client's `session/workingDirectorySet`. `session/workingDirectoryReplaced` is covered too, and had to be. It is the only way index 0 may move, and this host advertises `primaryReplacement`. Leaving it out would have left the feature bypassable by a client that replaces the primary slot instead of adding a directory. It is the same question at the same place, and the case is in the new block.
- The plan's ref for task 04 names `packages/sdk/test/plugin-host.test.ts` for move cases; that file has no `set_workspace` case, so nothing there was touched.
- The host skips the ask for the repository when the repository is the folder the move named. That is VS Code's own reading of the same step: the window is not asked about a folder it just named.

## Tests that changed because the behaviour did

Three pre-existing cases moved a session into a folder with a client that pushes no `workspaceTrust`, which is now a refusal rather than a move. Each was given a window that vouches for the folder, which is what the case is about:

- `packages/sdk/test/host-files.test.ts` "starts the agent again, resumed, when a directory is added to a running session" - the peer answers `{ trusted: true }`.
- `packages/sdk/test/host-tools.test.ts` "moves the session once the turn that asked is over" - the same.
- `packages/sdk/test/nested-process.test.ts` - `outer`'s peer answers `{ trusted: true }` for the question, which is what makes the two `session/workingDirectorySet` cases restart the inner host at all. Nothing else in that file asks the peer anything.
- `packages/sdk/test/fixtures/wire.jsonl` - rewritten by `wire.test.ts`, which records a run's frames on every pass of the suite. The two lines that moved are the root config schema, which now declares `workspaceTrust`; nothing else in the capture changed.

## Left for later

- none. Nothing this plan named is left; there is no `deferred.md`.
- none now. `trustedBy`'s owner comparison answered false everywhere on a host with no people directory, because `ownerFor` names nobody there, so a pushed `workspaceTrust` reached no backend. That was open as a problem while nobody had decided it; the review of 2026-10-06 decided it, and the sender's push decides there ([the decision](../../../decisions/the-sender-decides-on-a-host-with-no-people.md)). The problem file is deleted and its fix is task 03's.
