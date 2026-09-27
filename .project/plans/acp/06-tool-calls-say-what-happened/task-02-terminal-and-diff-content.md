---
title: Terminal and diff content are kept
status: todo
depends: []
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/mapping.ts#L63-L71](../../../../packages/agent-acp/src/mapping.ts#L63-L71) - content mapping"
  - "[code://packages/agent-acp/src/session.ts#L804-L818](../../../../packages/agent-acp/src/session.ts#L804-L818) - terminal content as `runCommand` builds it"
---

## Objective

`terminal` content whose id is a host terminal URI becomes AHP terminal content; `diff` content becomes a file edit on the call and an entry in the turn's changeset.

## Files

- `UPDATE: packages/agent-acp/src/mapping.ts`.

## Steps

1. Reuse the shape `runCommand` builds.
2. A diff's path is a host path; outside the session's directories it is shown and not recorded.

## Validation

- One fixture call with each content kind.

## Resume
