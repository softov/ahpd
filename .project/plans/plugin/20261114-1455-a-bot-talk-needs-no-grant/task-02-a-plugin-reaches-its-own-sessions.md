---
title: A plugin reaches its own agents' sessions
status: todo
depends: [task-01-a-plugins-own-folder-is-trusted.md]
layer: "sdk, docs"
refs:
  - "[code://packages/sdk/src/host/actions.ts#L151-L183](../../../../packages/sdk/src/host/actions.ts#L151-L183) - the users gate on a dispatched action"
  - "[code://packages/sdk/src/host/admission.ts#L270-L330](../../../../packages/sdk/src/host/admission.ts#L270-L330) - `excusedBy`, the gate's excuse for a command"
---

## Objective

On a host with users, a plugin's connection reads and writes the sessions of its own agents, and their chats, with no grant.
Only `session:` and `chat:` grants are excused, and only on a session whose agent the plugin registered.

## Files

- `UPDATE: packages/sdk/src/host/gate.ts` - `ownAgentExcuse(who, session, grant)`: whether a plugin principal is excused a grant on a session.
- `UPDATE: packages/sdk/src/host/actions.ts:151-183` - the action gate asks the excuse for the session of the channel.
- `UPDATE: packages/sdk/src/host/admission.ts:270-330` - `excusedBy` asks the excuse for the session a command names.
- `UPDATE: docs/plugins/PLUGINS.md:1162` - a plugin's connection on its own agents' sessions.
- `UPDATE: docs/plugins/BOTS.md:311-314` - the bot plugin's entry needs no grants.

## Steps

1. Write `ownAgentExcuse` in `gate.ts`: a principal with `plugin`, a grant under `session:` or `chat:`, and `agentStarts[provider].by` equal to the plugin.
2. Read the session's provider from the held session, or from its owner record where it is not held.
3. Find the session of a chat channel with `ctx.sessionFor`.
4. Excuse the grant in the action gate where `ownAgentExcuse` answers true.
5. Excuse the grant in `excusedBy` for `subscribe`, `fetchTurns` and the other commands on a session or chat.
6. Remove the grants from the bot plugin's entry in BOTS.md, and say why in PLUGINS.md.

## Validation

- An sdk test with users: `plugin:<name>` with no grants subscribes to a chat of its own agent's session.
- An sdk test: that connection dispatches an action on the chat.
- An sdk test: the host refuses that connection on a session of another agent.
- An sdk test: a `computer:` or `file:` grant is not excused on its own agent's session.
- A bot test on a host with users: a message reaches a Back with no grants on the plugin's entry.
- A webhook test: the webhook plugin with no grants is still refused, naming its grant.
- Run the sdk suite, then the bot suite, then the webhook suite, one at a time.

## Resume

