---
title: The ahpd-only chips move into presets
status: done
depends: [task-02-presets-and-the-preset-key.md]
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/claude.ts#L221-L263](../../../../packages/agent-claude/src/claude.ts#L221-L263) - the three keys"
  - "[code://packages/agent-claude/src/session.ts#L2962-L3026](../../../../packages/agent-claude/src/session.ts#L2962-L3026) - their live `setConfig` paths"
  - "[code://packages/sdk/test/fixtures/wire.jsonl](../../../../packages/sdk/test/fixtures/wire.jsonl) - the recorded schema"
---

## Objective

`outputStyle`, `thinking` and `sandboxEnabled` are no longer session keys; their values come only from the preset, and `permissionMode` keeps its six values.

## Files

- `UPDATE: packages/agent-claude/src/claude.ts` - the three keys leave `schema()` and `defaults()`.
- `UPDATE: packages/agent-claude/src/session.ts` - their live `setConfig` branches go.
- `UPDATE:` the tests that assert the schema, and `packages/sdk/test/fixtures/wire.jsonl`.

## Steps

1. Tests first: the schema has none of the three keys and still has `permissionMode` with `dontAsk`; a preset's `thinking: "disabled"` reaches `query()`.
2. Remove the keys and their branches.

## Validation

- The new cases fail first and pass after.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.
- By hand in ahpapp: the composer shows no Output style, Thinking or Sandbox chip.

## Resume

Done: `outputStyle`, `thinking` and `sandboxEnabled` are out of `schema()` and `defaults()`, so no composer draws them and `permissionMode` keeps its six values including `dontAsk`. Their live `setConfig` branches are gone with `sandboxOf` - the sandbox and the style are in the preset, written by whoever configured this backend, and a person cannot move them on a session that is already running. A session's `values` bag is now the fallbacks and its preset, nothing between. The cases are in `packages/sdk/test/host-sessionconfig.test.ts`, where the schema and a whole host are already driven: the schema has none of the three and still has `permissionMode` with `dontAsk`, and a host whose Claude carries `presets: { work: { thinking: 'disabled', sandbox: 'on' }, test: {} }` runs each session on its own preset, the empty one changing nothing, and a stored name nothing resolves on the first.

Two cases that only named the keys had to be given something else, and the replacements are what each was actually about:

- "resumes a session with the config it was created with" and "resumes a stored value the schema still offers" now carry `permissions: { allow: ['Bash'] }` and read `allowedTools`. Both were reaching for *a* config key that survives a resume; `thinking` was only ever one of several.
- "keeps a stored key the schema does not declare" is unchanged, including its `sandboxEnabled`: a store written before this change still holds the name, and host/31 keeps it and passes it on. That it now reaches nothing is the point of the case.

The handshake reads `init.output_style` only to decide whether to apply the preset's style. A session nobody named a style for no longer records the one the CLI is running: it would be a config key no schema offers, and there is no longer a control for it to be the value of.

Not done, and named so it is not lost: `packages/sdk/test/support/claude-sdk.ts`'s fake SDK still records `applyFlagSettings` sandbox calls into `sdk.sandboxSet`, and nothing asserts it now. The `available_output_styles` a session learned at the handshake is no longer read either, which is why `styles` and the probe's style-keeping went with the keys.

Not verified: "by hand in ahpapp: the composer shows no Output style, Thinking or Sandbox chip". There is no `ahpapp` in this repository, and no client to open. What the schema says is checked above; that a client draws no chip for a key the schema does not declare is that client's business.
