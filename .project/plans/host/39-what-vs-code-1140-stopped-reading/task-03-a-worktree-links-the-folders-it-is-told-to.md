---
title: A worktree links the git-ignored folders it is told to
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L4057-L4068](../../../../packages/sdk/src/host.ts#L4057-L4068) - the comment counting the host's own properties, which says six and a seventh"
  - "[code://packages/sdk/src/host.ts#L4091-L4105](../../../../packages/sdk/src/host.ts#L4091-L4105) - `isolating`'s `defaults`, where the new key is offered empty"
  - "[code://packages/sdk/src/host.ts#L4152-L4171](../../../../packages/sdk/src/host.ts#L4152-L4171) - the `worktreeIncludeFiles` property, beside which the new one is declared"
  - "[code://packages/sdk/src/host.ts#L4952-L4957](../../../../packages/sdk/src/host.ts#L4952-L4957) - `HOSTS_OWN`, the list of keys a backend is never handed"
  - "[code://packages/sdk/src/host.ts#L4994-L5012](../../../../packages/sdk/src/host.ts#L4994-L5012) - `isolated`, where the value is read and handed to `port.create`"
  - "[code://packages/sdk/src/types/worktrees.ts#L28-L40](../../../../packages/sdk/src/types/worktrees.ts#L28-L40) - `include`, where `symlink` sits beside it"
  - "[code://packages/sdk/src/worktrees.ts#L87-L114](../../../../packages/sdk/src/worktrees.ts#L87-L114) - `create`, the checkout and the best-effort include loop the symlink pass runs before"
  - "[code://packages/sdk/src/worktrees.ts#L9-L18](../../../../packages/sdk/src/worktrees.ts#L9-L18) - the `git` helper, which has no way to write to a child's stdin"
  - "[code://packages/sdk/src/worktrees.ts#L140-L170](../../../../packages/sdk/src/worktrees.ts#L140-L170) - `copy`, the shallow matcher the new pass sits beside and does not replace"
  - "[code://packages/sdk/test/worktrees.test.ts#L30-L49](../../../../packages/sdk/test/worktrees.test.ts#L30-L49) - the `repository()` harness, which a test with an ignored folder extends"
  - "[code://packages/sdk/test/worktrees.test.ts#L210-L232](../../../../packages/sdk/test/worktrees.test.ts#L210-L232) - the include case, beside which the symlink case sits"
  - "[code://docs/AHP.md#L85](../../../../docs/AHP.md#L85) - the `resolveSessionConfig` row, which says how many worktree properties this host contributes"
  - "[code://docs/AHP.md#L689-L709](../../../../docs/AHP.md#L689-L709) - `### Worktrees the window manages`, where what a tree is given is described"
  - "file:///github/externals/vscode/src/vs/platform/agentHost/node/worktreeSymlink.ts - `createWorktreeSymlink` and `assertTargetParentDoesNotContainSymlink`, the four refusals the local helper mirrors"
  - "file:///github/externals/vscode/src/vs/platform/agentHost/node/agentHostGitService.ts - `symlinkWorktreeFolders` and `_getWorktreeSymlinkFolders`, the `ls-files --others --ignored` and `check-ignore --no-index` pass, and `getWorktreeSymlinkFolderCandidates` / `filterWorktreeSymlinkFolders` which select the folders"
  - "file:///github/externals/vscode/src/vs/platform/agentHost/node/shared/worktreeIsolation.ts - the property at 877-887, and the order at 1022-1038: symlink first, then the include copy, each in its own try"
---

## Objective

`worktreeSymlinkFolders` is a declared key this host answers, and a worktree it makes links the git-ignored folders that match it - `node_modules` above all - instead of leaving them out, so a worktree session can run what the checkout runs.
The pass runs before the include copy, is best effort, and a failure in it does not stop the session.

## Files

- `UPDATE: packages/sdk/src/host.ts:4057-4068` - the comment that counts this host's own properties: six become seven, and `scope` moves from a seventh to an eighth.
- `UPDATE: packages/sdk/src/host.ts:4091-4105` - `isolating`'s `defaults`, where the new key is offered as `[]`.
- `UPDATE: packages/sdk/src/host.ts:4171` - the new property, declared after `worktreeIncludeFiles` and before the "three a client seeds" block.
- `UPDATE: packages/sdk/src/host.ts:4952-4957` - `HOSTS_OWN`, so a backend is never handed the key.
- `UPDATE: packages/sdk/src/host.ts:4994-5012` - the reader in `isolated`, and `port.create` receiving `symlink` beside `include`.
- `UPDATE: packages/sdk/src/types/worktrees.ts:28-40` - `symlink?: string[]` on `Worktree`, beside `include`.
- `UPDATE: packages/sdk/src/worktrees.ts:9-18` - the `git` helper, given an optional stdin payload the way `check-ignore --stdin` needs.
- `UPDATE: packages/sdk/src/worktrees.ts:87-114` - `create`: the symlink pass, before the include loop and in its own try.
- `UPDATE: packages/sdk/src/worktrees.ts:140-170` - the new `link` helper beside `copy`, and whatever the pass needs to enumerate candidates.
- `UPDATE: packages/sdk/test/worktrees.test.ts:30-49` - the `repository()` harness, given an ignored folder to have.
- `UPDATE: packages/sdk/test/worktrees.test.ts:210-232` - a new case beside the include one.
- `UPDATE: docs/AHP.md:85` - the `resolveSessionConfig` row's count of worktree properties.
- `UPDATE: docs/AHP.md:689-709` - what a new tree is given.

## Steps

1. `Worktree` gains `symlink?: string[]` beside `include` at `types/worktrees.ts:39`. The doc comment says what the patterns are - git-ignored folders, in `.gitignore` syntax, relative to the repository - and says what the feature costs, which is that a linked folder is one directory seen from two places: a write into it from inside the worktree is a write into the checkout. That is the `Risks and tradeoffs` row of the plan, and it belongs on the field rather than only in the plan.
2. `HOSTS_OWN` at 4953 gains `worktreeSymlinkFolders`, so `backendsOwn` at 4961 strips it before a backend is handed anything and the config the session reports carries the host's own half only. The comment above `HOSTS_OWN` is unaffected; the one at 4057-4068 is not, and says "these six" and "`scope` is a seventh" - seven and an eighth.
3. The property is declared after `worktreeIncludeFiles`, in the same shape VS Code declares it at `worktreeIsolation.ts:877-887`: `type: 'array'`, `items: { type: 'string' }`, a title, a description saying patterns in `.gitignore` syntax for git-ignored folders to link into the worktree, `readOnly: true` and `sessionMutable: false`. The `Decisions locked in` row says it is not session-mutable, and it carries a preference the window already holds rather than a question to put in front of somebody - which is the same reason the three rows below it are `readOnly`. Its default is `[]` in `isolating`'s `defaults`, beside `worktreeIncludeFiles: []` once task 02 has landed.
4. `isolated` reads it as an array of strings and hands it to `port.create` as `symlink`, in the same `...(length > 0 ? {} : {})` shape `include` uses at 5007, so a session that named none carries no key at all. The narrowing is the same as task 02's: a value from the wire is `unknown` and is narrowed where it is used. Nothing in `worktreeSymlinkFolders` narrows a string the way `worktreeIncludeFiles` does - the key is new, so only the array spelling has ever been sent, and 1.140 sends the array.
5. `Worktree.symlink` widens `worktreeIncludeFiles` nowhere: a session that names both gets both, and they are two passes rather than one, because VS Code runs two (`worktreeIsolation.ts:1022-1038`) and a folder that is linked should not also be copied.
6. The `git` helper at `worktrees.ts:9-18` grows an optional payload written to the child's stdin, because `check-ignore --no-index -z --stdin` takes its candidates that way and `execFile` is already what runs git here. Nothing about the helper's rejection changes: git's own words on stderr, as the comment at 12-15 says.
7. `create` gains the symlink pass, placed between the `git worktree add` at 102-107 and the include loop at 108-113, and wrapped in its own `try` whose failure is swallowed and logged, which is what `worktreeIsolation.ts:1026-1028` does. The pass must not be able to stop a session: `node_modules` may be enormous, the patterns may name a folder this machine has no permission to link, and a worktree without the link still runs the agent, which is not true of a session that never started.
8. The pass enumerates its candidates the way `symlinkWorktreeFolders` does, not the way `copy` does. `copy` at 148-170 is a shallow glob - a literal path or one trailing `*` - and that is right for files a person named; the reference's patterns are `.gitignore` syntax, where `node_modules/` means every directory at any depth, and a shallow matcher would answer it for the root and nothing else. So: write the patterns to a temporary file, run `git ls-files --others --ignored --exclude-standard -z` in the source checkout for the git-ignored entries, run the same with `--exclude-from=<the patterns file>` for the entries those patterns match, and `--directory` for the wholly ignored folders, all NUL-separated as the reference does at `agentHostGitService.ts:834-839`. A candidate is a matched entry's ancestor directory (`getWorktreeSymlinkFolderCandidates`), and it is kept only when `check-ignore --no-index -z --stdin` says the checkout ignores it and a `git init`ed matcher directory with `core.excludesFile` pointed at the same patterns file says the patterns match it (`agentHostGitService.ts:849-857`), and when it sits inside a wholly ignored folder. A folder inside another kept folder is dropped (`filterWorktreeSymlinkFolders`), since linking the parent already brings it.
9. The link itself mirrors `createWorktreeSymlink` from `worktreeSymlink.ts`, in a `link(from, to, folder)` helper beside `copy` and with the same four refusals. Resolve both realpaths and skip when the source is already inside the worktree; walk the target's parent path and refuse when a segment of it is a symlink or is not a directory, which is what `assertTargetParentDoesNotContainSymlink` refuses and why - a link under a link is one whose target nobody can say; skip a target that already exists, `lstat` and not `stat`, so a dangling link counts; then `mkdir` the parent recursively and `symlink` the source, `'dir'` and `'junction'` on win32. Best effort sits around the whole pass rather than around each link, so a pattern that cannot be linked does not cost a retry of the ones that can.
10. The include copy is not changed. It stays the shallow matcher it is, it stays after the symlink pass, and it is now running against a tree in which a linked folder exists - which is why the two keys are separate rather than one list of paths, and why a session naming the same folder in both is copying into a link.
11. `packages/sdk/test/worktrees.test.ts`, the `repository()` harness at 30-49 gains what the new cases need: `node_modules` added to the `.gitignore` written at line 43, the directory made, and a file written inside it, so the folder is git-ignored, is not tracked, and has something to read through the link.
12. A new case beside the include case at 210: a session with `worktreeSymlinkFolders: ['node_modules']` and `isolation: 'worktree'`, whose worktree carries `node_modules` as a symlink - `lstatSync(join(where, 'node_modules')).isSymbolicLink()` is true, `readFileSync(join(where, 'node_modules', 'dep'), 'utf8')` is what the checkout has, and the checkout's own copy is the same file rather than a copy of it.
13. Two more cases in the same file: a session with `worktreeSymlinkFolders: ['nothing/here']` makes a tree with no symlink in it and runs, which is what best effort means; and a session whose pattern names a folder the checkout tracks is not refused, since the target exists in a fresh worktree and the link is skipped. The second is the case the four refusals exist for, and it is the one that would turn a bad pattern into a session that will not start.
14. `docs/AHP.md`, the `resolveSessionConfig` row at 85: six becomes seven, since this is the host's seventh worktree property. `### Worktrees the window manages` gains what a new tree is given: the git-ignored files matching `worktreeIncludeFiles` are copied in and the git-ignored folders matching `worktreeSymlinkFolders` are linked in, the links before the copy, both best effort, and a link is a folder the worktree and the checkout share - which is the sentence a person needs before they name `node_modules`, and the one that belongs in the docs rather than only on the field.

## Validation

- `packages/sdk/test/worktrees.test.ts` - the three cases in steps 12 and 13, against the real repository the file already builds, because the whole question is what `git worktree add` leaves out and what a link into it has to survive. A port that said yes would answer all three.
- The same file, the case at 210 unchanged and still passing: the include copy runs against a tree the symlink pass may have touched, and this is the case that says it still copies.
- A case where the symlink pass fails and the session starts anyway. The reference swallows the failure and logs it; the honest way to force it here is a pattern that names a folder whose parent in the worktree is a symlink, which is the refusal in `assertTargetParentDoesNotContainSymlink` and the one that must not take the session down.
- `pnpm exec vitest run packages/sdk/test/worktrees.test.ts` - the whole file, since a seventh property reaches every case that resolves a config.
- `pnpm test` - `tools/schema.mjs` regenerates the strict schema and `packages/sdk/test/wire.test.ts` asserts no undeclared key on any frame, which is what catches the new key reaching a backend.
- `pnpm typecheck` and `pnpm boundary`.
