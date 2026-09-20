---
title: The session pull request baseline is sent, not inferred by every client
status: accepted
date: 2026-09-19
refs:
  - code://packages/sdk/src/host.ts#L2088 - where `pullRequestUrls` is written today, with no baseline beside it
  - src/vs/sessions/services/sessions/common/session.ts#L400 - the reference client rule this answers, inside the clone
  - src/vs/platform/agentHost/common/state/sessionState.ts#L1682-L1684 - the two keys, and the helpers that maintain them, inside the clone
---

## Context

The reference window now separates a session's own pull requests from ones that came with the checkout, so that the archive nudge's "all merged" test and the pull request pill's priority mean something.
It does that from two keys in the open `_meta.github` map: `initialPullRequestUrls`, the baseline a session started with, and `associatedPullRequestUrls`, the ones promoted to the session since, against `pullRequestUrls` as the whole set.
Neither key is protocol and neither is new in the reference: the file that defines them has not changed since before the last pass, so what changed is that the window began relying on them.
This host sends `pullRequestUrls` and no baseline at all, so every pull request it reports reads as inherited and the nudge's test cannot come true against it.

Asked on 2026-09-19 what to do, the answer was: "Adopt in ahpc and emit the baseline from ahpd."

## Decision

This host writes `initialPullRequestUrls` once, from the pull requests the branch already had when the session started, and moves a URL out of it into `associatedPullRequestUrls` when that pull request becomes the session's, which is the moment the reference promotes one.
`pullRequestUrls` keeps its present meaning as the whole set, so a client that knows only that key is unaffected.

## Consequences

A client can tell the two apart without guessing, and the rule lives in one place on the host rather than being re-derived per client.
The baseline has to be captured at session start and kept, so it is session state that survives a restart and has to be written where `_meta.github` is written, which is more than a field being added to one call.
The paired client change is recorded in the other repository's pass 4 review, and this decision is the half that makes it correct there.

## Options

Adopting the rule in the client only was rejected: it reads correctly against a VS Code host and still presents every inherited pull request as the session's own against this one.
Leaving `pullRequestUrls[0]` as the answer was rejected: the first entry is the most recent, not the session's, which is exactly the confusion the reference client fixed.
