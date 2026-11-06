---
title: cofold has a host tools switch
status: todo
depends: []
layer: agent-cofold
refs:
  - "[code://packages/agent-cofold/src/session.ts#L215](../../../../packages/agent-cofold/src/session.ts#L215) - where the session takes the host's tools"
---

## Objective

A cofold plugin option and a cofold record field `hostTools` turn the host's tools off, and the record's value wins.

## Files

- `UPDATE: packages/agent-cofold/package.json` - the plugin option `hostTools`, a boolean.
- `UPDATE: packages/agent-cofold/i18n/es.json` - the option's text in Spanish.
- `UPDATE: packages/agent-cofold/i18n/pt.json` - the option's text in Portuguese.
- `UPDATE: packages/agent-cofold/src/plugin.ts` - the record field `hostTools`, and the record's value over the plugin's.
- `UPDATE: packages/agent-cofold/src/agent.ts` - `hostTools` in the options a session is built with.
- `UPDATE: packages/agent-cofold/src/session.ts:215` - with `hostTools` false, `offered` stays empty at the start and on a change.
- `UPDATE: packages/agent-cofold/test/agent-cofold-plugin.test.ts` - cases for the plugin off, the record off over the plugin on, and the default.

## Steps

1. Add `hostTools` to the plugin's `optionsSchema`, with the text in *Answers*.
2. Add the es and pt text for it.
3. Add `hostTools` to the engine's record schema, as acp declares it.
4. Read the record's value first, then the plugin's, then `true`.
5. With the value false, keep `offered` empty when the session starts.
6. Keep `offered` empty when the host sends a new tool list.
7. Add the three cases.

## Validation

- The new cases fail without the change and pass with it.
- `pnpm --filter @ahpd/agent-cofold test` passes, run alone.

## Resume

- **Done so far:** nothing.
- **Found:** nothing yet.
