---
title: A machine off this host is refused while a key would travel with it
status: todo
depends: []
layer: "sdk | computer"
refs:
  - "[code://packages/computer/src/plugin.ts#L287](../../../../packages/computer/src/plugin.ts#L287) - `needValues`, the plugin's values for every agent's needs"
  - "[code://packages/computer/src/plugin.ts#L717-L830](../../../../packages/computer/src/plugin.ts#L717-L830) - `create`, where a machine is made with its resolved needs"
  - "[code://packages/server/src/proxy/providers.ts#L83-L99](../../../../packages/server/src/proxy/providers.ts#L83-L99) - the key variables of the built-in providers"
---

## Objective

Starting a session of an agent on a machine off this host fails, for that agent's session only, with a sentence naming the variable, when a resolved need, a profile value, the plugin's `env` or a nested start would put a provider key, or a need marked secret, into the machine.
The check is by where the value comes from, not by the variable's name, so the session's own minted token (task 01) passes under a provider key's name; a session of another agent on the same machine, whose preset needs no key, still starts.
Other credentials a profile names on purpose, such as p8 task 07's `gitCredential`, are the operator's choice and may travel.

## Files

- `UPDATE: packages/computer/src/plugin.ts:717-830` - each resolved need carries where its value came from; checked per agent for a remote runtime.
- `UPDATE: packages/sdk/src/nested.ts` - checked at the nested start of each session, before `nested` is asked.
- `UPDATE: packages/computer/test/computer-needs.test.ts`.

## Steps

1. A value is refused when it comes from this daemon's environment, from the vault, or from a profile or plugin need value, and its variable is a provider's `key.env` (the built-ins and the configuration's), a `role: 'key'` need (task 02), or a need marked secret: `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, and any variable a Claude variant's `env` resolves from this daemon's environment or the vault (p5 task 09). A value the host minted for the session (task 01) is not refused.
2. The refusal is per agent at session start, never the whole machine: the session of the agent that would carry the key is refused, and the machine and its other sessions are untouched.
3. The refusal names the machine, the agent, the variable and what to do: give the box its own key by hand, or run on this host.

## Validation

- A profile on a remote runtime whose agent needs `ANTHROPIC_API_KEY` with a value is refused for that agent's session; the same profile on the local Docker is not.
- With `ANTHROPIC_API_KEY` unset in the daemon and no key value anywhere, a Claude session on the remote machine starts with the minted token under that name; a keyless preset's session on the same machine runs while a keyed one is refused.
- A `gitCredential` on a remote profile is not refused by this check.

## Resume
