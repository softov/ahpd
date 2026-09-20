---
title: The branch's pull requests are captured once as the session baseline, and survive a restart
status: todo
depends: []
layer: packages/sdk
refs:
  - code://packages/sdk/src/types/sessions.ts#L27-L57 - `SessionStore`, which gains the baseline pair
  - code://packages/sdk/src/sessions.ts#L16-L29 - `memorySessions`, the slots a store holds
  - code://packages/sdk/src/sessions.ts#L45-L49 - `Saved`, the persisted shape
  - code://packages/sdk/src/sessions.ts#L80-L108 - `save`, which turns the slots into JSON
  - code://packages/sdk/src/sessions.ts#L118-L153 - `load` and the store a restart reads
  - code://packages/sdk/src/host.ts#L1964-L1994 - `githubFacts` and `metaOf`, where the baseline joins the directory's map
  - code://packages/sdk/src/host.ts#L2065-L2098 - `refreshPullRequests`, where the first answer for a directory arrives
  - code://packages/sdk/src/host.ts#L3779-L3816 - `openSession`, where the session starts
  - code://test/sessions.test.ts#L78-L124 - the restart tests this one joins
  - code://test/host.test.ts#L6143-L6259 - the GitHub `_meta` suite
  - file:///github/externals/vscode/src/vs/platform/agentHost/common/state/sessionState.ts#L1674-L1696 - `ISessionGitHubState`, which declares both keys
  - file:///github/externals/vscode/src/vs/platform/agentHost/common/state/sessionState.ts#L1778-L1786 - `withInitialSessionPullRequest`, the empty baseline included
  - file:///github/externals/vscode/src/vs/platform/agentHost/node/agentHostGitStateService.ts#L175-L193 - the baseline captured when the checkout is attached
---

## Objective

A session's `_meta.github` carries `initialPullRequestUrls`, the pull requests its branch already had when the session started, captured once and written to the session store so a restart returns it, with an empty array standing for a branch that had none.

## Files

- `UPDATE: packages/sdk/src/types/sessions.ts:27-57` - add `PullRequestBaseline`, `pullRequests(id)` and `setPullRequests(id, value)`.
- `UPDATE: packages/sdk/src/sessions.ts:16-29` - `memorySessions` keeps the slot and takes it away when it is empty.
- `UPDATE: packages/sdk/src/sessions.ts:45-49` - `Saved.sessions[]` gains `pullRequests?: PullRequestBaseline`.
- `UPDATE: packages/sdk/src/sessions.ts:80-108` - `save` writes the slot when it is there.
- `UPDATE: packages/sdk/src/sessions.ts:118-141` - `load` accepts only an object with two string arrays and ignores anything else.
- `UPDATE: packages/sdk/src/sessions.ts:145-153` - the returned store forwards both methods, and `forget` deletes the slot.
- `UPDATE: packages/sdk/src/host.ts:1964-1994` - `metaOf` spreads the session's baseline onto the directory's `github` object and counts it in the presence check.
- `UPDATE: packages/sdk/src/host.ts:2065-2098` - `refreshPullRequests` captures the baseline for sessions in that directory that have none.
- `UPDATE: packages/sdk/src/host.ts:3779-3816` - `openSession` captures from facts already held.
- `UPDATE: test/sessions.test.ts:111-124` - a case beside the artifact slot.
- `UPDATE: test/host.test.ts:6143-6259` - the `_meta.github` assertions gain the baseline.

## Steps

1. `export interface PullRequestBaseline { initialPullRequestUrls: string[]; associatedPullRequestUrls: string[] }` in `types/sessions.ts`, commented as the pull requests that predate the session and the ones promoted since (decision 1).
2. Add `pullRequests(id: string): PullRequestBaseline | undefined` and `setPullRequests(id: string, value: PullRequestBaseline): void` to `SessionStore`, and hold the slot in `memorySessions`.
3. `Saved.sessions[]` gains `pullRequests`; `save` writes it only when it is there, and `load` takes only an object whose two fields are arrays of strings, the way it already filters artifacts.
4. The file store's `setPullRequests` calls `known.add(id)` and `later()`, and `forget` drops the slot.
5. `const baseline = kept.pullRequests(idOf(uri));` in `metaOf`, and when the directory's `github` or the baseline is there, return `github: { ...github, ...(baseline === undefined ? {} : { initialPullRequestUrls: baseline.initialPullRequestUrls, associatedPullRequestUrls: baseline.associatedPullRequestUrls }) }`; include `baseline` in the `told === undefined && github === undefined && artifacts === undefined` check.
6. `const captureBaseline = (uri: string, urls: string[]): void => { if (kept.pullRequests(idOf(uri)) === undefined) kept.setPullRequests(idOf(uri), { initialPullRequestUrls: urls, associatedPullRequestUrls: [] }); }`.
7. In `openSession`, after the session is in `sessions`, call `captureBaseline(uri, ...)` only when `githubFacts.has(dirOf(uri))`, so a session opened after the branch was already asked gets the answer that existed when it started; otherwise leave it for the first answer.
8. In `refreshPullRequests`, after `githubFacts.set(dir, now)`, call `captureBaseline(uri, now.pullRequestUrls ?? [])` for every `uri` of `inThere(dir)`, which captures an empty array where the branch had no pull request (reference `withInitialSessionPullRequest`).
9. Do not write `initialPullRequestUrls` anywhere else, so once captured it does not move; the promotion is task 02's.

## Validation

- `test/sessions.test.ts`: a new case sets a baseline for one id, reads it from a second `fileSessions` on the same file after the coalesced write, asserts another id answers `undefined`, and asserts `forget` drops it.
- `test/host.test.ts`: the existing `puts the branch's pull request on the session and its row` asserts `state._meta.github.initialPullRequestUrls` equals `['https://github.com/softov/ahpd/pull/7']` and `associatedPullRequestUrls` equals `[]`; a new case on a branch with no pull request asserts `initialPullRequestUrls` is `[]` and not absent.
- `pnpm vitest run test/sessions.test.ts` and `pnpm vitest run test/host.test.ts` green.
- `pnpm test`, `pnpm typecheck` and `pnpm boundary` green.

## Resume

