---
title: The session pull request baseline is sent
domain: host
status: planned
priority: medium
created: 2026-09-19
revalidated: 2026-09-19
requires:
  - plans/host/01-artifact-tools/plan.md
changes: []
creates: []
decisions:
  - decisions/session-pull-request-baseline-is-sent.md
refs:
  - code://.project/review/2026-09-19-upstream-pass-4.md#L79 - the item: this host reports `pullRequestUrls` and no baseline, so every pull request reads as inherited
  - code://packages/sdk/src/host.ts#L2065-L2098 - `refreshPullRequests`, the only writer of `pullRequestUrls`
  - code://packages/sdk/src/host.ts#L1964-L1994 - `githubFacts` per directory and `metaOf`, where a session's baseline joins the map
  - code://packages/sdk/src/host.ts#L1751-L1769 - `operationContext`, which reads `pullRequestUrls` to say a branch has one
  - code://packages/sdk/src/host.ts#L3779-L3816 - `openSession`, where a session starts and its baseline is captured
  - code://packages/sdk/src/sessions.ts#L16-L29 - `memorySessions`, the slots a store holds
  - code://packages/sdk/src/sessions.ts#L45-L49 - `Saved`, the persisted shape that gains the baseline
  - code://packages/sdk/src/sessions.ts#L118-L153 - the load and the store a restart reads
  - code://packages/sdk/src/types/sessions.ts#L27-L57 - `SessionStore`, the port that gains the pair
  - code://test/sessions.test.ts#L78-L124 - the restart tests the baseline joins
  - code://test/host.test.ts#L6143-L6259 - the GitHub `_meta` suite
  - file:///github/externals/vscode/src/vs/platform/agentHost/common/state/sessionState.ts#L1674-L1696 - `ISessionGitHubState`, which declares the two keys
  - file:///github/externals/vscode/src/vs/platform/agentHost/common/state/sessionState.ts#L1761-L1786 - `withMostRecentRelatedSessionPullRequest` and `withInitialSessionPullRequest`
  - file:///github/externals/vscode/src/vs/platform/agentHost/node/agentHostGitStateService.ts#L175-L193 - the baseline captured when the checkout is attached, an empty array included
  - file:///github/externals/vscode/src/vs/platform/agentHost/node/agentHostPullRequestOperationProvider.ts#L276 - the promotion when the pull request becomes the session's
---

## Goal

A client can tell the pull request a session made from the ones the branch already had: `_meta.github` carries `initialPullRequestUrls`, the baseline captured once when the session started, and `associatedPullRequestUrls`, the URLs promoted to the session since, while `pullRequestUrls` keeps its meaning as the whole set.
The baseline survives a host restart.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "pullRequestUrls|initialPullRequestUrls|associatedPullRequestUrls" packages/sdk/src` - only `pullRequestUrls` is written, and only by `refreshPullRequests`.
- `rg -n "githubFacts" packages/sdk/src/host.ts` - one map keyed by directory, so a baseline beside it has to be per session.
- `rg -n "pullRequests|setArtifacts" packages/sdk/src/sessions.ts` - the store's existing slots; no pull-request slot exists.
- `rg -n "openSession" packages/sdk/src/host.ts` - the one place a session begins.
- `rg -n "withInitialSessionPullRequest|withMostRecentRelatedSessionPullRequest" /github/externals/vscode/src` - the two helpers the reference keeps the baseline with.

### Runtime path

```
createSession | startForAutomation -> openSession
  -> the directory's facts, already asked at startup, are the branch's pull requests
  -> initialPullRequestUrls captured once into the session store
create-pr -> recordPullRequest (plan 01) -> the URL becomes the session's
  -> associatedPullRequestUrls gains it, initialPullRequestUrls loses it
  -> _meta.github composed by metaOf for every session in the directory
  -> session/metaChanged and root/sessionSummaryChanged
```

### Gaps

- `Not found: any baseline key - searched "initialPullRequestUrls" and "associatedPullRequestUrls" in packages/; only the reference has them.`
- `Not found: a place to keep a session's baseline - searched "pullRequests" in packages/sdk/src/sessions.ts and types/sessions.ts; the store holds flags, config, artifacts and chat titles alone.`
- A directory's facts are shared by every session there while the baseline is each session's, so the baseline cannot live in `githubFacts` and `metaOf` is where the two meet.
- The capture has to happen before the session's first turn, or a pull request the turn creates would read as inherited.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [The session pull request baseline is sent, not inferred by every client](../../../decisions/session-pull-request-baseline-is-sent.md) | Softov, 2026-09-19: "Adopt in ahpc and emit the baseline from ahpd." |

| What | Source | Task |
| --- | --- | --- |
| `initialPullRequestUrls` is captured once, and an empty array is a captured baseline | reference `agentHostGitStateService.ts#L175-L193` and `sessionState.ts:1681` | 01 |
| A URL moves from `initialPullRequestUrls` to `associatedPullRequestUrls` when the pull request becomes the session's, which is the create-pr association | decision 1 and reference `agentHostPullRequestOperationProvider.ts:276` | 02 |
| `pullRequestUrls` keeps its meaning as the whole set | decision 1 | 01, 02 |
| The baseline is per session and persisted in the session store, not in the per-directory `githubFacts` | (defaulted: one session's baseline is not another's) | 01 |
| The promotion runs inside plan 01's `recordPullRequest`, so the artifact and the baseline move in one write | (defaulted: one association moment) | 02 |

## Proposed architecture

- **Data flow** - `sessions.ts` gains a pull-request slot per session id shaped as `{ initialPullRequestUrls, associatedPullRequestUrls }`. `host.ts` captures the initial set once when a session opens or when its directory's facts first answer, and `metaOf` spreads the slot onto the directory's `github` object.
- **Event flow** - the capture writes to the store and lets the next `session/metaChanged` carry it; the promotion runs inside plan 01's `recordPullRequest` before `metaMoved`, so one map move says both.
- **State flow** - the baseline is session state and is written down by the file store, so a restart returns the same split. The directory facts stay in memory and are asked again.
- **Layer responsibilities** - packages/sdk: the slot in `sessions.ts` and `types/sessions.ts`, the capture, the merge and the promotion in `host.ts` · test/: the restart, the capture-once rule and the promotion.
- **Source-of-truth files** - `code://packages/sdk/src/host.ts`, `code://packages/sdk/src/sessions.ts`.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The baseline at session start](task-01-baseline-at-session-start.md) | todo | - |
| [02 - The promotion on association](task-02-promote-on-association.md) | todo | 01 |

## Risks and tradeoffs

- A session created in a directory whose facts have not answered has no baseline until they do; the capture runs on the first answer for that directory and the rule is once, so the first answer is the baseline.
- A directory shared by two sessions has one set of facts and two baselines; the merge in `metaOf` is where they stay apart.
- An empty `initialPullRequestUrls` is a captured baseline and not an absent one, which is what lets a client tell the two apart (reference comment at `sessionState.ts:1681`).
- The store gains a slot that is absent for most sessions, and an empty baseline is written as `[]` only where it was captured, so the file does not grow for sessions nobody asked about.
- The promotion needs plan 01's association moment, which is why this plan requires it.

## Resume state

- **Done so far:** nothing; the plan and its two task files were written 2026-09-19.
- **Next action:** [task-01-baseline-at-session-start.md](task-01-baseline-at-session-start.md).
- **Open questions:**
  1. Does the window read `associatedPullRequestUrls` for a session whose baseline was never captured? - proposed: it treats an absent baseline as "unknown" and falls back to present behaviour, which is what the reference's optional keys allow.
- **Watch out for:** the merge order in `metaOf`, because the baseline must not be overwritten by `refreshPullRequests`, and an empty array must survive the presence check.

## Final verification checklist

- [ ] `pnpm test` green, with new cases in `test/sessions.test.ts` and `test/host.test.ts`.
- [ ] `pnpm typecheck` and `pnpm boundary` green.
- [ ] By hand: a session opened on a branch with an existing pull request reports it under `initialPullRequestUrls`, and `create-pr` moves it to `associatedPullRequestUrls`.
- [ ] By hand: restart the host on the same session file and the split is unchanged.
- [ ] `plans/index.md` updated.
