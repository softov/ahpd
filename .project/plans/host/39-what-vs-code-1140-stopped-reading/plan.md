---
title: The pull request pill and the worktree's files come back in VS Code 1.140
domain: host
status: built
priority: high
created: 2026-10-02
revalidated: 2026-10-02
requires: []
changes: []
creates: []
decisions: []
refs:
  - "[code://packages/sdk/src/host.ts#L2925-L2975](../../../../packages/sdk/src/host.ts#L2925-L2975) - `githubFacts` and `metaOf`, which compose the session's `_meta` and put the GitHub state under `_meta.github` only"
  - "[code://packages/sdk/src/host.ts#L4155-L4172](../../../../packages/sdk/src/host.ts#L4155-L4172) - the `worktreeIncludeFiles` schema, a comma-separated `string`"
  - "[code://packages/sdk/src/host.ts#L4994-L5010](../../../../packages/sdk/src/host.ts#L4994-L5010) - where the key is read, as a string only, and handed to the worktree port as `include`"
  - "[code://packages/sdk/src/types/worktrees.ts#L39](../../../../packages/sdk/src/types/worktrees.ts#L39) - `include`, where `symlink` would sit beside it"
  - "[code://packages/sdk/src/worktrees.ts#L95-L160](../../../../packages/sdk/src/worktrees.ts#L95-L160) - `create`, the best-effort include copy, and `copy`, the pattern a symlink pass mirrors"
  - "[code://packages/sdk/src/worktrees.ts#L9-L18](../../../../packages/sdk/src/worktrees.ts#L9-L18) - the `git` helper, which writes nothing to a child's stdin and so cannot ask `check-ignore --stdin` anything"
  - "[code://packages/sdk/src/configvalues.ts#L30-L49](../../../../packages/sdk/src/configvalues.ts#L30-L49) - `accepts`, what a stored config value is checked against, and what an array-typed property does to a value stored as a string"
  - "[code://packages/sdk/src/host.ts#L4057-L4068](../../../../packages/sdk/src/host.ts#L4057-L4068) - the comment counting the host's own config properties, which a seventh worktree key changes"
  - "[code://packages/sdk/src/host.ts#L4952-L4957](../../../../packages/sdk/src/host.ts#L4952-L4957) - `HOSTS_OWN`, the keys a backend is never handed"
  - "[code://packages/sdk/test/github.test.ts](../../../../packages/sdk/test/github.test.ts) - `githubPullRequests`, the port itself, which this plan does not change"
  - "[code://packages/sdk/test/host.test.ts#L7263-L7407](../../../../packages/sdk/test/host.test.ts#L7263-L7407) - `what GitHub knows about the branch`, where the `_meta.github` cases are and where a per-folder case sits beside them"
  - "[code://packages/sdk/test/worktrees.test.ts](../../../../packages/sdk/test/worktrees.test.ts) - the worktree harness, with `worktreeIncludeFiles: '.env'` as a string"
  - "[code://docs/AHP.md](../../../../docs/AHP.md) - the `pull request` row that names `_meta.github`"
  - https://code.visualstudio.com/updates/v1_140 - multi-folder sessions and shared worktree folders
  - file:///github/externals/vscode/src/vs/platform/agentHost/common/state/sessionState.ts - `githubData` and `workingDirectoryKeys` (`SESSION_META_GITHUB_DATA_KEY`, `withFolderGitHubState`, `withWorkingDirectoryKey`), and `_meta.github` now only a `createSession` input
  - file:///github/externals/vscode/src/vs/sessions/contrib/providers/agentHost/browser/baseAgentHostSessionsProvider.ts - `readCompatibleFolderGitHubState` and `toGitHubInfo`: a host-published folder key is authoritative, and `_meta.git` is still read for the session folder
  - file:///github/externals/vscode/src/vs/platform/agentHost/node/shared/worktreeIsolation.ts - both keys declared `type: 'array'` of string patterns, read as arrays only
  - file:///github/externals/vscode/src/vs/platform/agentHost/node/worktreeSymlink.ts - `createWorktreeSymlink`: skips a source inside the worktree, refuses a symlinked target parent, skips a target that exists
  - file:///github/externals/vscode/src/vs/platform/agentHost/node/agentHostGitService.ts - `symlinkWorktreeFolders`: git-ignored folders matched with `ls-files --others --ignored --exclude-standard --directory -z` and `check-ignore --no-index` against a temporary excludes file
  - git://b5d1894c729 - VS Code: shared worktree folders
  - git://18d64b8c226 - VS Code: GitHub state per folder
---

## Goal

A session from this host shows its pull request in VS Code 1.140's Sessions window again, and a worktree session gets the git-ignored files and folders the window asks for.
1.140 stopped reading two things this host sends: `_meta.github` on a live session, and `worktreeIncludeFiles` as a string.
It also added `worktreeSymlinkFolders`, which links ignored folders such as `node_modules` into a new worktree instead of leaving them out.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "githubData|workingDirectoryKeys" packages docs` - nothing; only `_meta.github` is written.
- `rg -n "worktreeIncludeFiles" packages /github/ahpc/src /github/ahpapp/src` - the host's schema and reader, one string test, ahpc seeds and lists it, ahpapp gives it an icon.
- `rg -n "_meta.github" /github/ahpc/src` - ahpc reads `_meta.github` (`src/state.ts`).

### Runtime path

```
githubPullRequests() -> githubFacts -> metaOf -> session/metaChanged and the summary
  -> 1.140 reads _meta.githubData[workingDirectoryKeys[folder]] -> nothing there -> no pill
createSession config -> worktreeIncludeFiles (array from VS Code) -> read as a string -> '' -> nothing copied
```

### Gaps

- No `_meta.githubData` or `_meta.workingDirectoryKeys` is published.
- An array `worktreeIncludeFiles` is read as empty.
- No `worktreeSymlinkFolders` key, and the worktree port cannot link a folder.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| Restore what 1.140 broke first, with `worktreeSymlinkFolders` in the same plan | Softov, 2026-10-02, asked "Which Pass 5 item should I plan first?": "Restore what broke" | all |
| `_meta.githubData` holds the same state `_meta.github` does, keyed by a folder key the host publishes in `_meta.workingDirectoryKeys` for the session's working directory | VS Code `sessionState.ts`: a host-published key is authoritative | 01 |
| The folder key is the working directory's URI as the summary names it | (defaulted: the key is host-authored, so nothing needs hashing, and the window's case-insensitive fallback still matches it) | 01 |
| `_meta.github` stays beside it | (defaulted: ahpc reads it, `/github/ahpc/src/state.ts`) | 01 |
| No `_meta.gitData`: `_meta.git` is still read for the session folder, and a session here has one folder | (defaulted: `toGitHubInfo` reads `readSessionGitState` for the session folder) | 01 |
| `worktreeIncludeFiles` is declared an array of string patterns, and a comma-separated string is still read | Softov, 2026-10-02, asked "What should host/39 declare?": "Array, read both" | 02 |
| It stays editable, not `readOnly` as VS Code declares it | (defaulted: ahpc lets a person type it; VS Code seeds it from its own setting) | 02 |
| The host's own config paths (`isolating` defaults, `mineOf`, `mergedConfig`/`hostSchema`, the `session/configChanged` refusal) take `string | string[]` for the two pattern keys, so a list is echoed on the session and accepted on a later change | Softov, 2026-10-02, "Array, read both": a list the host reads must not be refused or dropped elsewhere | 02, 03 |
| A session stored with `worktreeIncludeFiles` as a string reads back as the list it names, not as an invalid value replaced by the default | Softov, 2026-10-02, "Array, read both" | 02 |
| `worktreeSymlinkFolders` is an array of `.gitignore` patterns, not session-mutable, and links matching git-ignored folders from the source checkout before the include copy, best effort, as VS Code does | VS Code `b5d1894c729` | 03 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The GitHub state is published per folder](task-01-the-github-state-is-published-per-folder.md) | done | - |
| [02 - The files a worktree brings along are a list, and a string still reads](task-02-the-files-a-worktree-brings-along-are-a-list.md) | done | - |
| [03 - A worktree links the git-ignored folders it is told to](task-03-a-worktree-links-the-folders-it-is-told-to.md) | done | - |

## Risks and tradeoffs

- ahpc and ahpapp send `worktreeIncludeFiles` as a string; the host reads both, and moving them to a list is their own follow-up.
- A symlinked folder is shared between the checkout and the worktree, so an agent writing into it writes into both; that is what the setting asks for, and only git-ignored folders are linked.

## Resume state

- **Done so far:** built 2026-10-02, see [implemented.md](implemented.md) and [deferred.md](deferred.md).
- **Next action:** none.
- **Open questions:** none.

## Final verification checklist

- [x] A session with a pull request carries `_meta.githubData[key]` and `_meta.workingDirectoryKeys[workingDirectory] = key`, and still `_meta.github`.
- [x] `worktreeIncludeFiles: ['.env']` and `'.env'` both copy `.env` into a new worktree.
- [x] `worktreeSymlinkFolders: ['node_modules']` links an ignored `node_modules` into a new worktree, and a failure does not stop the session.
- [x] `pnpm exec tsc --noEmit`, `pnpm test`, `pnpm boundary` pass.
- [x] `plans/index.md` updated.
