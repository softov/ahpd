---
title: A mode or option the agent changed is announced
status: todo
depends: []
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/session.ts#L256-L283](../../../../packages/agent-acp/src/session.ts#L256-L283) - the stored updates"
---

## Objective

`current_mode_update` and `config_option_update` emit `session/configChanged` with the new values.

## Files

- `UPDATE: packages/agent-acp/src/session.ts:256-283`.

## Steps

1. Emit only when the value differs.

## Validation

- A fixture mode change is announced once.

## Resume
