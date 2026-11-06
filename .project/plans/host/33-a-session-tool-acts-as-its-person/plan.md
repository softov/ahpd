---
title: A session tool acts as the person it works for, within VS Code's limits, and can be switched off
domain: host
status: built
priority: high
created: 2026-09-30
revalidated: 2026-10-13
requires:
  - plans/host/30-a-session-is-listed-under-its-providers-name/plan.md
refs:
  - "[code://packages/sdk/src/tools/session.ts](../../../../packages/sdk/src/tools/session.ts) - the nine session tools, VS Code's by name and schema; `delete_session` refuses only the current session"
  - "[code://packages/sdk/src/tools/index.ts#L24-L56](../../../../packages/sdk/src/tools/index.ts#L24-L56) - `hostTools`, the session and artifact tools every session is offered"
  - "[code://packages/sdk/src/host/tooling.ts#L1048](../../../../packages/sdk/src/host/tooling.ts#L1048) - `toolContext`, what a tool may see and do: it carries no person"
  - "[code://packages/sdk/src/types/host.ts#L701-L805](../../../../packages/sdk/src/types/host.ts#L701-L805) - `ToolCall`"
  - "[code://packages/sdk/src/access/users.ts#L25-L36](../../../../packages/sdk/src/access/users.ts#L25-L36) - the built-in roles; sessions are reached by role, and none is any one person's"
  - "[code://packages/server/src/commands/run.ts#L626](../../../../packages/server/src/commands/run.ts#L626) - the daemon passes `hostTools()` to every session"
  - "git://ac05bdfe1e1 - VS Code `src/vs/platform/agentHost/node/shared/sessionServerTools.ts`: `maxSessionSpawnDepth` 3, `maxCreatedSessions` 50, `maxCreatedChats` 50, `maxSentMessages` 100, and their refusal words"
---

## Goal

A session's agent reaches other sessions through the session tools only as far as the person it works for may.
It cannot spawn or message past the bounds VS Code sets.
An install that does not want agents to drive sessions can turn the tools off.
Today every session on a daemon gets all nine tools.
Under a users directory, an agent in one person's session can list, read, message or delete any session on the host, whatever that person's grants.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg "delete_session|list_sessions" packages/*/src` - the tools are in `tools/session.ts` and reach the host only through `ToolCall`.
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
| VS Code's limits: spawn depth 3, 50 created sessions, 50 created chats and 100 sent messages, with its refusal words; the counts are kept per session tree | same answer: "VS Code's limits" | 02 |
| An install can turn the session tools off with two daemon keys: `sessionTools`, `true` by default or `false` for none, and `sessionToolsProviders`, a list that limits the session tools to the sessions of those providers, empty by default for every provider | same answer: "A switch to turn them off"; then asked "What should the switch that turns session tools off look like?": "Option: on, off, or providers"; then Softov, 2026-10-13, on how a list is set from the flag and the settings screen: "split into 2 keys is better" | 03 |
| VS Code's counts are kept per session tree, from the session the first spawn came from | Softov, 2026-10-12, to "What should the counts be kept per?" - "Per session tree" | 02 |
| A tool call carries the grants of the person who sent the turn it runs in; a turn an automation started carries the automation's creator; under a users directory, a turn with no person gets no session tool that writes | Softov, 2026-09-30, asked "No session has an owner, so whose grants should a session tool call carry?": "Who sent the turn" | 01 |
| A refusal for a count uses VS Code's words with "in this process" changed to "in this session tree", so it says what is true; the depth refusal is VS Code's as it is | Softov, 2026-10-13, to "What should a refusal say?" - "Same words, 'in this session tree'" | 02 |
| A turn a session tool or a wake started carries the person of the turn that called the tool or set the wake, so a child acts as the same person and never as more | Softov, 2026-10-13, to "Whose grants should such a turn carry?" - "The turn that started it" | 01 |
| A live change of the session tools removes Claude's in-process servers, `client` and `host`, then adds them with the new tools, because the Claude Agent SDK registers a server name once and drops a later declaration of it | Softov, 2026-10-13, to "How should host/33 make a live change reach a running session?" - "Remove, then add again (Recommended)" | 04 |
| No confirmation is forced host-side: whether a session tool asks is the backend's permission mode, so a person who lets an agent work can let it `send_message` without being asked each time | same answer, on host-side confirmation "whatever the permissions": "not ideal for a get to working agent. if desired by the user... so whatever the permissions ask was not accepted as written" | - |

## Proposed architecture

- **Data flow** - `toolContext` gains the person a call works for; each session tool asks it before acting, and the listing filters by it.
- **State flow** - spawn depth is per session, from the session that created it. The counts for task 02 are kept per session tree, from its first session.
- **Layer responsibilities** - `packages/sdk`: the person, the grants, the limits; `packages/server`: the option for task 03.
- **Source-of-truth files** - [`code://packages/sdk/src/tools/session.ts`](../../../../packages/sdk/src/tools/session.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A session tool acts as the person it works for](task-01-session-tool-acts-as-its-person.md) | done | - |
| [02 - VS Code's limits on spawning and messaging](task-02-vscode-limits-on-spawning-and-messaging.md) | done | - |
| [03 - The session tools can be switched off](task-03-the-session-tools-can-be-switched-off.md) | done | - |
| [04 - The switch is read from the file and reaches a running claude session](task-04-switch-reaches-a-running-claude-session.md) | done | 03 |

## Risks and tradeoffs

- Built on host/30's gate and its one name registry, which are on main (e33ebee).
- A host with no users directory has no person: the tools act as today there, bounded by task 02 only.

## Resume state

- **Done so far:** planned 2026-09-30; task files written 2026-10-13; tasks 01 and 02 built and reviewed to done 2026-10-13; tasks 03 and 04 implemented and not set to done. Softov answered task 03's step 4 fork on 2026-10-13: split the option into two keys. The switch is a boolean and the provider list is an array, so the flag parser and the settings screen take one type each. Both parse from the command line: the switch as `--session-tools` with `--no-session-tools`, and the list as a repeatable `--session-tools-providers`. Task 04 built 2026-10-13, both live defects fixed. The file half: the two fields carry no `default`, so a value in `config.json` reaches the options with no flag. The live half: task 04's step 6 found that the Claude Agent SDK registers a server name once and drops a later declaration of it, so `setTools` now declares the set without `ahp` first and with the new `ahp` second - Softov's answer of 2026-10-13, "Remove, then add again". A review of task 04 the same day narrowed it: a session that has no `ahp` yet declares the new one alone, and a removal the SDK took is held even when the add that follows is refused.
- **Next action:** none. The plan is built, and `implemented.md` says what exists.
- **Open questions:** none.
- **Watch out for:** the artifact tools and `ahp_terminals` are not session tools; this plan leaves them as they are. Also the gap the two declarations leave: between them the CLI holds no `ahp` server at all, so a session tool called in that moment fails. And that `setTools` answered `true` over the SDK's silent drop before task 04's step 8, which is why the log line step 5 added never fired for it.
