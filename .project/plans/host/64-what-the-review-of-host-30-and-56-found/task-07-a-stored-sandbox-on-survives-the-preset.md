---
title: A stored sandbox on survives the preset
status: todo
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session.ts#L73](../../../../packages/agent-claude/src/session.ts#L73) - the session's values"
  - "[code://packages/agent-claude/src/options.ts#L46-L54](../../../../packages/agent-claude/src/options.ts#L46-L54) - `sandbox`"
  - "[code://packages/sdk/test/host-sessionconfig.test.ts#L531-L539](../../../../packages/sdk/test/host-sessionconfig.test.ts#L531-L539) - the case that keeps a stored `sandboxEnabled`"
---

## Objective

A resumed Claude session whose stored config holds `sandboxEnabled: true` runs with the CLI's sandbox on, as decision [a-stored-sandbox-on-survives-the-preset](../../../decisions/a-stored-sandbox-on-survives-the-preset.md) says; a stored `false` or none leaves the preset in charge.

## Files

- `UPDATE: packages/agent-claude/src/session.ts` - read the stored value on resume.
- `UPDATE: packages/sdk/test/host-sessionconfig.test.ts:531-539` - the case asserts the effect, not only that the key is kept.

## Steps

1. Failing case first: resume a session stored with `sandboxEnabled: true` on a preset with no `sandbox`; the query must carry `settings.sandbox.enabled: true`.
2. Where a resumed session's values are built, a stored `sandboxEnabled === true` sets `sandbox: 'on'` over the preset. Nothing else of the stored key is read, and no schema key comes back.
3. A case for `sandboxEnabled: false` on a preset with `sandbox: 'on'`: still on.

## Validation

- The first case fails on `main` and passes after.
- `pnpm exec vitest run packages/sdk/test/host-sessionconfig.test.ts packages/agent-claude/test`.

## Resume
