---
title: Claude has a host tools switch
status: todo
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
5. With the value false, take no host tools in `buildClientMcpServers` when the session starts.
6. Take no host tools in `rebindForClientTools` when the host sends a new tool list.
7. Add the three cases.

## Validation

- The new cases fail without the change and pass with it.
- `pnpm --filter @ahpd/agent-claude test` passes, run alone.

## Resume

- **Done so far:** nothing.
- **Found:** nothing yet.
