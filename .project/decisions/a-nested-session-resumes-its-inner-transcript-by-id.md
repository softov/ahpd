---
title: A nested session is resumed by resuming the inner transcript by id
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/sdk/src/nested.ts#L232](../../packages/sdk/src/nested.ts#L232) - `innerSession`, a fresh random URI today"
  - "[code://packages/sdk/src/nested.ts#L376-L381](../../packages/sdk/src/nested.ts#L376-L381) - the inner `createSession`, made whatever `start.resume` says"
  - "[code://packages/sdk/src/host.ts#L2919-L2976](../../packages/sdk/src/host.ts#L2919-L2976) - `spawn`, which hands `resume`, `seed`, `forkAt`, `rewindAt` and `context` to the backend"
  - "[code://packages/agent-cofold/src/session.ts#L179-L189](../../packages/agent-cofold/src/session.ts#L179-L189) - cofold continues the session id it is resumed with"
---

## Context

The proxy reads none of `start.resume`, `seed`, `forkAt`, `rewindAt` or `context`, and always creates a new inner session under a random id.
A nested session resumed after the outer daemon restarts therefore starts a blank inner session, and the conversation is lost even though the inner cofold still holds it in the machine.

## Decision

The proxy passes `resume` through: the inner session is addressed by the id the outer host resumes, and the inner host resumes its own transcript by that id rather than creating a new session.
Source: Softov, 2026-09-26, asked "Resume: should a nested session (a) resume the inner cofold transcript by id (the proxy passes `resume` through), (b) be marked not resumable, or (c) copy transcripts out of the machine?": "pass `resume` through to the inner host, which resumes the inner transcript by id".

## Consequences

The inner session's id has to be the outer one, so the id a resume names is the id the inner host stored the transcript under.
A resume only works while the machine keeps the inner transcript: a disposable machine that has gone takes the transcript with it, and that resume fails with a sentence.
Fork and rewind stay unavailable for a nested session, because the proxy answers no `forkPoint` or `endPoint`.

## Options

- **Mark a nested session not resumable.** Honest and small, but a daemon restart ends every conversation in a machine.
- **Copy transcripts out of the machine to the outer host.** Survives a disposable machine, but is a second store to keep in step with the inner one.
