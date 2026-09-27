---
title: The model a cofold turn ran on is kept in cofold's own store, and the transcript reads it back
status: accepted
date: 2026-09-27
refs:
  - file:///github/cofold/packages/agents/src/types/store.ts - `RunRecord`, which holds no model id
  - "[code://packages/agent-cofold/src/transcript.ts#L236-L244](../../packages/agent-cofold/src/transcript.ts#L236-L244) - a rebuilt turn's `message`, with no `model`"
  - "[code://packages/agent-claude/src/transcript.ts#L256](../../packages/agent-claude/src/transcript.ts#L256) - claude reads the model back from its own session file"
  - "[code://packages/sdk/src/host.ts#L7968-L7980](../../packages/sdk/src/host.ts#L7968-L7980) - the host's `SessionStore` keeps config only for a session with no running agent"
---

## Context

The protocol keeps a turn's model on `Message.model`, and VS Code picks a reopened session's model from its last turn.
A cofold turn's model is not on its message, and nothing cofold stores records it, so after a restart every cofold session reopens on "default".
With no model configured, "default" is a turn that fails by decision [a-cofold-turn-with-no-model-fails-and-says-where-to-name-one](a-cofold-turn-with-no-model-fails-and-says-where-to-name-one.md).

## Decision

`@cofold/agents` records on each `RunRecord` the model the run used, and agent-cofold's `transcript()` puts it on each rebuilt turn's `message.model` and `usage.model`, as the reference the backend offered (`<provider>/<model>`).
The host's `SessionStore` does not keep a turn's model.

Source: Softov, 2026-09-27, asked "Where should a cofold session's model be kept so a restart can read it back?": "cofold's store".

## Consequences

The backend owns what its turns ran on, as claude's does: its rebuilt turns carry `usage.model` from its own session files, and VS Code reads a past request's model from `message.model` or else `usage.model`.
It is a cofold release, through its `release.yml` and approved by Softov, before ahpd can read it.
A run recorded before that release has no model, and its turn is rebuilt without one.

## Options

- **ahpd's `SessionStore`**: no cofold release, but the host would keep what the backend should own, which claude's backend already does for itself.
