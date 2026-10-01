---
title: A restored AskUserQuestion is drawn as the answered question, which VS Code's own Claude sessions do not do
status: accepted
date: 2026-09-30
refs:
  - "[code://packages/agent-claude/src/transcript.ts](../../packages/agent-claude/src/transcript.ts) - where a restored turn is built"
  - "[code://packages/agent-claude/src/session.ts#L1889-L1925](../../packages/agent-claude/src/session.ts#L1889-L1925) - the live question, a `chat/inputRequested` carousel"
  - git://ac05bdfe1e1 - VS Code `stateToProgressAdapter.ts` L61-L76 hides a completed, successful AskUserQuestion row and draws the turn's `inputRequest` part instead (L337-L371); `claudeReplayMapper.ts` builds no such part on restore
---

## Context

VS Code hides a completed AskUserQuestion tool row and draws the answered question from the turn's `inputRequest` part.
A live turn has that part, since the host's reducer records `chat/inputRequested` and `chat/inputCompleted`.
A turn rebuilt from the transcript after the daemon restarts has only the tool call, so VS Code draws nothing where the question was.
VS Code's own Claude sessions lose the question on restore the same way.

## Decision

A restored Claude turn carries an answered `inputRequest` part after each AskUserQuestion call whose transcript result has answers, shaped as the live one is and built by the same code.

## Consequences

A restored session reads in VS Code as it did live.
This goes past VS Code's own restore, so a later VS Code change to how a restored question is drawn has to be checked against it.

## Options

- Match VS Code and show nothing on restore: parity, but a session loses its questions and answers the moment the daemon restarts.

Source: Softov, 2026-09-30, asked "Should ahpd rebuild the answered question on restore?": "Rebuild it, in claude/11".
