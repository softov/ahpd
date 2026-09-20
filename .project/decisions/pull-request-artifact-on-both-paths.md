---
title: A pull request is recorded as an artifact whether it was opened or reused
status: accepted
date: 2026-09-19
refs:
  - code://packages/sdk/src/changes.ts#L565-L585 - the two returns of `create-pr`, neither of which records anything
  - code://UPSTREAM.md - the Pass 3 box that already claims this and was ticked without it
  - src/vs/platform/agentHost/node/agentHostPullRequestOperationProvider.ts#L260-L276 - the reference, which records both through one finalize step, inside the clone
---

## Context

The `agentHost/sessionArtifacts` map is what a window draws pills from, and the reference host records the pull request a changeset operation produced as one of those artifacts, labelled with its title and linked to its URL.
This host claims the same thing: `UPSTREAM.md` has a ticked box reading "a pull request made by `prepare-pull-request` is one such artifact", and no code in the SDK writes one, which a grep over `packages/sdk/src/changes.ts` settles.
The reference does not distinguish the two ways a pull request comes to exist: a newly opened one and one that was already open for the branch both pass through the same finalize, and both become the session's artifact.

Asked on 2026-09-19 which paths should record one, the answer was: "Both opened and reused, as the reference does."

## Decision

`create-pr` records a `pullRequest` artifact on both of its return paths, with `isArtifact: true`, the pull request's title as the label and its URL as the link, and the URL is associated with the branch in `_meta.github` on both paths too.
The pass-3 box is re-opened and ticked again only by the commit that lands this.

## Consequences

A reused pull request stops being invisible in the artifact row, and the promise the pass-3 box made becomes true rather than aspirational.
Both paths have to build the artifact, so the recording belongs where the two paths meet rather than in each of them, which is what the reference's single finalize step is for.
It depends on promotion existing, because a pull request URL the agent already recorded as a reference must become the artifact rather than a second entry.

## Options

Recording only a newly opened pull request was rejected: a reused one is the case where the session's pull request is easiest to lose track of, since no event announces it.
Dropping the artifact claim and unticking the pass-3 box was rejected: it removes the inconsistency by giving up a feature the window draws from, and the reference shows the feature is real.
