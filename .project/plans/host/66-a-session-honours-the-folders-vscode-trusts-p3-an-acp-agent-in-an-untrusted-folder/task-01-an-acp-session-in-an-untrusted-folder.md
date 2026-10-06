---
title: An ACP session in an untrusted folder
status: todo
depends: []
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/session/opening.ts#L300](../../../../packages/agent-acp/src/session/opening.ts#L300) - spawned with `cwd`"
---

## Objective

An ACP session in a folder the host says is not trusted is refused before the agent is spawned, with a sentence naming the folder and `honoursTrust`, unless its preset says `honoursTrust: true`.

## Files

- `UPDATE: packages/agent-acp/src/session/opening.ts:300-414` - today the agent is started in any folder and loads its project's files unchecked.
- `UPDATE: packages/agent-acp/src/presets.ts:23-56` - `honoursTrust?: boolean` on `AcpPreset`, and on the options a person's own preset takes.
- `UPDATE: packages/agent-acp/test/` - the cases below.

## Steps

1. Failing case first: an untrusted folder and a preset without the flag; the session is refused and nothing is spawned. Today the agent is spawned there.
2. The same with `honoursTrust: true`: the agent is spawned.
3. A trusted folder: spawned (passes before and after).

## Validation

- The case fails on `e1c4ccc` and passes after.

## Resume
