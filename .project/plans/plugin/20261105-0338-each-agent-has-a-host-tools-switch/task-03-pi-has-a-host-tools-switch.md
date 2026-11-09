---
title: pi has a host tools switch
status: done
depends: []
layer: agent-pi
refs:
  - "[code://packages/agent-pi/src/session.ts#L173](../../../../packages/agent-pi/src/session.ts#L173) - where the session takes the host's tools"
---

## Objective

A pi plugin option and a pi record field `hostTools` turn the host's tools off, and the record's value wins.

## Files

- `UPDATE: packages/agent-pi/package.json` - the plugin option `hostTools`, a boolean.
- `UPDATE: packages/agent-pi/i18n/es.json` - the option's text in Spanish.
- `UPDATE: packages/agent-pi/i18n/pt.json` - the option's text in Portuguese.
- `UPDATE: packages/agent-pi/src/plugin.ts` - the record field `hostTools`, and the record's value over the plugin's.
- `UPDATE: packages/agent-pi/src/backend.ts` - `hostTools` in the options a session is built with.
- `UPDATE: packages/agent-pi/src/session.ts:173` - with `hostTools` false, `offering` stays empty at the start and on a change.
- `UPDATE: packages/agent-pi/test/agent-pi-tools.test.ts` - cases for the plugin off, the record off over the plugin on, and the default.

## Steps

1. Add `hostTools` to the plugin's `optionsSchema`, with the text in *Answers*.
2. Add the es and pt text for it.
3. Add `hostTools` to the engine's record schema, as acp declares it.
4. Read the record's value first, then the plugin's, then `true`.
5. With the value false, keep only the tools with an owner in `offering` when the session starts.
6. Keep only the tools with an owner when the host sends a new tool list.
7. Add the three cases.

## Validation

- The new cases fail without the change and pass with it.
- `pnpm --filter @ahpd/agent-pi test` passes, run alone.

## Resume

- **Done so far:** `hostTools` is a plugin option (manifest and es/pt) and a record field (`RECORD_FIELDS`, over the plugin's, declared with acp's record wording), and `session.ts` keeps only the tools with an owner in `offering` at the start and on a later list.
- **Found:** the plan's `src/backend.ts` is the pi-runtime `BackendOptions`, not the host-facing options; `hostTools` went into `PiOptions` in `src/types.ts`, which is what a session is built with. Two tests outside the task's Files pin the option and the record's fields: `test/agent-pi-options.test.ts` (the README's options table must match the manifest, so the README lists it too) and `test/engine.test.ts` (the record's fields); `packages/server/test/plugin-load.test.ts` lists the plugin's options too.
