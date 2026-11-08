---
title: A plan is a tool call inside one turn, so no client can hold it between turns
target: https://github.com/microsoft/agent-host-protocol
date: 2026-10-18
refs:
  - file:///github/ahpd/packages/tasks/src/channel.ts - the shipped `x-ahpd-plans` channel this proposal is written from
  - file:///github/ahpd/packages/agent-acp/src/mapping.ts - the Plan tool call drawn from ACP plan entries
  - file:///github/ahpd/packages/agent-claude/src/session/stream.ts - `TodoWrite`, drawn as a row of its own in a Claude turn
  - https://github.com/microsoft/agent-host-protocol - the protocol this is proposed to, where a tool call is a response part of a turn in the chat channel
---

## Summary

Every harness that keeps a plan says so inside a turn: ACP reports plan entries that a host draws as one Plan tool call, and Claude's `TodoWrite` arrives as a tool call a host draws as a row.
The protocol models a tool call as a response part of a turn in a chat channel, and the reducer drops actions for a turn that has completed.
There is no channel whose state is a plan, so a plan can change on the wire only while the turn that wrote it is open, and a client that connects later reads whatever that turn left rather than the list as it now stands.

## What that costs an implementation that keeps a plan across turns

A host that keeps one list for a session, and edits it by hand or with a tool between turns, has no place to publish it except a tool call it opens and rewrites on every turn.
That is what one host does today: the host draws one Plan call per turn from the session's plan, and suppresses the backend's own call so a turn does not show two.
It works for a client watching a turn, and it is wrong for every other reader: a second window on the same session sees the plan only if it joins the turn, a client that lists sessions sees nothing, and a plan that changed while no turn was running has no moment on the wire at all.
A client that wants the list as it stands can only ask the agent for another turn and read the call it draws, which is a model call spent to read state.

A plan shared by several sessions has no place at all. The same host keeps plans for a folder and for a bot, and any session working there reads and edits them with its tools. When session B changes a task, the change is a tool call in B's chat, so a client watching session A never sees it, even while A's own turn is open.

## The shape that works, and what it costs to keep it outside a scheme

The host that needs this ships a plugin channel under its own `x-` scheme, `x-ahpd-plans`, and a client of that host reads a plan as the state of one channel.
The channel is `x-ahpd-plans://<plan id>`, it asks `session:read`, and its state is the plan record and the tasks that name it:

```
{
  plan: { id, scope, title, goal, status, refs, created, approved?, finished?, reviewed? },
  tasks: [{ id, title, status, priority, labels, plan?, session?, ... }]
}
```

After the subscribe, each change is one action carrying the record as the store holds it:

- `x-ahpd-plans/taskAdded` with `task`, when a task of the plan is made or a task moves to the plan.
- `x-ahpd-plans/taskSet` with `task`, when a task of the plan changes.
- `x-ahpd-plans/taskRemoved` with `taskId`, when a task leaves the plan, for another plan, for none, or out of the store.
- `x-ahpd-plans/set` with `plan`, when the plan itself changes.

The channel is read-only: a client subscribes and is sent actions, and nothing a client dispatches reaches it.
That is enough for a window, which draws the list and edits it through the session's tools, and it is less than a protocol channel would need if a client were to write.

The cost of shipping it this way is the one every `x-` extension pays: a client that has not been written against this host's scheme draws nothing, and a second host that solves the same problem invents a second scheme with a second set of action names.

## What is being asked

One of three, in descending order of usefulness:

1. A typed plan channel: a channel whose state is a plan and its tasks, with actions for a task added, a task set, a task removed and the plan set, and a scope that says whose plan it is. The shipped `x-ahpd-plans` shape above is written from a working implementation and can be copied.
2. State that a plan is a tool call inside a turn and nothing more, so a client knows that a list read outside a turn is not portable, and a host that keeps one across turns is expected to draw it again each time.
3. Leave it as it is. A host ships an `x-` channel and the clients written for that host read it; every other client sees the plan only while a turn is open.
