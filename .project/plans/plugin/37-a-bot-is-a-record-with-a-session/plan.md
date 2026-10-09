---
title: A bot is a record a person makes, with a session to talk to it in
domain: plugin
status: built
priority: high
created: 2026-10-07
revalidated: 2026-10-08
requires: []
changes: []
creates: []
decisions:
  - decisions/bot-records-live-in-the-bot-plugin.md
  - decisions/a-bot-gets-its-session-by-a-link-or-at-make.md
  - decisions/a-plugin-starts-a-session-as-an-owner.md
  - decisions/a-bot-owns-one-folder.md
  - decisions/the-computer-is-an-object-a-person-manages.md
  - decisions/a-scheme-provider-may-authorize-a-read-itself.md
refs:
  - "[code://packages/computer/src/plugin.ts#L1053](../../../../packages/computer/src/plugin.ts#L1053) - the computer plugin registers its scheme, the pattern this package follows"
  - "[code://packages/computer/src/provider.ts#L85-L92](../../../../packages/computer/src/provider.ts#L85-L92) - a provider with list, resolve, read, write, remove and describe"
  - "[code://packages/sdk/src/types/resources.ts#L226-L245](../../../../packages/sdk/src/types/resources.ts#L226-L245) - `SchemeDescription` and `ResourceProvider`"
  - "[code://packages/sdk/src/host/resourcemethods.ts#L148-L184](../../../../packages/sdk/src/host/resourcemethods.ts#L148-L184) - `resourceWrite` and `resourceDelete`, which hand the provider the owner and the reader"
  - "[code://packages/sdk/src/host/admission.ts#L145-L155](../../../../packages/sdk/src/host/admission.ts#L145-L155) - a write to `bot:/x` asks for `bot:put`, read from the scheme"
  - "[code://packages/sdk/src/users.ts#L85-L93](../../../../packages/sdk/src/users.ts#L85-L93) - a scheme the table does not name takes the resource operations"
  - "[code://packages/sdk/src/host/automations.ts#L657-L732](../../../../packages/sdk/src/host/automations.ts#L657-L732) - an automation's run starts a session as its owner"
  - "[code://packages/sdk/src/types/sessions.ts#L100-L102](../../../../packages/sdk/src/types/sessions.ts#L100-L102) - a session's owner"
  - "[code://packages/sdk/src/policies.ts#L277](../../../../packages/sdk/src/policies.ts#L277) - `filePolicies`, a JSON file store to mirror"
---

## Goal

A person makes a bot: a name, labels, a description, a body, a colour, instructions, and a preset or a harness and model.
The bot has a fixed address, `bot:/motion`, a folder of its own, and a session to talk to it in.
That session is one the person already has, or one the host starts when the bot is made.
This is the first piece of bots.
It comes before the bot harness, wakes, channels and a bot as a principal.
A person can try bots now with the harnesses the host runs today.

## Reconnaissance

### Searches performed

- `rg "registerResourceProvider\(" packages/*/src` - only `computer` registers a scheme from a plugin; `people:`, `policy:` and `usage:` are wired by the host in `run.ts`.
- `rg -n "bot" .project/plans/index.md` - no bot plan; host/71 names the bot study as the plan it unblocks.
- `rg -n "startSession|createSession" packages/sdk/src/types/plugin.ts` - nothing; a plugin cannot start a session today.

### Runtime path

```
client resourceWrite bot:/motion -> gate bot:put -> bot provider write -> bot store file
                                                                      -> host.startSession(owner) -> session URI on the record
client resourceRead bot:/motion -> bot provider read -> record JSON
```

### Gaps

- `Not found: a PluginHost method that starts a session - searched "Session" in packages/sdk/src/types/plugin.ts`.
- `Not found: a principal kind for a bot - searched "kind" in packages/sdk/src/types/users.ts`. This plan does not need one.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [Bot records live in a bot plugin, the way computers do](../../../decisions/bot-records-live-in-the-bot-plugin.md) | Softov, 2026-10-07 |
| 2 | [A bot gets its session by a link to one its owner has, or a new one at make](../../../decisions/a-bot-gets-its-session-by-a-link-or-at-make.md) | Softov, 2026-10-07 |
| 3 | [A plugin starts a session as a named owner](../../../decisions/a-plugin-starts-a-session-as-an-owner.md) | defaulted |
| 4 | [A computer is an object a person manages](../../../decisions/the-computer-is-an-object-a-person-manages.md) | a bot is made, edited and deleted the same way |
| 5 | [A scheme provider may authorize a read itself](../../../decisions/a-scheme-provider-may-authorize-a-read-itself.md) | an owner reads their own bot without `bot:get` |
| 6 | [A bot owns one folder, and every session the host starts for it runs there](../../../decisions/a-bot-owns-one-folder.md) | Softov, 2026-10-07 |

| What | Source | Task |
| --- | --- | --- |
| A `bot:` resource provider holds the records; the `bot` harness is a separate agent provider | Softov, 2026-10-07 | 01 |
| The id is a slug, `bot:/motion` and `@motion`, unique on the host and fixed once made; the name can change | Softov, 2026-10-07 | 01 |
| Anyone with `bot:write` makes a bot; the maker owns it, or a team or project they choose | Softov, 2026-10-07 | 01 |
| A write that names a `team:` or `project:` owner is refused with `-32009` unless the writer belongs to it; root names any owner | Softov, 2026-10-08, "Check membership" | 01 |
| An edit or a delete is for the bot's owner, its team or project, an admin or root; anyone else is refused `-32009` | Softov, 2026-10-08, "Who may edit or delete a bot?" - "owner, members, admin/root" | 01 |
| A new bot gets a body at random from the host's list, and the owner can change it | Softov, 2026-10-07, "Random, can change" | 01 |
| The bodies are `robot`, `humanoid`, `alien`, `gumbo`, `circle`, `semicircle`, `smash`, `square`, `triangle`, `pentagon`, `hexagon`, `drop`, `bean`, `cloud`, `ghost`, a fixed list in the host | Softov, 2026-10-07 | 01 |
| The colour is the owner's pick from a fixed palette: the 11 colours of ahpapp's `/bots-test` | Softov, 2026-10-07; the list is (defaulted: the one ahpapp draws today) | 01 |
| Labels are short words for what the bot does, and two bots can share one | Softov, 2026-10-07 | 01 |
| A preset, when set, wins over the bot's harness and model; with neither, the host's default harness and its default model | Softov, 2026-10-07, "Both, preset wins" | 04 |
| The instructions are on the bot, added to what the preset or harness brings | Softov, 2026-10-07 | 04 |
| A deleted bot leaves a tombstone so its slug is never reused, and its sessions stay readable by the owner | Softov, 2026-10-07, "ok for now" | 01 |
| A bot runs on this host or in a computer: `computer` on the record | Softov, 2026-10-07, "with it inside a computer" | 04 |
| A deleted bot leaves its folder | (defaulted: the files are its owner's) | 01 |
| A linked session keeps its own working directory; the bot's folder is for the sessions the host starts | (defaulted: a link adopts a session as it is) | 02 |
| Roles, memberships, mood, notifications and the bot harness wait for later plans | Softov, 2026-10-07, "the bot:/ before all planning" | - |

## Proposed architecture

- **Data flow** - A client makes a bot with a write of JSON to `bot:/<slug>` and `createOnly`. It edits the bot with a write and `ifMatch`, and deletes it with `resourceDelete`. The plugin checks the record, fills `body`, `owner`, `workspace` and the times, and saves it as one file under `<configDir>/bots/`.
- **Session flow** - A record with `session` set to a URI is checked against the session's owner. A record made with no `session` gets a new one from `host.startSession`, in the bot's folder, and its URI is saved on the record.
- **Layer responsibilities** - sdk: `PluginHost.startSession`, which automations share · bot: the record, the store, the provider, the session at make · docs: the scheme and its grants.
- **Source-of-truth files** - `packages/bot/src/record.ts` (created by task 01).

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The bot plugin serves bot: records a person makes, edits and deletes](task-01-the-bot-plugin-serves-bot-records.md) | done | - |
| [02 - A bot links a session its owner has](task-02-a-bot-links-a-session-its-owner-has.md) | done | 01 |
| [03 - A plugin starts a session as an owner](task-03-a-plugin-starts-a-session-as-an-owner.md) | done | - |
| [04 - Making a bot with no session starts one](task-04-making-a-bot-starts-its-session.md) | done | 01, 03 |
| [05 - Docs](task-05-docs.md) | done | 04 |

## Risks and tradeoffs

- The instructions go in as the session's first turn, so making a bot runs one turn and spends tokens. A harness that takes a system prompt can carry them later without a turn.
- `startSession` lets a plugin act as any owner it names. Only a plugin the host loads holds it, like every other `PluginHost` method, and the bot plugin passes only the owner of the write.
- A slug is fixed forever, so a tombstone file stays for each deleted bot.

## Resume state

- **Done so far:** task 01 and task 03, merged 2026-10-08 (1a3ee7a). `packages/bot` is a new plugin package, `@ahpd/bot`. Its provider serves `bot:` records, keeps one JSON file per bot under its `root`, and leaves a tombstone file for each deleted slug. A make with no `workspace` gets the folder `<root>/<slug>`, and an owner reads their own bot without holding `bot:get`. A write naming a `team:` or `project:` owner is checked against the writer's memberships, with the read road's `covers` rule. Both roads that change a bot ask who the writer is. An edit and a delete are for the owner, a member of its team or project, an admin (`*:*`) and the host. A holder of the grant that makes a bot touches no other. That took one host change: `write` and `remove` now take the reader their provider needs, as `read` already did. In the sdk, a plugin's `startSession` and the `pluginStarts` live binding are in. The steps a run takes to start a session moved into one `beginSession` that both roads call.
- **Built since:** tasks 02, 04 and 05, in that order, merged 2026-10-08 (6fb1289). A bot's `session` is written now: a body may link one, kept only where this host has it and it belongs to the bot's owner (`-32602` where the host has none, `-32009` where it is somebody else's), set to `null` to unlink, and left alone by a write that does not mention it. A make with no `session` gets one, built by `packages/bot/src/start.ts` and started through `host.startSession` as the bot's owner, in the bot's folder, before the record is saved. The docs are in `docs/BOTS.md`, with the `bot:` scheme named in RESOURCES.md and `startSession`/`sessionKept`/`sessionOwner` in PLUGINS.md.
- **sdk additions beyond the tasks' file lists:** `PluginHost.sessionOwner(uri)` (mirrors `sessionKept`), `SessionRequest.model` and `SessionRequest.title`, `StartSession.title`, and `SessionRequest.prompt` becoming optional - absent is a session that opens silent, present-and-blank is still refused. `beginIn` returns without firing a turn when the text is blank, and `beginSession` passes the title to `openSession`.
- **Outside the tasks' file lists:** the scheme's make form (`MANIFEST` in `packages/bot/src/provider.ts`) gained `session` and `owner`, since a body may carry either and a form a client cannot fill in is a form that lies; and the root README's package table and badge block gained `@ahpd/bot`, which task 01 did not add.
- **Next action:** none - the plan is built.
- **Open questions:**
  1. Which ahpc and ahpapp screens make a bot? - proposed: a plan in each client after this one, drawn from the scheme's `manifest`.
  2. Does a bot on the Claude harness keep its own memory? - proposed: the bot harness plan sets `autoMemoryDirectory` per bot (Softov, 2026-10-07).
  3. The colour palette is the 11 colours of ahpapp's `/bots-test`, written into `packages/bot` as a fixed list. No palette exists in this repository, so a change to ahpapp's has to come back here.
  4. On a host with no users directory there is no writer to name. A bot made there is owned by `root:<hostName>`, the owner a root connection's write carries.
- **Watch out for:** the slug is the URI path, not a field a write can change. A write whose body names another `id` is refused. The folder is made before the session starts, on this host or inside the computer.

## Final verification checklist

- [x] A bot is made, read, listed, edited and deleted over AHP, and its slug is refused after delete.
- [x] A bot made with no session has one, owned by its maker, in the bot's folder, and the first turn is its instructions.
- [x] `node tools/schema.mjs`, `pnpm build`, `pnpm typecheck`, `pnpm boundary` and `npx vitest run` pass.
- [x] `plans/index.md` updated.
