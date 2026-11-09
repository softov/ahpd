---
title: Claude has a host tools switch
status: done
depends: []
layer: agent-claude
refs:
  - "[code://packages/agent-claude/src/session/clienttools.ts#L545-L592](../../../../packages/agent-claude/src/session/clienttools.ts#L545-L592) - where the session takes the host's tools: `declaring`, `buildClientMcpServers` and `rebindForClientTools`: a session's tools reach the CLI on a `client` and a `host` server"
---

## Objective

A Claude plugin option and a Claude record field `hostTools` turn the host's tools off, and the record's value wins.

## Files

- `UPDATE: packages/agent-claude/package.json` - the plugin option `hostTools`, a boolean.
- `UPDATE: packages/agent-claude/i18n/es.json` - the option's text in Spanish.
- `UPDATE: packages/agent-claude/i18n/pt.json` - the option's text in Portuguese.
- `UPDATE: packages/agent-claude/src/plugin.ts` - the record field `hostTools`, and the record's value over the plugin's.
- `UPDATE: packages/agent-claude/src/options.ts` - `hostTools` in the options a session is built with.
- `UPDATE: packages/agent-claude/src/session/clienttools.ts:545-592` - with `hostTools` false, `buildClientMcpServers` and `rebindForClientTools` take no host tools.
- `UPDATE: packages/agent-claude/test/agent-claude-plugin-switch.test.ts` - cases for the plugin off, the record off over the plugin on, and the default.

## Steps

1. Add `hostTools` to the plugin's `optionsSchema`, with the text in *Answers*.
2. Add the es and pt text for it.
3. Add `hostTools` to the engine's record schema, as acp declares it.
4. Read the record's value first, then the plugin's, then `true`.
5. With the value false, declare no `host` server in `declaring`, and keep the `client` server.
6. Check that `buildClientMcpServers` and `rebindForClientTools` both go through `declaring`.
7. Add the three cases.

## Validation

- The new cases fail without the change and pass with it.
- `pnpm --filter @ahpd/agent-claude test` passes, run alone.

## Resume

- **Done so far:** `hostTools` is a plugin option (manifest and es/pt) and a record field (`options.ts`), the plugin's value is laid under the record's in `presetOf`, and `clienttools.ts` drops the host's own tools and keeps each client's at start and on a later list. The README's two tables list it.
- **Found:** three tests outside the task's Files pin the declarations and needed the field: `test/agent-claude-options.test.ts` (the README's options table must match the manifest), `test/agent-claude-declarations.test.ts` (`optionDefaults`), and `test/engine.test.ts` (the record's fields).
