---
title: Each echo is the client's action
status: todo
depends: []
layer: host
refs:
  - "[code://packages/sdk/src/host/chatactions.ts#L1626-L1675](../../../../packages/sdk/src/host/chatactions.ts#L1626-L1675) - the switch's echo"
  - "[code://packages/sdk/src/host/actions.ts#L358-L373](../../../../packages/sdk/src/host/actions.ts#L358-L373) - the restart mark's echo"
  - "[code://packages/sdk/src/host/chatactions.ts#L1072-L1154](../../../../packages/sdk/src/host/chatactions.ts#L1072-L1154) - `taking`"
  - "[code://packages/sdk/src/host/sessionconfig.ts#L427-L470](../../../../packages/sdk/src/host/sessionconfig.ts#L427-L470) - `runningSchema`"
---

## Objective

A switch, a root push naming the restart mark, and a config change are each said as the client sent them.
A running session's schema is the declared schema.

## Files

- `UPDATE: packages/sdk/src/host/chatactions.ts:1626-1675` - the switch said as sent.
- `UPDATE: packages/sdk/src/host/actions.ts:358-373` - the restart mark said as sent.
- `UPDATE: packages/sdk/src/host/root.ts:360-371` - the mark's property comment.
- `UPDATE: packages/sdk/src/host/chatactions.ts:1072-1154` - `taking` takes `true` or a sentence.
- `UPDATE: packages/sdk/src/types/session.ts:428-433` - `ConfigTaken` is `true` or a sentence.
- `UPDATE: packages/sdk/src/types/session.ts:810-832` - `setConfig`'s contract.
- `UPDATE: packages/sdk/src/host/sessionconfig.ts:427-470` - `runningSchema` is the session schema, frozen.
- `UPDATE: packages/sdk/test/host-tools.test.ts:2580-2600` - a member's host-wide switch said as sent.
- `UPDATE: packages/sdk/test/root-config.test.ts:955-979` - a stale save of the mark said as sent.
- `UPDATE: packages/sdk/test/host-sessionconfig.test.ts:547-574` - an answer under the backend's keys takes nothing.
- `UPDATE: packages/sdk/test/session-fixed-key.test.ts:279-340` - a fixed key shown as declared.
- `UPDATE: docs/sdk/AHP.md` - the `session/customizationToggled` and `session/configChanged` rows.
- `UPDATE: docs/sdk/AGENT.md` - `setConfig`'s answers.
- `UPDATE: docs/sdk/HOST.md` - the `ahpd.restartNeeded` row.

## Steps

1. Say a switch as the client sent it.
2. Say a root push naming the restart mark as sent.
3. Take `true` or a sentence from `setConfig`, and say the client's keys.
4. Publish the running schema as declared.
5. Change the cases that pinned each rewrite.
6. Describe each echo in the docs.

## Validation

- Each changed case fails on `cde4dd6c` and passes after.
- The tools, root config, session config and fixed key test files pass.
- `pnpm run typecheck` is clean.

## Resume

Not started.
