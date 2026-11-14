---
title: A bot's folder is trusted
created: 2026-11-14
refs:
  - git://9b15ce74a - the commit of ahpd the facts were checked at
  - "[code://packages/bot/src/chat.ts#L1405-L1425](../../packages/bot/src/chat.ts#L1405-L1425) - `placeSession`: a talk runs in the bot's folder, `trusted: true`, whatever folder the client sent"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L1343-L1356](../../packages/sdk/src/host/sessionmethods.ts#L1343-L1356) - a trusted folder an agent places needs the plugin's own `session:trust`"
  - "[code://packages/sdk/src/plugins/plugins.ts#L1270](../../packages/sdk/src/plugins/plugins.ts#L1270) - a plugin's `can` reads only the grants of its entry"
  - "[code://packages/agent-claude/src/session/query.ts#L30-L35](../../packages/agent-claude/src/session/query.ts#L30-L35) - a trusted folder loads the project's settings files"
  - git://8274ce81a - plugin/52 p3 t10, where a bot's folder became trusted by `session:trust`
  - git://da032cc1f - #321, where the check moved to the talk's create
  - "[code://packages/sdk/src/sessions/sessions.ts#L128](../../packages/sdk/src/sessions/sessions.ts#L128) - the trusted folder is kept on the session row"
  - "[code://packages/sdk/src/host/automations.ts#L1015](../../packages/sdk/src/host/automations.ts#L1015) - an automation's trusted folder needs `session:trust`"
  - "[code://.project/briefs/a-plugin-asks-for-its-grants.md](a-plugin-asks-for-its-grants.md) - the grants brief, which stays apart"
---

# A bot's folder is trusted

Softov's goal: a bot's own folder is trusted without a grant in a configuration file.

## Why the folder is trusted

- A bot's rules are its `AGENTS.md`, and its skills and settings are files in its folder. The bot may change them, and that is the intent.
- A harness reads a folder's own files only where the folder is trusted. In agent-claude, a trusted folder adds the `project` and `local` settings sources.
- So a bot in an untrusted folder runs without its rules and its skills.

## What ahpd has now

- A talk runs in the bot's folder, `<root>/<slug>`, whatever folder the client sent. `placeSession` answers that folder with `trusted: true`.
- The host takes a trusted folder from an agent only where the plugin's entry holds `session:trust`. `can` reads only the entry's grants, so the check applies on every host, with or without a users directory.
- No entry has the grant by default. A talk is refused at its create with "plugin:bot may not session:trust here". Softov saw it on 2026-11-14.
- The host does not check the folder a plugin trusts. A plugin that holds `session:trust` can have any folder trusted, through `placeSession` or `host.startSession`.
- Plugin/52 made the folder trusted on 2026-10-17. Then the Back was a session the plugin started.
- #321 moved the check to the talk's create on 2026-11-13.

## Answers

| Question | Answer | Date |
| --- | --- | --- |
| Is the person asked at the first talk? | No. The talk's session is trusted at once, with no prompt and no setting | 2026-11-14 |
| Is the rule for bots only? | No. Any plugin may declare a folder of its own, and its agents' sessions there are trusted with no grant. The bot plugin declares its `root` | 2026-11-14 |
| Where is a plugin's own folder declared? | The manifest announces that the plugin owns a folder, so a person sees it before an install. The plugin names the path when it starts. The host refuses a path from a plugin whose manifest did not announce one | 2026-11-14 |
| Which plan comes first? | The grants plan. This plan follows it and puts its manifest key beside `asks` | 2026-11-14 |
| Does `session:trust` stay? | Yes, for any folder that is not the plugin's own. A plugin's automation that asks for a trusted folder still needs it | 2026-11-14 |

## The change

- The plugin's manifest announces that it owns a folder.
- The plugin names the folder when it applies. The bot plugin's `root` is an option the person sets, and its default `~/.bots` is in the plugin's code.
- The host trusts the session of a plugin's agent that is placed in that folder or under it, with no grant.
- The trust is kept with that one session, as it is now. A session someone else opens in the folder is not trusted by this rule.
- A folder outside the plugin's own still needs `session:trust`.

## What the code does that this keeps

- `kept.setTrustedFolder` keeps the trust on the one session by its id, so a restart trusts that session again. There is no list of trusted folders.
- An automation of a plugin asks for `session:trust` when it wants a trusted folder.
