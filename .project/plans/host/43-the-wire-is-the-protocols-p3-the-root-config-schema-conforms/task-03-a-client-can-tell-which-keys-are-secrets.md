---
title: A client can tell which root config keys are secrets
status: dropped
depends: [task-01-the-schema-is-mapped-to-config-property-schema.md]
layer: "server, sdk"
refs:
  - "[code://packages/server/src/commands/config.ts#L84](../../../../packages/server/src/commands/config.ts#L84) - `maskValue`, which already reads `writeOnly` to answer `<set>`"
  - "[code://packages/server/src/rootconfig.ts#L156-L180](../../../../packages/server/src/rootconfig.ts#L156-L180) - `pluginKey`, where the mask is applied to a plugin's options"
  - "[code://packages/sdk/src/host.ts#L6191-L6192](../../../../packages/sdk/src/host.ts#L6191-L6192) - where `RootState.config` is built, beside `RootState._meta`"
  - "npm://@microsoft/agent-host-protocol@1.0.0 - `RootState._meta` (`channels-root/state.ts:53`); `ConfigPropertySchema` has no `_meta`"
---

## Objective

A `config:read` connection can tell which root config keys hold a secret, in the place open question 2 answers, and no property carries `writeOnly`.

## Files

- `UPDATE: packages/server/src/rootconfig.ts` - collect the paths of every `writeOnly` property, `additionalProperties` included, as the answer requires.
- `UPDATE: packages/sdk/src/host.ts` and `packages/sdk/src/types/host.ts` - if the answer is `RootState._meta`, the root config port gains a way to say the paths and the host puts them there for a `config:read` connection only.
- `UPDATE: packages/sdk/test/wire.test.ts` - the `writeOnly` lines leave `KNOWN`; the census in p1 task 04 allows the new key.
- `UPDATE: docs/AHP.md` - root config's row says where secrets are named.

## Steps

Dropped: Softov answered "Not sent", so no client is told which keys are secrets; `writeOnly` leaves the wire in task 01 and nothing replaces it.

2. Build the path list from the unmapped schema, so it names exactly what the mask masks.
3. Send it where the answer says.

## Validation

- `packages/sdk/test/wire.test.ts` passes with no `writeOnly` line in `KNOWN`, and, if the answer is `_meta`, its root snapshot carries the plugin's secret path for `ana` and not for a connection without `config:read`.
- `pnpm test` passes.

## Resume
