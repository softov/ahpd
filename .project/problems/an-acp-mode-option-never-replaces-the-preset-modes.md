---
title: An ACP server that names its modes in a mode option never replaces the preset list
status: open
date: 2026-11-03
severity: minor
blocks: []
refs:
  - "[code://packages/agent-acp/src/session/config.ts#L48-L53](../../packages/agent-acp/src/session/config.ts#L48-L53) - only the legacy modes call `heardModes`"
  - "[code://packages/agent-acp/src/session/config.ts#L190-L202](../../packages/agent-acp/src/session/config.ts#L190-L202) - `schemaOf` reads the `mode` option first"
  - git://4f38d6e2 - host/20261030-0618 added `heardModes`
  - git://77ba53f8 - main when the problem was read
---

## Symptom

Read from the code in the review of 2026-11-03, and not reproduced.
An ACP server names its modes through a `mode` config option, not legacy modes.
A session of it runs.
The next new session box of that agent still offers the preset's modes.

## Cause

`heardModes` is called only where the legacy `availableModes` arrive.
The `mode` option is read for the session's own schema and is not passed to `heardModes`.

## Impact

Before a session runs, the picker offers modes that the server may not have.
It is not known which shipped agents name their modes this way.

## Workaround

None.

## Fix

- Call `heardModes` with the `mode` option's values when a server sends it.
