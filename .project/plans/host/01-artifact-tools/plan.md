---
title: Artifact tools promote in place and record a pull request
domain: host
status: built
priority: high
created: 2026-09-19
revalidated: 2026-09-19
requires: []
changes: []
creates: []
decisions:
  - decisions/artifact-answers-match-the-reference.md
  - decisions/pull-request-artifact-on-both-paths.md
refs:
  - code://.project/review/2026-09-19-upstream-pass-4.md#L25-L27 - the three items this plan takes: promotion, the answer shape, and the pull request recorded as an artifact
  - code://packages/sdk/src/artifacttools.ts#L173-L193 - the ADD run, where a duplicate is answered "Already recorded" and a reference is never promoted
  - code://packages/sdk/src/artifacttools.ts#L207-L215 - the REMOVE run, whose answer still describes the entry
  - code://packages/sdk/src/artifacttools.ts#L113-L121 - `valueOf` and `describe`, the value rule the match uses and the one answer that keeps describing entries
  - code://packages/sdk/src/changes.ts#L560-L584 - the reused and opened returns of `create-pr`, neither of which records anything
  - code://packages/sdk/src/types/changes.ts#L205-L220 - `ChangesetOperationResult`, which gains the pull request the operation produced
  - code://packages/sdk/src/host.ts#L4942-L5037 - `invokeChangesetOperation`, whose success path is where the host sees the result and can write session state
  - code://packages/sdk/src/host.ts#L5004-L5018 - the success path itself: the status, the refresh, and the message and follow-up it returns
  - code://packages/sdk/src/host.ts#L2002-L2007 - `setArtifacts`, the one write that replaces the recorded list and moves the row
  - code://packages/sdk/src/host.ts#L1964-L1994 - `githubFacts` and `metaOf`, where `_meta.github` is composed
  - code://packages/sdk/src/host.ts#L2065-L2098 - `refreshPullRequests`, which writes `pullRequestUrls` from GitHub's answer for a directory
  - code://packages/sdk/src/github.ts#L38-L71 - `byApi` and `byGh`, which answer a url and a state and can carry the title too
  - code://packages/sdk/src/types/github.ts#L6-L11 - `PullRequest`, which carries no title today
  - code://test/artifacttools.test.ts#L63-L88 - the answers asserted today for the three tools
  - code://test/pullrequest.test.ts#L125-L167 - the two `create-pr` cases, where the result gains its pull request
  - code://test/host.test.ts#L6143-L6327 - the GitHub `_meta` suite and the recorded-artifact suite
  - file:///github/externals/vscode/src/vs/platform/agentHost/common/sessionArtifactCollection.ts#L149-L175 - `add` and `addOrPromoteArtifact`: a match is promoted in place and keeps its id
  - file:///github/externals/vscode/src/vs/platform/agentHost/node/shared/artifactServerTools.ts#L212-L237 - the reference's ADD and REMOVE answers, which are the status and the id
  - file:///github/externals/vscode/src/vs/platform/agentHost/node/agentHostPullRequestOperationProvider.ts#L260-L276 - both the opened and the reused path record one artifact and promote the URL
---

## Goal

A skill or prompt written for the reference host gets the same words back from this one, a value the session already holds as a reference is promoted to an artifact in place rather than handed back as a duplicate, and the pull request a `create-pr` opened or reused is recorded as a session artifact with its URL associated with the branch.
The three artifact tools answer `<status>: <id>`, and `list_artifacts_and_references` keeps describing its entries.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "Already recorded|Promoted artifact|addOrPromoteArtifact" packages/` - nothing promotes; the reference has `addOrPromoteArtifact` and its own status words.
- `rg -n "describe\(" packages/sdk/src/artifacttools.ts` - three call sites, the duplicate, the removal and the list; only the list should keep it.
- `rg -n "artifact|setArtifacts" packages/sdk/src/changes.ts` - nothing; the changes source reaches no session store.
- `rg -n "ChangesetOperationResult" packages/sdk/src` - the two `create-pr` returns and the host's one reader, so the result is where a produced pull request can travel.
- `rg -n "title" packages/sdk/src/types/github.ts packages/sdk/src/github.ts` - absent, so the reused path has no title to label an artifact with.
- `rg -n "pullRequestUrls" packages/sdk/src/host.ts` - written in `refreshPullRequests` and read in `operationContext` alone.

### Runtime path

```
client invokeChangesetOperation create-pr
  -> changes.ts pushes, asks for an open pull request, reuses it or opens one
  -> ChangesetOperationResult { message, followUp, pullRequest }
  -> host.ts records the artifact and writes the URL onto _meta.github
  -> session/metaChanged and root/sessionSummaryChanged
  -> the window draws an artifact pill and the row's pull request
add_artifact_or_reference -> match on value -> a reference re-added as an artifact
  -> promoted in place, id kept -> "Promoted artifact: <id>"
```

### Gaps

- `Not found: addOrPromoteArtifact or any promotion - searched "promot" and "Already recorded" in packages/ and test/; this host discards the upgrade and answers "Already recorded".`
- `Not found: a title on the reused path - searched "title" in packages/sdk/src/types/github.ts and packages/sdk/src/github.ts; PullRequest carries a url and a state only.` The label falls back to the title derived from the subject, and a port that answers a title is used when it does.
- `Not found: any artifact write in changes.ts - searched "artifact" and "setArtifacts" there; the source holds no store, so the host is where the record goes.`
- The promotion rule would exist twice, once in the ADD tool and once in the host; it is written once as an exported helper and the tool is one caller.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [Artifact tool answers are the reference's, status and id only](../../../decisions/artifact-answers-match-the-reference.md) | Softov, 2026-09-19: "Match the reference exactly: `<status>: <id>`." |
| 2 | [A pull request is recorded as an artifact whether it was opened or reused](../../../decisions/pull-request-artifact-on-both-paths.md) | Softov, 2026-09-19: "Both opened and reused, as the reference does." |

| What | Source | Task |
| --- | --- | --- |
| Promotion keeps the id the entry already had, and a duplicate never downgrades an artifact | reference `addOrPromoteArtifact`, `sessionArtifactCollection.ts#L164-L175` | 01 |
| The statuses are `Added artifact`, `Added reference`, `Promoted artifact`, `Already recorded`, `Removed artifact`, `Removed reference` | reference `artifactServerTools.ts#L216-L236` | 01 |
| `list_artifacts_and_references` keeps describing entries | decision 1 | 01 |
| The artifact is `type: pullRequest`, `isArtifact: true`, labelled with the pull request's title and linked to its URL | decision 2 | 02 |
| The URL is associated with the branch under `_meta.github` on both paths | decision 2 and reference `agentHostPullRequestOperationProvider.ts:276` | 02 |
| The reused pull request's title is the port's when it has one, and the subject's title otherwise | (defaulted: `PullRequest` answers a url and a state today) | 02 |
| The association is written before `refreshFacts` is called, so GitHub's later answer is the one that survives | (defaulted: one write per turn, and the operation's own refresh follows it) | 02 |

## Proposed architecture

- **Data flow** - `artifacttools.ts` exports `recordArtifact(held, one, mintId)`, which is the reference's `addOrPromoteArtifact`: match on `valueOf`, promote a reference to an artifact in place with the id it had, never downgrade, and answer with the status word and the entry. The ADD tool and the host's pull-request path are its two callers.
- **Event flow** - `create-pr` puts the pull request on `ChangesetOperationResult.pullRequest`; `invokeChangesetOperation` records it after `invoke` resolves and before it returns, so the artifact and `_meta.github` move in the same beat as the operation's own refresh.
- **State flow** - the artifact list is replaced whole by `setArtifacts`, which composes `metaOf` and dispatches `session/metaChanged`. The branch association is written into `githubFacts` for the directory and `metaMoved` dispatches the map to every session there.
- **Layer responsibilities** - packages/sdk: the promote rule and the answers in `artifacttools.ts`, the produced pull request in `changes.ts` and `types/changes.ts`, the recording and the association in `host.ts`, the title on `github.ts` and `types/github.ts` · test/: the answers, the promotion, both `create-pr` paths and the `_meta.github` association.
- **Source-of-truth files** - `code://packages/sdk/src/artifacttools.ts`, `code://packages/sdk/src/changes.ts`, `code://packages/sdk/src/host.ts`.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The answers and the promotion](task-01-promote-and-answers.md) | done | - |
| [02 - The pull request artifact](task-02-pull-request-artifact.md) | done | 01 |

## Risks and tradeoffs

- The promotion rule in two files is the rule drifting, so it is one exported function and both callers use it.
- A person reading a transcript sees an id where the entry used to be spelled out, which is the comfort decision 1 gave up; `list_artifacts_and_references` is where the entry stays readable.
- `githubFacts` is a directory's and the artifact is a session's, so two sessions in one directory see one `pullRequestUrls`; the association writes the directory facts and `metaOf` puts them on every session there.
- Recording after `refreshFacts` would let GitHub's answer overwrite the association before a client saw it, so the record happens first and the refresh follows.
- The reused path has no title today; the fallback keeps the label honest rather than inventing one from a branch name.

## Resume state

- **Done so far:** both tasks are done; the promotion rule, the status-and-id answers and the pull request artifact are in place and verified. See [implemented.md](implemented.md).
- **Next action:** none; the plan is built.
- **Open questions:**
  1. Does the window or a skill assert on the answer bytes beyond the status and the id? - answered: no; the tests assert the status word and the id, which is what decision 1 fixed.
- **Watch out for:** a duplicate artifact stays `Already recorded`, and only a reference arriving as an artifact is promoted; the removal answer names the id and not the entry.

## Final verification checklist

- [x] `pnpm test` green, with the new cases in `test/artifacttools.test.ts`, `test/pullrequest.test.ts` and `test/host.test.ts`.
- [x] `pnpm typecheck` and `pnpm boundary` green.
- [x] By hand: re-adding a value already held as a reference answers `Promoted artifact: <id>` and the list holds one entry under the id it had.
- [x] By hand: `create-pr` on a branch whose pull request is already open records one artifact and puts its URL on `_meta.github`.
- [x] `plans/index.md` updated.
