---
title: The GitHub state is published per folder
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L2935-L2970](../../../../packages/sdk/src/host.ts#L2935-L2970) - `metaOf`, which composes the session's whole `_meta` and is the only place the new keys are written"
  - "[code://packages/sdk/src/host.ts#L2543-L2556](../../../../packages/sdk/src/host.ts#L2543-L2556) - `dirOf`, which is the path the folder key is built from"
  - "[code://packages/sdk/src/host.ts#L3029-L3054](../../../../packages/sdk/src/host.ts#L3029-L3054) - `describes`, which spreads the same `_meta` into the row, and builds `project.uri` as the URI the key is"
  - "[code://packages/sdk/src/host.ts#L3056-L3068](../../../../packages/sdk/src/host.ts#L3056-L3068) - `metaMoved`, the `session/metaChanged` dispatch that replaces the whole map"
  - "[code://packages/sdk/src/host.ts#L2916-L2925](../../../../packages/sdk/src/host.ts#L2916-L2925) - the comment above `githubFacts`, which is where the per-folder key belongs in the story"
  - "[code://packages/sdk/src/host.ts#L6442-L6448](../../../../packages/sdk/src/host.ts#L6442-L6448) - the baseline capture on creation, which reads `githubFacts` and is not touched"
  - "[code://packages/sdk/test/host.test.ts#L7263-L7407](../../../../packages/sdk/test/host.test.ts#L7263-L7407) - `what GitHub knows about the branch`, the `_meta.github` cases the per-folder case sits beside"
  - "[code://docs/AHP.md#L625](../../../../docs/AHP.md#L625) - the `pull request` row of `### Sessions and the catalogue`, which names `_meta.github`"
  - "file:///github/externals/vscode/src/vs/platform/agentHost/common/state/sessionState.ts - `SESSION_META_GITHUB_DATA_KEY`, `SESSION_META_WORKING_DIRECTORY_KEYS_KEY`, `withFolderGitHubState` and `withWorkingDirectoryKey`, the two keys and how a client reads them"
  - "file:///github/externals/vscode/src/vs/sessions/contrib/providers/agentHost/browser/baseAgentHostSessionsProvider.ts - `readCompatibleFolderGitHubState` and `toGitHubInfo`, where a host-published key is authoritative and `_meta.git` is still read for the session folder"
---

## Objective

`metaOf` publishes the GitHub state it already composes under `_meta.githubData`, keyed by a folder key it also publishes in `_meta.workingDirectoryKeys`, so VS Code 1.140 draws the pull request pill again, and `_meta.github` stays beside it for a client that still reads that one.
The key is the working directory's own URI, which is what the summary already names it by, so a key the host publishes is found by the window's `readWorkingDirectoryKey` rather than derived and missed.

## Files

- `UPDATE: packages/sdk/src/host.ts:2935-2970` - `metaOf`: the GitHub bag is composed into a local first, then published under `githubData` and `workingDirectoryKeys` beside the `github` it already writes.
- `UPDATE: packages/sdk/src/host.ts:2916-2925` - the comment above `githubFacts`, which says the state is per directory and now says what the key that directory is published under is.
- `UPDATE: packages/sdk/test/host.test.ts:7309-7362` - the case that reads `state._meta?.github` on the snapshot, extended with the two new keys on the snapshot, on the `session/metaChanged` frame and on the row.
- `UPDATE: packages/sdk/test/host.test.ts:7387-7406` - the case that captures an empty baseline, extended to say the same bag is under `githubData`.
- `UPDATE: docs/AHP.md:625` - the `pull request` row, which today names only `_meta.github`.

## Steps

1. The folder key is `file://${dir}`, the URI the summary already names the working directory by. `describes` at 3041 builds `project.uri` exactly this way and `lead.workingDirectories()` holds that spelling, so the key the host publishes and the string the client looks it up by are one string rather than two that must agree. It is built in `metaOf` from the `dir` `dirOf` returned at 2936, and nowhere else: a key computed a second place is a key that can differ.
2. Compose the GitHub bag once, into a local, before the object is built. Today the literal at 2955-2965 merges `githubFacts.get(dir)` with the session's baseline inline, and the same object has to land under two keys, so the merge moves out into a `const facts` and both keys read it. Nothing about what is in it changes: `owner`, `repo`, `pullRequestUrls`, `pullRequestState`, `pullRequestStateUrl`, `pullRequestBranchName` from the directory, and the session's `initialPullRequestUrls` and `associatedPullRequestUrls` beside them.
3. Add the two keys to the map `metaOf` returns, and only on the branch that already builds `github` - the `github !== undefined || baseline !== undefined` case at 2955. `githubData` is `{ [key]: facts }` and `workingDirectoryKeys` is `{ [fileUri]: key }`, both under the same condition, because a key published with nothing under it tells the window the folder is known and has no state, which is a different answer from one that was never published. The early return at 2949 already counts `github` and `baseline`, so a session with GitHub state and no git facts does not get an empty `_meta`.
4. Leave `_meta.git` exactly where it is and add no `_meta.gitData`, which is the `Decisions locked in` row "No `_meta.gitData`". `toGitHubInfo` reads `readSessionGitState` for the session folder and nothing else, and a session here has one folder, so a per-folder git map would be a key nobody reads.
5. Leave `_meta.github` in place, which is the `Decisions locked in` row "`_meta.github` stays beside it": `/github/ahpc/src/state.ts` reads it and a client that has not moved to 1.140 reads it. It is the same `facts` object, not a second composition, so the two cannot drift.
6. Nothing outside `metaOf` writes either key. `session/metaChanged` at 3061 carries the whole map, so a producer that dispatched its own part would erase the directory's git facts, and `describes` at 3044 and `setArtifacts` at 3018 both reach `_meta` only through `metaOf`. The baseline capture at 6442 reads `githubFacts` and stays a read.
7. `docs/AHP.md`, the `pull request` row: say the state is published twice, under `_meta.githubData[key]` with the key named in `_meta.workingDirectoryKeys[workingDirectory]`, and the key being the working directory's `file://` URI. Say `_meta.github` is still there and is what a client reading that key sees, and that `_meta.git` is unchanged and is not per folder. A client written against this row can then tell 1.140 from an older window without reading the source.

## Validation

- `packages/sdk/test/host.test.ts`, the case at 7309 extended: the snapshot's `_meta.githubData` equals `{ 'file:///home/softov': <the same object `state._meta?.github` already is> }` and `_meta.workingDirectoryKeys` equals `{ 'file:///home/softov': 'file:///home/softov' }`, with `_meta.github` and `_meta.git` unchanged by the assertions already there. The `session/metaChanged` frame read at 7356 and the `root/sessionSummaryChanged` row at 7360 carry the same two keys, which is what says the row and the session did not diverge.
- The same file, the case at 7387 extended: a branch with no pull request still publishes `githubData`, holding `initialPullRequestUrls: []`, because an empty baseline is a captured answer and a client can tell it from a host that never asked.
- A new case in the same `describe` beside 7364: a host built without a `github` port publishes neither `githubData` nor `workingDirectoryKeys`, and a session whose directory has answered neither has no `_meta` at all rather than an empty one.
- `pnpm exec vitest run packages/sdk/test/host.test.ts` - the whole file, since `metaOf` is read by every session case in it.
- `pnpm test` - `tools/schema.mjs` regenerates the strict schema and `packages/sdk/test/wire.test.ts` asserts no undeclared key on any frame. `SessionState._meta` is a declared bag, so two new keys inside it pass; that test is what would catch either of them landing somewhere the protocol does not declare one.
- `pnpm typecheck` and `pnpm boundary`.
