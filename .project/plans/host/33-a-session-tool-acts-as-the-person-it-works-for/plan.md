---
title: A session tool acts as the person it works for, within VS Code's limits, and can be switched off
domain: host
status: planned
priority: high
created: 2026-09-30
revalidated: 2026-09-30
requires:
  - plans/host/30-a-session-is-listed-under-its-providers-name/plan.md
refs:
  - "[code://packages/sdk/src/sessiontools.ts](../../../../packages/sdk/src/sessiontools.ts) - the nine session tools, VS Code's by name and schema; `delete_session` refuses only the current session"
  - "[code://packages/sdk/src/tools.ts#L24-L27](../../../../packages/sdk/src/tools.ts#L24-L27) - `hostTools`, the session and artifact tools every session is offered"
  - "[code://packages/sdk/src/host.ts#L4797](../../../../packages/sdk/src/host.ts#L4797) - `toolContext`, what a tool may see and do: it carries no person"
  - "[code://packages/sdk/src/types/host.ts#L374-L380](../../../../packages/sdk/src/types/host.ts#L374-L380) - `ToolCall`"
  - "[code://packages/sdk/src/users.ts#L22-L31](../../../../packages/sdk/src/users.ts#L22-L31) - the built-in roles; sessions are reached by role, and none is any one person's"
  - "[code://packages/server/src/commands/run.ts#L285](../../../../packages/server/src/commands/run.ts#L285) - the daemon passes `hostTools()` to every session"
  - "git://ac05bdfe1e1 - VS Code `src/vs/platform/agentHost/node/shared/sessionServerTools.ts`: `maxSessionSpawnDepth` 3, `maxCreatedSessions` 50, `maxCreatedChats` 50, `maxSentMessages` 100, and their refusal words"
---

## Goal

A session's agent reaches other sessions through the session tools only as far as the person it works for may, it cannot spawn or message without the bounds VS Code sets, and an install that does not want agents driving sessions can turn the tools off.
Today every session on a daemon gets all nine tools, and under a users directory an agent in one person's session can list, read, message or delete any session on the host, whatever that person's grants.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg "delete_session|list_sessions" packages/*/src` - the tools are in `sessiontools.ts` and reach the host only through `ToolCall`.
- `git -C /github/externals/vscode grep SessionServerToolName origin/main` - the same nine names; VS Code's group bounds depth and counts and confirms five tools host-side.
- `rg "principal" packages/sdk/src/host.ts` - a principal lives on a `Connection`; no session or turn records one.

### Runtime path

```
agent calls list_sessions -> host tool run(input, toolContext(uri, chat)) -> every session the host holds or lists -> answered to the agent
```

### Gaps

- `ToolCall` carries no person, so a tool cannot be refused by grant.
- No bound on spawn depth, created sessions, created chats or sent messages.
- No option to offer a session none of the session tools.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| Under a users directory a session tool acts with the grants of the person it works for: reading a session needs `session:read`, creating, messaging, renaming or deleting one needs `session:write`, and `list_sessions` lists only what that person may read | Softov, 2026-09-30, asked which guards to plan for the session tools: "Act as the session's person" | 01 |
| VS Code's limits: spawn depth 3, 50 created sessions, 50 created chats and 100 sent messages, with its refusal words; what the counts are kept per is the open question below | same answer: "VS Code's limits" | 02 |
| An install can turn the session tools off: a daemon option `sessionTools`, `true` by default, `false` for none, or a list of providers whose sessions get them | same answer: "A switch to turn them off"; then asked "What should the switch that turns session tools off look like?": "Option: on, off, or providers" | 03 |
| A tool call carries the grants of the person who sent the turn it runs in; a turn an automation started carries the automation's creator; under a users directory, a turn with no person gets no session tool that writes | Softov, 2026-09-30, asked "No session has an owner, so whose grants should a session tool call carry?": "Who sent the turn" | 01 |
| No confirmation is forced host-side: whether a session tool asks is the backend's permission mode, so a person who lets an agent work can let it `send_message` without being asked each time | same answer, on host-side confirmation "whatever the permissions": "not ideal for a get to working agent. if desired by the user... so whatever the permissions ask was not accepted as written" | - |

## Proposed architecture

- **Data flow** - `toolContext` gains the person a call works for; each session tool asks it before acting, and the listing filters by it.
- **State flow** - spawn depth is per session, from the session that created it; what the counts for task 02 are kept per waits on the open question.
- **Layer responsibilities** - `packages/sdk`: the person, the grants, the limits; `packages/server`: the option for task 03.
- **Source-of-truth files** - [`code://packages/sdk/src/sessiontools.ts`](../../../../packages/sdk/src/sessiontools.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| 01 - A session tool acts as the person it works for | todo | - |
| 02 - VS Code's limits on spawning and messaging | todo | - |
| 03 - The session tools can be switched off | todo | - |

Task files are written once the open questions are answered.

## Risks and tradeoffs

- Built on host/30's gate and its one name registry, which are on main (e33ebee).
- A host with no users directory has no person: the tools act as today there, bounded by task 02 only.

## Resume state

- **Done so far:** planned 2026-09-30, draft.
- **Next action:** ask the question below; then the three task files, then the build.
- **Open question (ask before task 02):** VS Code keeps its counts per process, and a daemon process lives for weeks and serves many people, so 50 sessions or 100 messages per process would stop every session tool on the host until a restart - keep the counts (a) per session tree, from the session the first spawn came from, (b) per person the turns work for, or (c) per process with a reset window.
- **Watch out for:** the artifact tools and `ahp_terminals` are not session tools; this plan leaves them as they are.
