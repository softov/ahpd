---
title: The session pull request baseline is sent - implemented
date: 2026-09-20
refs:
  - code://packages/sdk/src/types/sessions.ts
  - code://packages/sdk/src/sessions.ts
  - code://packages/sdk/src/host.ts
  - code://test/sessions.test.ts
  - code://test/host.test.ts
---

A session's `_meta.github` now carries `initialPullRequestUrls`, the pull requests its branch already had when the session started, and `associatedPullRequestUrls`, the ones it made its own since, while `pullRequestUrls` keeps its meaning as the whole set.
The baseline is captured once, an empty array stands for a branch that had none, it is written to the session store so a restart returns the same split, and a pull request that becomes the session's is promoted out of it in the same write as its artifact.

## What was built

- `code://packages/sdk/src/types/sessions.ts` - `PullRequestBaseline` is the pair, and `SessionStore` gains `pullRequests(id)` and `setPullRequests(id, value)`.
- `code://packages/sdk/src/sessions.ts` - `memorySessions` holds the slot and `forget` drops it; `Saved.sessions[]` gains `pullRequests`; `save` writes it whenever it is there, an all-empty pair included; `load` takes only an object whose two fields are arrays of strings and ignores the rest.
- `code://packages/sdk/src/host.ts` - `captureBaseline` writes the baseline once and never overwrites it; `metaOf` spreads it onto the directory's `github` object and counts it in the presence check; `refreshPullRequests` captures for every session in the directory on the first answer; `openSession` captures from facts already held, so the branch's state at session start is what is kept; `urlKey` and `promotePullRequest` move a URL out of `initialPullRequestUrls` and to the front of `associatedPullRequestUrls`, deduplicated by normalized key; `recordPullRequest` calls the promotion beside the artifact write and before `metaMoved`.

## Verified

- `test/sessions.test.ts` - 11 tests, one new: three baselines including an all-empty one are written, read back by a second `fileSessions` on the same file, an unknown id answers `undefined`, and `forget` drops the slot.
- `test/host.test.ts` - 274 tests, three new: the existing branch pull request case now asserts `initialPullRequestUrls` and `associatedPullRequestUrls`, a branch with no pull request captures `[]` rather than leaving the key absent, a URL the branch already had is promoted out of the baseline in the same `session/metaChanged` as its artifact, and a URL the branch did not have joins the associated list with the empty baseline unchanged.
- `pnpm test` green: 33 files, 619 tests, the schema check included.
- `pnpm typecheck` and `pnpm boundary` green.

## Departures from the plan

- The store keeps an all-empty `PullRequestBaseline` rather than dropping it. The task's Files line about `memorySessions` taking the slot away when it is empty reads against the objective, because an empty `initialPullRequestUrls` is what tells a client the branch had none, and the promotion case writes an empty initial list beside a non-empty associated one in any case.
- The new `test/host.test.ts` capture cases use the directory's GitHub port rather than a second session, because the capture is a directory answer and one session is enough to show it.

## Left for later

- The two by-hand checklist items in [plan.md](plan.md) were not run as manual sessions; the same behaviours are covered by `test/host.test.ts` and `test/sessions.test.ts`.
