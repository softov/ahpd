---
title: A preset env value may name a daemon variable
status: done
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/options.ts](../../../../packages/agent-claude/src/options.ts) - `env`, `presetSchema`, `variablesOf`"
---

## Objective

A preset `env` value is a string, `null` to unset, or `{ "fromEnv": "<VAR>" }`, which is the daemon's own value of that variable; a missing variable fails the load.

## Files

- `UPDATE: packages/agent-claude/src/options.ts` - the three forms in `env`'s check and its `toQuery`.
- `UPDATE: packages/agent-claude/README.md` - the form, with the OpenRouter example.

## Validation

- `packages/agent-claude/test/agent-claude-declarations.test.ts`: the form resolves; an unset variable is named in the load error; `extraArgs` does not take it.

## Resume
