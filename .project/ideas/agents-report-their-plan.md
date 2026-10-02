---
title: A session shows the agent's goal, plan and tasks when the agent keeps them
created: 2026-10-02
---

Softov, 2026-10-02: "its possible to collect tasks from agents? At least the ones who do it? Like goal, plan, tasks (done, pending) or something alike? I know cofold does not do that.. since its a agent without much thing.. but tools and things wired it can do that."

Some agents keep a working plan as they go, and a client could show it beside the chat: what the agent is after, the steps it set itself, which are done and which are pending.
Today the host drops it.

## What agents already give

- **Claude**: the `TodoWrite` tool, a list of items with a status each. The host shows it only as a tool call titled "Update todo list" ([`code://packages/agent-claude/src/input.ts`](../../packages/agent-claude/src/input.ts)).
- **ACP agents**: a `plan` session update with entries, a priority and a status each. The bridge discards it with the user echo and the mode catalogue ([`code://packages/agent-acp/src/mapping.ts`](../../packages/agent-acp/src/mapping.ts)).
- **cofold and pi**: nothing of their own. A host tool (a `plan` or `todo` tool the host offers any agent, like the computer plugin's tools) would give them one.

## What it would be

A session's plan as state the host keeps: a goal, and a list of tasks with a status, replaced whole each time the agent writes it.
A provider maps its agent's own form into it (TodoWrite, ACP `plan`), and a host tool fills it for agents that have none.
A client reads it from the session (on `_meta` or a `plan:` scheme) and shows it as a checklist, and an [initiator](initiators-start-sessions.md) can post it to the issue or thread.

## Questions it leaves

- Where it lives on the wire: session `_meta`, a resource scheme, or a protocol change upstream (VS Code may define one first).
- Whether the host tool is offered to every agent, or only to those whose provider reports no plan of its own.
- Whether a goal is separate from the first prompt or the session title.
