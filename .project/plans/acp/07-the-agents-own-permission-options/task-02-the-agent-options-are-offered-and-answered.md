---
title: The agent's options are offered and the chosen one answered
status: todo
depends: [task-01-confirm-carries-the-chosen-option.md]
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/session.ts#L387-L445](../../../../packages/agent-acp/src/session.ts#L387-L445) - the request"
  - "[code://packages/agent-acp/src/session.ts#L1047-L1079](../../../../packages/agent-acp/src/session.ts#L1047-L1079) - the answer"
---

## Objective

Each ACP permission option becomes a `ConfirmationOption` (id, name, kind mapped to approve or deny) on the ready call, and `confirm` answers the chosen id, or the once option when none was chosen.

## Files

- `UPDATE: packages/agent-acp/src/session.ts:387-445, 1047-1079`.

## Steps

1. Group allow options before reject options.

## Validation

- A fixture offering `allow_always`: chosen, it is sent; not chosen, `allow_once` is sent.

## Resume
