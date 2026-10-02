---
title: The legacy models field is read
status: done
depends: []
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/session.ts#L683-L688](../../../../packages/agent-acp/src/session.ts#L683-L688) - the failure"
---

## Objective

With no `model` option, the `models` field of `session/new` is the model list, and a turn's model is set with the legacy call.

## Files

- `UPDATE: packages/agent-acp/src/session.ts`.

## Steps

1. Prefer the option when both exist.

## Validation

- A fixture with only `models`: a turn naming one runs on it.

## Resume
