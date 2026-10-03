---
title: A machine off this host is refused while a key would travel with it
status: todo
depends: []
layer: "sdk | computer"
refs:
  - "[code://packages/computer/src/plugin.ts#L253](../../../../packages/computer/src/plugin.ts#L253) - `needValues`, the plugin's values for every agent's needs"
  - "[code://packages/computer/src/plugin.ts#L672-L779](../../../../packages/computer/src/plugin.ts#L672-L779) - `create`, where a machine is made with its resolved needs"
  - "[code://packages/server/src/proxy/providers.ts#L83-L99](../../../../packages/server/src/proxy/providers.ts#L83-L99) - the key variables of the built-in providers"
---

## Objective

Making or entering a machine off this host fails with a sentence naming the variable when a resolved need, a profile value, the plugin's `env` or a nested start would put a provider key, or a p1 secret, into it.

## Files

- `UPDATE: packages/computer/src/plugin.ts:672-779` - checked after `manifestOf` for a remote runtime.
- `UPDATE: packages/sdk/src/nested.ts` - checked before `nested` is asked.
- `UPDATE: packages/computer/test/computer-needs.test.ts`.

## Steps

1. A key is any variable named as a provider's `key.env` (the built-ins and the configuration's), a name the vault resolves, or one task 02 marks.
2. The refusal names the machine, the variable and what to do: give the box its own key by hand, or run on this host.

## Validation

- A profile on a remote runtime whose agent needs `ANTHROPIC_API_KEY` with a value is refused; the same profile on the local Docker is not.

## Resume
