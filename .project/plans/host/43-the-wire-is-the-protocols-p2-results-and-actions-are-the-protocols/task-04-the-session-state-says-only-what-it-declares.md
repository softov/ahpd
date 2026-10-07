---
title: The session state says only what SessionState declares, and its config schema says it is an object
status: done
depends: []
layer: "sdk, agent-acp, agent-cofold, examples"
refs:
  - "[code://packages/sdk/src/host/sessionconfig.ts#L300-L314](../../../../packages/sdk/src/host/sessionconfig.ts#L300-L314) - `published()`, which every backend schema passes through on its way out"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L828-L850](../../../../packages/sdk/src/host/sessionmethods.ts#L828-L850) - `resolveSessionConfig` answers `{ ...theirs, properties }`"
  - "[code://packages/sdk/src/host/snapshots.ts#L224-L232](../../../../packages/sdk/src/host/snapshots.ts#L224-L232) - where the session state is built from the backend's answer"
  - "[code://examples/echo/agent.ts#L61-L81](../../../../examples/echo/agent.ts#L61-L81) - echo's schema, with no `type`"
  - "[code://examples/echo/agent.ts#L231](../../../../examples/echo/agent.ts#L231) - echo's session state"
  - "[code://examples/notes/agent.ts#L568](../../../../examples/notes/agent.ts#L568) - the same in notes"
  - "[code://packages/agent-acp/src/session.ts#L189](../../../../packages/agent-acp/src/session.ts#L189) - the same in acp"
  - "[code://packages/agent-cofold/src/session.ts#L251](../../../../packages/agent-cofold/src/session.ts#L251) - the same in cofold"
  - "[code://packages/agent-claude/src/session.ts#L180-L182](../../../../packages/agent-claude/src/session.ts#L180-L182) - claude already leaves `resource` off, and says why"
  - "npm://@microsoft/agent-host-protocol@1.0.0 - `SessionConfigSchema.type: 'object'` required (`channels-session/state.ts:634-641`); `SessionState` and `SessionMetadata` declare no `resource`"
---

## Objective

Every session config schema ahpd publishes, in `resolveSessionConfig` and on `SessionState.config`, carries `type: 'object'`, and no session state carries `resource`, whichever backend built it.

## Files

- `UPDATE: packages/sdk/src/host/sessionconfig.ts:300-314` - `published()` sets `type: 'object'` on what it answers, properties or not.
- `UPDATE: packages/sdk/src/host/snapshots.ts:217-232` - `resource` is taken off the backend's answer before the state is built.
- `UPDATE: examples/echo/agent.ts:231`, `examples/notes/agent.ts:568`, `packages/agent-acp/src/session.ts:189`, `packages/agent-cofold/src/session.ts:251` - stop sending `resource`, with claude's comment as the reason.
- `UPDATE: packages/sdk/test/wire.test.ts` - the `ResolveSessionConfigResult /schema`, `SessionState /config/schema` and `SessionState /` `resource` lines leave `KNOWN`.

## Steps

1. Read whether any host code reads `theirs.resource` (`rg -n "\.resource" packages/sdk/src/host.ts` near :6537); the channel is the URI, so nothing should.
2. Set `type` in `published()`, so the running schema, the resolved schema and the snapshot all get it from one place.
3. Strip `resource` in the host, then drop it in the four backends.

## Validation

- `packages/sdk/test/wire.test.ts` passes with the three lines gone from `KNOWN`; its echo session is subscribed and its `resolveSessionConfig` is asked with `provider: 'echo'`.
- `pnpm test` passes, the acp and cofold session tests among them.

## Resume
