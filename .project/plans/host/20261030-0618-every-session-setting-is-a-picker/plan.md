---
title: Every session setting with known values is a picker
domain: host
status: built
priority: medium
created: 2026-10-30
revalidated: 2026-10-30
refs:
  - git://3517c9a0 - the commit of `main` the facts were checked at
  - "[code://packages/bot/src/chat.ts#L1136-L1145](../../../../packages/bot/src/chat.ts#L1136-L1145) - the Bot chat harness declares `bot` as a plain string"
  - "[code://packages/agent-acp/src/agent.ts#L60-L87](../../../../packages/agent-acp/src/agent.ts#L60-L87) - `permissionMode` has no `enum` before a session asks the agent"
  - "[code://packages/agent-acp/src/session/config.ts#L42-L45](../../../../packages/agent-acp/src/session/config.ts#L42-L45) - a session keeps the modes the server named"
  - "[code://packages/agent-acp/src/session/config.ts#L185-L200](../../../../packages/agent-acp/src/session/config.ts#L185-L200) - a running session's schema draws `enum` and `enumLabels` from those modes"
  - "[code://packages/agent-acp/src/presets.ts#L29-L71](../../../../packages/agent-acp/src/presets.ts#L29-L71) - `AcpPreset`, the row for each shipped ACP agent"
  - "[code://packages/sdk/src/types/agent.ts#L626-L700](../../../../packages/sdk/src/types/agent.ts#L626-L700) - `Agent`, with `schema` and `defaults` and no answerer"
  - "[code://packages/sdk/src/plugins/plugins.ts#L614-L667](../../../../packages/sdk/src/plugins/plugins.ts#L614-L667) - a plugin key gets `enumDynamic` beside its answerer, and may not take a backend's key"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L1527-L1605](../../../../packages/sdk/src/host/sessionmethods.ts#L1527-L1605) - `resolveSessionConfig`, which orders the plugin and backend keys before the host's"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L1615-L1655](../../../../packages/sdk/src/host/sessionmethods.ts#L1615-L1655) - `sessionConfigCompletions` finds an answerer by the key's name only"
  - "[code://packages/sdk/src/host/sessionconfig.ts#L215-L225](../../../../packages/sdk/src/host/sessionconfig.ts#L215-L225) - a running session's schema, with `hostSchema` after the rest"
  - "[code://packages/sdk/src/host/sessionconfig.ts#L345-L353](../../../../packages/sdk/src/host/sessionconfig.ts#L345-L353) - `sessionSchema` puts the plugin keys before the backend's"
  - "[code://packages/computer/src/plugin.ts#L1958-L1990](../../../../packages/computer/src/plugin.ts#L1958-L1990) - `computer`, a list of records that is already a picker, and the pattern to copy"
---

## Goal

A client draws a session setting as a picker only when ahpd gives it an `enum` or marks it `enumDynamic`.
Two settings arrive as text boxes although the host knows their values: the Bot chat's `bot` and the ACP harnesses' Approvals.
After this plan, both are pickers in the new session box.
The settings also come in the order a person fills them in: Computer first, then Isolation and Branch, then the agent's own.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "sessionConfigCompletions|enumDynamic" packages/sdk/src` - only a plugin key has an answerer, and the host finds it by name.
- `rg -n "modes" packages/agent-acp/src` - the modes live on one session's context and nowhere else.
- `rg -n "hostSchema|sessionSchema" packages/sdk/src/host` - the two places that order a form's keys.

### Runtime path

```
new session box -> resolveSessionConfig(provider) -> sessionSchema(agent) + host keys
  -> bot: { type: string } -> a text box
  -> permissionMode: { type: string } -> a text box
client opens a picker -> sessionConfigCompletions(property) -> answerer by name -> items
```

### Gaps

- A backend cannot answer for a key of its own schema, so `bot` cannot be `enumDynamic`.
- An ACP harness knows no modes before its first session.
- The form puts the host's Isolation and Branch last.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A harness answers a key of its own schema, matched by harness and key | (defaulted: the ask already carries `provider`, and a plugin key would show on every harness) | 01 |
| The Bot chat offers the bot records as a picker, as `computer` offers machines | Softov, 2026-10-30: plan "every session setting is a picker" | 02 |
| Each ACP preset lists its agent's known modes, and the last session's modes replace them | Softov, 2026-10-30: "modes in each preset, refresh from the last session modes" | 03 |
| The last session's modes are kept in memory; after a restart the preset's list is used again | (defaulted: the preset covers a restart, and no new state file is needed) | 03 |
| An agent whose modes are not found keeps a text box | (defaulted: a wrong list is worse than no list) | 03 |
| The order is Computer, then Isolation and Branch, then the agent's own settings | Softov, 2026-10-30: "Computer first" | 04 |
| The same order holds in a running session's schema | (defaulted: the chips above the box and the form read the same keys) | 04 |
| Claude's `dontAsk` stays in its list | Softov, 2026-10-30: "the dontAsk skip it for now" | - |

## Proposed architecture

- **Data flow** - `Agent` gains an optional map of answerers for its own keys. `sessionConfigCompletions` asks the chosen harness's map first, then a plugin's.
- **Event flow** - An ACP session that hears its server's modes tells its agent, and the agent's next schema lists them.
- **State flow** - The ACP agent holds the last modes in memory, over the preset's list.
- **Layer responsibilities** - sdk: the answerer on `Agent`, the `enumDynamic` mark, the order · bot: the `bot` answerer · agent-acp: the preset modes and the refresh.
- **Source-of-truth files** - [`code://packages/sdk/src/host/sessionconfig.ts`](../../../../packages/sdk/src/host/sessionconfig.ts) for the order and the mark.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A harness answers its own setting](task-01-a-harness-answers-its-own-setting.md) | done | - |
| [02 - The bot chat offers its bots](task-02-the-bot-chat-offers-its-bots.md) | done | 01 |
| [03 - ACP approvals list the known modes](task-03-acp-approvals-list-known-modes.md) | done | - |
| [04 - Computer and isolation come first](task-04-computer-and-isolation-come-first.md) | done | - |

## Risks and tradeoffs

- A preset mode list goes stale when an agent changes its modes. The first session replaces it, and a running session shows the server's list.
- An answerer on `Agent` is a second way to answer a key. The plugin fold still refuses a plugin key that a backend declares, so a key has one answerer.
- Plan `plugin/56` also edits `packages/bot/src/chat.ts` - build task 02 after 56 merges.

## Resume state

- **Done so far:** all four tasks. A harness answers a key of its own schema, and the Bot chat offers its bots that way. An ACP harness lists the modes its agent's source names, until a session hears others. A session's settings come in the order computer, isolation and branch, then the rest.
- **Next action:** none. The plan is built. The chat a picked bot opens does nothing; [the brief](../../../briefs/bot-master-chat.md) holds it.
- **Open questions:** none.
- **Watch out for:** VS Code draws its own Approvals picker only for Claude's five modes. An ACP harness gets the plain picker, as expected.

## Final verification checklist

- [x] A new Bot chat in ahpw shows `bot` as a picker of the bot records.
- [x] A new Codex session shows Approvals as a picker before any Codex session ran.
- [x] The line above ahpw's new session box shows Computer, Isolation, Branch, then Approvals.
