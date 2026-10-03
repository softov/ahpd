---
title: The session state says only what SessionState declares, and its config schema says it is an object
status: todo
depends: []
layer: "sdk, agent-acp, agent-cofold, examples"
refs:
  - "[code://packages/sdk/src/host.ts#L4762-L4776](../../../../packages/sdk/src/host.ts#L4762-L4776) - `published()`, which every backend schema passes through on its way out"
  - "[code://packages/sdk/src/host.ts#L9475-L9478](../../../../packages/sdk/src/host.ts#L9475-L9478) - `resolveSessionConfig` answers `{ ...theirs, properties }`"
  - "[code://packages/sdk/src/host.ts#L6537-L6540](../../../../packages/sdk/src/host.ts#L6537-L6540) - the session state starts from `...theirs`"
  - "[code://examples/echo/agent.ts#L61-L80](../../../../examples/echo/agent.ts#L61-L80) - echo's schema, with no `type`"
  - "[code://examples/echo/agent.ts#L232](../../../../examples/echo/agent.ts#L232) - `resource: start.uri` on the session state"
  - "[code://examples/notes/agent.ts#L569](../../../../examples/notes/agent.ts#L569) - the same in notes"
  - "[code://packages/agent-acp/src/session.ts#L1748](../../../../packages/agent-acp/src/session.ts#L1748) - the same in acp"
  - "[code://packages/agent-cofold/src/session.ts#L1239](../../../../packages/agent-cofold/src/session.ts#L1239) - the same in cofold"
  - "[code://packages/agent-claude/src/session.ts#L3088-L3089](../../../../packages/agent-claude/src/session.ts#L3088-L3089) - claude already leaves `resource` off, and says why"
  - "npm://@microsoft/agent-host-protocol@0.9.0 - `SessionConfigSchema.type: 'object'` required (`channels-session/state.ts:579-585`); `SessionState` and `SessionMetadata` declare no `resource`"
---

## Objective

Every session config schema ahpd publishes, in `resolveSessionConfig` and on `SessionState.config`, carries `type: 'object'`, and no session state carries `resource`, whichever backend built it.

## Files

- `UPDATE: packages/sdk/src/host.ts:4762-4776` - `published()` sets `type: 'object'` on what it answers, properties or not.
- `UPDATE: packages/sdk/src/host.ts:6537-6540` - `resource` is taken off the backend's answer before the state is built.
- `UPDATE: examples/echo/agent.ts:232`, `examples/notes/agent.ts:569`, `packages/agent-acp/src/session.ts:1748`, `packages/agent-cofold/src/session.ts:1239` - stop sending `resource`, with claude's comment as the reason.
- `UPDATE: packages/sdk/test/wire.test.ts` - the `ResolveSessionConfigResult /schema`, `SessionState /config/schema` and `SessionState /` `resource` lines leave `KNOWN`.

## Steps

1. Read whether any host code reads `theirs.resource` (`rg -n "\.resource" packages/sdk/src/host.ts` near :6537); the channel is the URI, so nothing should.
2. Set `type` in `published()`, so the running schema, the resolved schema and the snapshot all get it from one place.
3. Strip `resource` in the host, then drop it in the four backends.

## Validation

- `packages/sdk/test/wire.test.ts` passes with the three lines gone from `KNOWN`; its echo session is subscribed and its `resolveSessionConfig` is asked with `provider: 'echo'`.
- `pnpm test` passes, the acp and cofold session tests among them.

## Resume
