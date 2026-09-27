---
title: A cofold machine runs ahpd from its part
status: todo
depends: []
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/agent.ts#L542-L560](../../../../packages/agent-cofold/src/agent.ts#L542-L560) - the needs"
  - "[code://packages/computer/src/plugin.ts#L40](../../../../packages/computer/src/plugin.ts#L40) - the default `host`"
---

## Objective

Cofold's `machine()` adds `ahpdPart: { part: 'ahpd' }`, and the default `host` command finds `ahpd` on the machine's `PATH` from the part.

## Files

- `UPDATE: packages/agent-cofold/src/agent.ts:542-560` - the need.
- `UPDATE: packages/agent-cofold/test/` the machine test.

## Steps

1. Add the need; nothing changes in `host`, because p4 puts the part's `bin` on `PATH`.
2. A profile whose `host` names another program keeps it.

## Validation

- Cofold's needs include the part.
- By hand: a cofold session in a machine from `debian:bookworm-slim`.

## Resume
