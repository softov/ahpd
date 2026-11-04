---
title: The demo agent is Agent Demo and has a mode
status: done
depends: []
layer: "examples"
refs:
  - "[code://examples/demo/agent.ts#L202](../../../../examples/demo/agent.ts#L202) - the name to change"
  - "[code://examples/notes/agent.ts#L139-L171](../../../../examples/notes/agent.ts#L139-L171) - the schema the demo extends"
  - "https://github.com/microsoft/vscode/blob/171e90619c7/src/vs/platform/agentHost/common/agentHostSchema.ts - the `mode` property to copy"
---

## Objective

The demo agent is named `Agent Demo`, and its schema has VS Code's `mode` key beside `Ask before` and `Tone`.

## Files

- `UPDATE: examples/demo/agent.ts` - `displayName` is `Agent Demo`, and the schema it passes on gains `mode`.
- `UPDATE: examples/demo/README.md` - the agent's name, and a row for the fields a new session offers.

## Steps

1. Set the agent's `displayName` to `Agent Demo`.
2. Add `mode` to the demo's schema, with VS Code's title, enum, labels, descriptions and default `interactive`.
3. Mark `mode` `sessionMutable`, and accept it in the demo's `setConfig` without changing the turn.
4. Add the default `mode: 'interactive'` to the demo's defaults.
5. Add a README row: the fields a new session offers, and that `mode` changes nothing in a turn.

## Validation

- Run the demo's tests, and add a case: the session schema has `mode`, `ask` and `tone`.
- Run `pnpm demo` and `ahpc agent list`, and check that the name is `Agent Demo`.

## Resume
