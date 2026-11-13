---
title: An agent sets a new session's folder, trust and computer
domain: host
status: planned
priority: medium
created: 2026-11-13
revalidated: 2026-11-13
requires: []
changes:
  - specs/sessions-and-chats.md
  - specs/plugin-contract.md
creates: []
refs:
  - git://6418b8521 - the commit of ahpd this plan was checked at
  - "[code://packages/sdk/src/types/agent.ts#L255-L340](../../../../packages/sdk/src/types/agent.ts#L255-L340) - `Start`: the backend gets the client's folder, a trust callback and `userSettings`, and can change none of them"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L1351-L1356](../../../../packages/sdk/src/host/sessionmethods.ts#L1351-L1356) - a client's `createSession` takes the client's folder, else a scratch folder"
  - "[code://packages/sdk/src/host/automations.ts#L1015-L1017](../../../../packages/sdk/src/host/automations.ts#L1015-L1017) - a plugin's trusted session needs `session:trust` on the plugin's entry"
  - "[code://packages/sdk/src/host/automations.ts#L847-L849](../../../../packages/sdk/src/host/automations.ts#L847-L849) - a trusted folder is kept with the session, so a restart trusts it again"
  - "[code://packages/sdk/src/host/lifecycle.ts#L2655](../../../../packages/sdk/src/host/lifecycle.ts#L2655) - `userSettings` is kept with the session"
  - "[code://packages/sdk/src/plugins/plugins.ts#L1646-L1657](../../../../packages/sdk/src/plugins/plugins.ts#L1646-L1657) - `registerAgent`: which plugin an agent belongs to"
  - "[code://packages/bot/src/chat.ts#L1286-L1302](../../../../packages/bot/src/chat.ts#L1286-L1302) - the `bot-chat` agent, the first agent to use this"
---

## Goal

An agent can fix the folder, the trust, the user settings and the computer of a session a client creates on it.
The bot needs this because its Back chats run in the Front session's folder and computer. That folder must be the bot's own, trusted, with none of the daemon user's settings.
Today a client's `createSession` takes the client's folder, so ahpw asks the person for a path the bot already has.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "workingDirectory|trusted|userSettings" packages/sdk/src/host/sessionmethods.ts` - the client's folder is the only source; trust and user settings come only from a plugin's `SessionRequest`.
- `rg -n "session:trust" packages/sdk/src` - the grant is checked for a plugin's start, on the plugin's entry.

### Runtime path

```
client createSession(provider: bot-chat, config) -> agent.placeSession(config, reader) -> folder, trust, userSettings, computer -> resolveCreatedSessionConfig -> admitted -> createProviderSession
```

### Gaps

- `Not found: a way for an agent to set a created session's folder - searched "workingDirectory" in packages/sdk/src/types/agent.ts and packages/sdk/src/host/sessionmethods.ts.`
- Trust and `userSettings: false` reach a session only through a plugin's `SessionRequest`.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The host lets an agent set the folder, trust and user settings of a session a client creates | Softov, 2026-11-13, chose "Host lets the agent set them" | 01 |
| The agent's folder wins over the client's | Softov, 2026-11-13, the chosen option: "ignores the client's folder" | 01 |
| A trusted folder needs `session:trust` on the entry of the plugin that registered the agent | Softov, 2026-11-13, chose "The plugin's session:trust" | 01 |
| An agent with no hook creates its session as today | Softov, 2026-11-13, chose "Nothing changes" | 01 |
| The hook also sets the session's `computer` | Softov, 2026-11-13, chose "Yes, the hook sets it" | 01 |

## Proposed architecture

- **Data flow** - `Agent.placeSession(settings, reader)` answers `{ workingDirectory?, trusted?, userSettings?, computer? }`. The host calls it in `createSession` before it picks the folder and checks the config.
- **State flow** - the trusted folder and `userSettings` are kept with the session as a plugin's start keeps them, so a restart reads them back.
- **Layer responsibilities** - `packages/sdk/src/types/agent.ts`: the hook · `packages/sdk/src/host/sessionmethods.ts`: calling it and the grant check.
- **Source-of-truth files** - [`code://packages/sdk/src/host/sessionmethods.ts`](../../../../packages/sdk/src/host/sessionmethods.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - an-agent-places-a-created-session](task-01-an-agent-places-a-created-session.md) | todo | - |

## Risks and tradeoffs

- An agent could move a person's session into a folder they did not pick - only a plugin's agent has the hook.
- Trust needs that plugin's `session:trust`.
- VS Code's host has no such hook - it is ahpd's, and the session it makes is an ordinary AHP session.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-an-agent-places-a-created-session.md](task-01-an-agent-places-a-created-session.md).
- **Open questions:** none.
- **Watch out for:** find how `createSession` reaches the grants of the agent's plugin. `beginPluginSession` gets them from `PluginStarts`, and a client's create has none today.

## Final verification checklist

- [ ] A client creates a session on an agent with the hook, and the session runs in the agent's folder, trusted, with `userSettings: false`.
- [ ] An agent that answers a `computer` gets a session on that machine, checked as a client's `computer` is.
- [ ] Without `session:trust` on the plugin, the create is refused naming the grant.
- [ ] After a restart the folder is still trusted.
- [ ] `pnpm typecheck` and the `packages/sdk` tests pass.
