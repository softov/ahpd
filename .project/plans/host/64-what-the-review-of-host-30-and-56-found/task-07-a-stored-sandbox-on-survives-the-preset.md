---
title: A stored sandbox on survives the preset
status: done
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session.ts#L73](../../../../packages/agent-claude/src/session.ts#L73) - the session's values"
  - "[code://packages/agent-claude/src/options.ts#L46-L54](../../../../packages/agent-claude/src/options.ts#L46-L54) - `sandbox`"
  - "[code://packages/sdk/test/host-sessionconfig.test.ts#L531-L539](../../../../packages/sdk/test/host-sessionconfig.test.ts#L531-L539) - the case that keeps a stored `sandboxEnabled`"
---

## Objective

A resumed Claude session whose stored config holds `sandboxEnabled: 'on'` (or `true`) runs with the CLI's sandbox on, as decision [a-stored-sandbox-on-survives-the-preset](../../../decisions/a-stored-sandbox-on-survives-the-preset.md) says; a stored `'off'`, `'default'`, `false` or none leaves the preset in charge.

## Files

- `UPDATE: packages/agent-claude/src/session.ts` - read the stored value on resume.
- `UPDATE: packages/sdk/test/host-sessionconfig.test.ts:531-539` - the case asserts the effect, not only that the key is kept.

## Steps

1. Failing case first: resume a session stored with `sandboxEnabled: 'on'` on a preset with no `sandbox`; the query must carry `settings.sandbox.enabled: true`.
2. Where a resumed session's values are built, a stored `sandboxEnabled` of `'on'` or `true` sets `sandbox: 'on'` over the preset. Nothing else of the stored key is read, and no schema key comes back.
3. A case for `sandboxEnabled: 'off'` on a preset with `sandbox: 'on'`: still on.

## Validation

- The first case fails on `main` and passes after.
- `pnpm exec vitest run packages/sdk/test/host-sessionconfig.test.ts packages/agent-claude/test`.

## Resume

Built 2026-10-06, after Softov answered the fork this task stopped on: the decision and this task now read a stored `'on'` (or `true`), with `'off'`, `'default'`, `false` and none leaving the preset in charge.

- Three cases in `packages/sdk/test/host-sessionconfig.test.ts`, in `describe("a session's config across a restart")`. Two of them failed first on the code standing before this task. `runs a resumed session in the sandbox its store holds, which its preset need not say` was answered `settings: undefined` where `{ sandbox: { enabled: true } }` was expected: a session stored `sandboxEnabled: 'on'` and a variant that names no sandbox resumed with no sandbox layer at all. `keeps a stored sandbox on over a preset that says off, in both spellings it was written in` was answered `{ sandbox: { enabled: false } }`, the preset's `off` winning over the store, for a stored `'on'` and for a stored `true`. The third, `lets a stored sandbox that is off, default or false leave the preset in charge`, passes before and after and holds the direction: `'off'`, `'default'` and `false` each leave a preset `sandbox: 'on'` on and add no layer of their own.
- `staleHost` gained an optional preset, so a stored value can be put against a preset that says the opposite. It is handed to `claude()` the way the variant case in this file already hands one.
- `options.ts` gained `storedSandbox(settings)`: `{ sandbox: 'on' }` for a stored `'on'` or `true`, and nothing for anything else. It sits beside the `sandbox` declaration whose word it borrows, so the one translation from a sandbox value to `settings.sandbox.enabled` stays in one place.
- `session.ts:73` spreads it after the preset - defaults, then what the variant holds, then what this session's own store holds - so it is the store that a preset cannot undo, which is the direction the decision asks for.
- `values` is read only where the query is built and where the flag settings are built, so nothing else moves with the stored value, and `ctx.settings` is untouched: the schema a client reads still has no `sandboxEnabled` key, and the sibling case that keeps the stored key in the config values still passes.
- `context.ts`'s `values` comment said these are "written by whoever configured this backend, never by a session's config keys". It now names the one exception, since that sentence is no longer true of this key.
- One departure from this task's Files: the case at `host-sessionconfig.test.ts:531-539` is left as it is, and the effect is asserted by the three cases added beside it instead. That one is about the config values a client reads back, which this fix deliberately does not move; the effect is about the query the CLI is built with. Merging them would put two subjects in one case, and the round trip is the one that would then be asserted only as a side effect.
- Validation: the two cases above fail before the fix and pass after; `pnpm exec vitest run packages/sdk/test/host-sessionconfig.test.ts packages/agent-claude/test` passes, 253 tests.
