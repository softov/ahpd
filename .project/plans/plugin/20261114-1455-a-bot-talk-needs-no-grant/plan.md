---
title: A bot talk needs no grant
domain: plugin
status: active
priority: high
created: 2026-11-14
revalidated: 2026-11-14
refs:
  - git://9b15ce74a - the last commit before the plan, where the facts were checked
  - "[code://packages/sdk/src/host/sessionmethods.ts#L1343-L1356](../../../../packages/sdk/src/host/sessionmethods.ts#L1343-L1356) - a trusted folder an agent places needs the plugin's `session:trust`"
  - "[code://packages/sdk/src/host/automations.ts#L1014-L1017](../../../../packages/sdk/src/host/automations.ts#L1014-L1017) - `beginPluginSession`: a plugin's trusted start needs `session:trust`"
  - "[code://packages/sdk/src/host/spawn.ts#L1226-L1240](../../../../packages/sdk/src/host/spawn.ts#L1226-L1240) - `trustedBy`: the kept folder is trusted for its one session, and no folder under it"
  - "[code://packages/sdk/src/host/trust.ts#L95-L111](../../../../packages/sdk/src/host/trust.ts#L95-L111) - `under` and `sameFolder`, which compare folders after links are followed"
  - "[code://packages/sdk/src/plugins/validate.ts#L350-L363](../../../../packages/sdk/src/plugins/validate.ts#L350-L363) - `declared`, which refuses a registration the contracts do not list"
  - "[code://packages/sdk/src/plugins/plugins.ts#L1963-L1975](../../../../packages/sdk/src/plugins/plugins.ts#L1963-L1975) - `registerRoute`, the sibling of a registration with no name"
  - "[code://packages/sdk/src/plugins/plugins.ts#L1265-L1280](../../../../packages/sdk/src/plugins/plugins.ts#L1265-L1280) - the plugin's principal, `plugin:<name>` with `plugin` set, and `starts.can`"
  - "[code://packages/sdk/src/types/plugin.ts#L233-L266](../../../../packages/sdk/src/types/plugin.ts#L233-L266) - `PluginStarts`, what the host reads about the plugin behind an agent"
  - "[code://packages/sdk/src/host/tooling.ts#L1962-L1963](../../../../packages/sdk/src/host/tooling.ts#L1962-L1963) - a plugin's own agent, read as `agentStarts[provider].by`"
  - "[code://packages/sdk/src/host/actions.ts#L151-L183](../../../../packages/sdk/src/host/actions.ts#L151-L183) - the users gate on a dispatched action"
  - "[code://packages/sdk/src/host/admission.ts#L270-L330](../../../../packages/sdk/src/host/admission.ts#L270-L330) - `excusedBy`, where a command's grant is excused for what the caller may reach"
  - "[code://packages/sdk/src/host/routing.ts#L129-L137](../../../../packages/sdk/src/host/routing.ts#L129-L137) - `sessionFor`, the session a chat belongs to"
  - "[code://packages/bot/src/plugin.ts#L415-L425](../../../../packages/bot/src/plugin.ts#L415-L425) - the bot plugin's `root`, resolved when it applies"
  - "[code://packages/bot/src/plugin.ts#L571-L598](../../../../packages/bot/src/plugin.ts#L571-L598) - the bot plugin's connection: subscribe and dispatch on its talks' chats"
  - "[code://packages/webhook/src/plugin.ts#L253](../../../../packages/webhook/src/plugin.ts#L253) - the webhook plugin makes a session of the bot plugin's agent, so it keeps its grants"
  - "[code://docs/plugins/BOTS.md#L311-L314](../../../../docs/plugins/BOTS.md#L311-L314) - the bot plugin's grants, which this plan removes"
  - "[code://docs/plugins/PLUGINS.md#L1624-L1650](../../../../docs/plugins/PLUGINS.md#L1624-L1650) - the contracts table"
  - git://05c06a12d:.project/briefs/a-bots-folder-is-trusted.md - the brief this plan covers
---

## Goal

A talk with a bot works with no grant in the configuration file, on a host with or without users.
The bot's folder is trusted for its talks, and the bot plugin reads and writes its own talks.
Nothing else is opened. A session someone else starts in the folder is not trusted.
The plugin reaches no session that is not a bot talk.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "session:trust" packages/*/src` - checked in `sessionmethods.ts` for a placed folder and in `automations.ts` for a plugin's start, nowhere else.
- `rg "setTrustedFolder" packages/*/src` - the trust is kept on the session row by its id. There is no list of trusted folders.
- `rg "conn\.(request|notify)" packages/bot/src` - the bot plugin's connection sends `initialize`, `subscribe`, `unsubscribe` and `dispatchAction`, all on its talks' chats.
- `rg "agentStarts" packages/sdk/src` - the plugin behind an agent is `agentStarts[provider].by`, which `tooling.ts` already reads as "a plugin's own agent".

### Runtime path

```
createSession(bot-chat) -> placeSession -> trusted folder -> under a registered folder? -> kept.setTrustedFolder -> backend starts trusted
plugin:bot subscribe/dispatchAction -> users gate -> session of an agent of plugin:bot? -> session and chat grants excused
```

### Gaps

- A plugin cannot say that a folder is its own. `session:trust` is the only way to have a folder trusted.
- The users gate has no notion of a plugin's own agent. `plugin:bot` needs `session:read` and `session:write` on a host with users.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A bot's own folder is trusted with no grant | Softov: "I was thinking the bot folder was to be automatically trusted", 2026-11-14 | 01 |
| The trust is for the talk's session, not for the folder | Softov: "if we put the bot folder onto trusted, any one could then open a session onto the bot folder", 2026-11-14 | 01 |
| No prompt, and no setting | Softov chose "Trust at once", 2026-11-14 | 01 |
| The rule is for any plugin, and `session:trust` stays for other folders | Softov chose "General, keep the grant", 2026-11-14 | 01 |
| The manifest announces the folder, and the plugin names the path when it applies | Softov chose "Manifest announces, start names", 2026-11-14 | 01 |
| The announcement is `contracts.folders`, and the call is `registerFolder(path)` | (defaulted: a contract key is the plural of its register method, as `routes` and `registerRoute`) | 01 |
| `registerFolder` is refused for a plugin with no contracts | (defaulted: Softov's answer is that the host refuses a path the manifest did not announce, and a plugin with no contracts announces nothing) | 01 |
| A plugin reads and writes the sessions of its own agents with no grant | Softov chose "Own-agent sessions, no grant", 2026-11-14 | 02 |
| Only `session:` and `chat:` grants are excused | (defaulted: those are the grants a talk's chats need; a `computer:` or `file:` grant is about something else) | 02 |
| The webhook plugin keeps its four grants | (defaulted: its sessions are of the bot plugin's agent, not its own) | 02 |
| No plan for the grants brief now | Softov: "no plan for a-plugin-asks-for-its-grants.md", 2026-11-14 | - |
| Two commits, one PR | Softov: "separated commits. if possible same PR", 2026-11-14 | 01, 02 |

## Proposed architecture

- **Data flow** - the bot plugin calls `host.registerFolder(root)` when it applies. The host keeps the folder on the plugin's `PluginStarts.folders`. A trusted folder from `placeSession` or `startSession` is allowed where it is under one of them, or where the plugin holds `session:trust`.
- **Event flow** - none new.
- **State flow** - the trusted folder is kept on the session row as now, so a restart trusts the session again and only that session.
- **Layer responsibilities** - sdk: the contract key, `registerFolder`, the trust check and the gate excuse · bot: its manifest and the call · docs: PLUGINS.md and BOTS.md.
- **Source-of-truth files** - [`code://packages/sdk/src/host/trust.ts`](../../../../packages/sdk/src/host/trust.ts) holds the one check both trust paths call. [`code://packages/sdk/src/host/gate.ts`](../../../../packages/sdk/src/host/gate.ts) holds the one check both gates call.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - a plugin's own folder is trusted](task-01-a-plugins-own-folder-is-trusted.md) | implemented | - |
| [02 - a plugin reaches its own agents' sessions](task-02-a-plugin-reaches-its-own-sessions.md) | implemented | 01 |

## Risks and tradeoffs

- All bots share one plugin, so the host does not keep one bot from another. The bot plugin's code does that, as now. A principal per bot is a change of its own.
- A plugin's code runs in the daemon's process, so neither rule stops a hostile plugin. [plugin-runtimes-external.md](../../../briefs/plugin-runtimes-external.md) is about that.
- The excuse widens what a plugin's connection may do on a host with users. It is held to sessions whose agent the plugin registered, and to `session:` and `chat:` grants. A test holds each limit.

## Resume state

- **Done so far:** tasks 01 and 02, 2026-11-14, waiting for Softov's review.
- **Next action:** Softov's review of the PR, then [implemented.md](implemented.md) closes the plan.
- **Open questions:** none.
- **Watch out for:** the folder check follows links, through `trust.ts`. So a link inside the root that points out of it is not trusted.

## Final verification checklist

- [ ] A bot talk is created on a host with no grants on the bot plugin's entry, with and without users.
- [ ] A plain session in the bot's folder is not trusted.
- [ ] A trusted folder outside the registered folder still needs `session:trust`.
- [ ] `plugin:bot` with no grants is refused on a session of another agent.
- [ ] The sdk, bot and webhook suites pass, one at a time, and check and check-windows are green.
