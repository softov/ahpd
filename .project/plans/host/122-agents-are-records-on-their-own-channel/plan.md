---
title: Agents are records on their own channel
domain: host
status: built
priority: high
created: 2026-10-24
revalidated: 2026-10-24
requires: []
refs:
  - "[code://packages/sdk/src/connectors/channel.ts#L1-L39](../../../../packages/sdk/src/connectors/channel.ts#L1-L39) - the connectors channel, the pattern the agents channel copies"
  - "[code://packages/sdk/src/connectors/channel.ts#L204-L224](../../../../packages/sdk/src/connectors/channel.ts#L204-L224) - `ownerAllows`, the owner rules to copy"
  - "[code://packages/sdk/src/types/connectors.ts#L63](../../../../packages/sdk/src/types/connectors.ts#L63) - `ConnectorOwner`, the three owners"
  - "[code://packages/sdk/src/types/plugin.ts#L1164](../../../../packages/sdk/src/types/plugin.ts#L1164) - `registerAdapter`, the shape `registerAgentKind` copies"
  - "[code://packages/sdk/src/plugins/plugins.ts#L965-L968](../../../../packages/sdk/src/plugins/plugins.ts#L965-L968) - nothing is registered after `apply` returns"
  - "[code://packages/sdk/src/plugins/plugins.ts#L1211-L1222](../../../../packages/sdk/src/plugins/plugins.ts#L1211-L1222) - `registerAgent`, which a kind replaces for the four agent plugins"
  - "[code://packages/sdk/src/types/host.ts#L1273-L1304](../../../../packages/sdk/src/types/host.ts#L1273-L1304) - `replace` and `endSessionsOf`, how a running host takes a new agent list"
  - "[code://packages/sdk/src/host/auth.ts#L88-L106](../../../../packages/sdk/src/host/auth.ts#L88-L106) - `agentsFor`, where the agent list is already rewritten for one connection"
  - "[code://packages/server/src/commands/configure.ts#L162-L200](../../../../packages/server/src/commands/configure.ts#L162-L200) - `ahpd configure`, which writes presets into config.json today"
  - "[code://packages/agent-pi/src/machine.ts#L25](../../../../packages/agent-pi/src/machine.ts#L25) - `PI_KEY_VARIABLES`, the key variables pi reads"
  - "[code://packages/bot/src/record.ts#L104-L105](../../../../packages/bot/src/record.ts#L104-L105) - a bot names its agent by id in `preset`"
  - "[code://docs/plugins/PLUGINS.md#L1331](../../../../docs/plugins/PLUGINS.md#L1331) - an unload ends the sessions of its agents"
  - "file:///github/ahp-review/briefs/agent-presets.md - the brief this plan answers"
---

## Goal

A person adds, edits and removes an agent the way they add, edit and remove a connector.
Each agent is a record on the channel `x-ahpd-agents`, and each agent plugin registers a kind with a schema.
agent-claude, agent-acp, agent-cofold and agent-pi each serve many agents this way, and `presets` leaves their options.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "registerAgent" packages/sdk/src` - a plugin registers agents only while `apply` runs.
- `rg -n "replace\(|endSessionsOf" packages/sdk/src/types/host.ts` - the host already takes a new agent list while it runs, and ends the sessions of one agent.
- `rg -n "agentsFor" packages/sdk/src` - the root state's agent list already passes through one function per connection.
- `rg -ln "presets" packages/server/src` - `ahpd configure` and the option readers write and read `presets`.

### Runtime path

```
x-ahpd/agents/put -> check against kind schema and owner -> record in agents/<id>.json, keys to the vault
  -> kind.open(record) -> Agent -> host.replace(new fold) -> root/agentsChanged -> agentsFor(connection) filters the list
x-ahpd/agents/remove -> endSessionsOf(id) -> record and secrets removed -> host.replace
edit -> live record updated -> the session reads it at its next turn
```

### Gaps

- An agent lives in a plugin's options, so a change rewrites the whole `presets` object and applies the plugin again.
- agent-cofold and agent-pi give one agent per daemon.
- The four plugins name the same field in different ways, such as `name` and `displayName`.
- Every caller sees every agent.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Agents have their own channel, `x-ahpd-agents`, built on the connector code | Softov, 2026-10-24: "I think we could use x-ahpd-agents." | 01 |
| An agent's owner is `host`, `team:<id>` or `user:<id>` | (defaulted: the connector owners; Softov asked whether a person can have one) | 01 |
| The grants are `agent:list`, `agent:put`, `agent:remove` and `agent:host`, with the connector owner rules. `admin` has them all, and `member` has none | Softov, 2026-10-24: "Copy the connector grants" | 01 |
| `agent:all` reads every agent and removes any agent, whoever owns it. `admin` has it | Softov, 2026-10-24: "Add agent:all" | 01 |
| A key field is write-only. The vault holds it, and no client, session or log gets the value | Softov, 2026-10-24: "Never, like connectors" | 01 |
| The channel owns `name`, `description`, `icon` and `model` on every agent. A kind's schema adds only its own fields | Softov, 2026-10-24: "Name, description, icon, model" | 01 |
| An agent id is unique across all owners, and a `put` with an id another owner holds is refused | (defaulted: a client names an agent by its id) | 01 |
| A kind names its host-only fields. Only a host agent may set them | Softov, 2026-10-24: "for now host agents only" | 01 |
| A kind names the environment variables that any owner may set, as key fields. Every other `env` variable is host-only | (defaulted: a free `env` can run a program, such as `NODE_OPTIONS`, and a person still needs to set their own key) | 01, 03-06 |
| An edit applies at the next turn. The running turn ends on the old record | Softov, 2026-10-24: "Next turn uses the change" | 01 |
| A kind's `open` gets a live view of the record, and the session reads it at the start of each turn | (defaulted: the host cannot swap a backend under an open session) | 01 |
| A removed agent ends the sessions that run on it | Softov, 2026-10-24 | 01 |
| A caller sees and starts a session only on an agent it may use. A host agent needs `session:write`, a team agent a membership of that team, and a person's agent that person | Softov, 2026-10-24: "Who can see it" | 02 |
| Every agent in the list is a record. A kind's templates are what a new record starts from | Softov, 2026-10-24: "Templates, records hold agents" | 03, 04 |
| A plugin's options keep the defaults for the whole plugin. A record overrides a default where the kind allows it | Softov, 2026-10-24: "Plugin-wide defaults" | 03-06 |
| At the first start, each preset in `config.json` becomes a host record, `claude` becomes a record, and `presets` leaves `config.json`. The daemon logs this once | Softov, 2026-10-24: "At first start" | 07 |
| `ahpd configure` writes a record, not a preset | (defaulted: it writes presets today, and they are no longer read) | 07 |
| A bot that names a removed agent shows `unavailable` | (defaulted: the connector rule) | 07 |
| One plan, not a parent with child plans | Softov, 2026-10-24: "Its 1 plan" | - |

## Proposed architecture

- **Data flow** - a record is `{ id, kind, owner, name, description?, icon?, model?, config }`. `config` is held to the kind's schema.
- **Event flow** - a `put` or a `remove` takes a new fold with `host.replace`, which sends `root/agentsChanged`.
- **State flow** - the records are on disk in `~/.config/ahpd/agents/`, and the keys are in the vault under `agent/<id>/<field>`.
- **Layer responsibilities** - sdk: the kind type, the channel and the list filter. server: the migration and `ahpd configure`. Each agent plugin: its kind, its schema and its templates.
- **Source-of-truth files** - [`code://packages/sdk/src/connectors/channel.ts`](../../../../packages/sdk/src/connectors/channel.ts) is the pattern. The new channel is `packages/sdk/src/agents/channel.ts`.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The agents channel](task-01-the-agents-channel.md) | done | - |
| [02 - A caller sees only the agents it may use](task-02-a-caller-sees-its-agents.md) | done | 01 |
| [03 - agent-claude registers a kind](task-03-agent-claude-registers-a-kind.md) | done | 01 |
| [04 - agent-acp registers a kind](task-04-agent-acp-registers-a-kind.md) | done | 01 |
| [05 - agent-cofold registers a kind](task-05-agent-cofold-registers-a-kind.md) | done | 01 |
| [06 - agent-pi registers a kind](task-06-agent-pi-registers-a-kind.md) | done | 01 |
| [07 - Presets become records at the first start](task-07-presets-become-records.md) | done | 03, 04, 05, 06 |
| [08 - The docs describe agent records](task-08-docs-describe-agent-records.md) | done | 07 |

## Risks and tradeoffs

- The plan spans the sdk, the server and four plugins. The do-spec rule makes that a parent. Softov asked for one plan.
- The migration rewrites `config.json`. A failure in the middle must leave the old file, so the records are written first and `config.json` last.
- A client from before this plan does not know `x-ahpd-agents`. It still sees the agent list in the root state.

## Resume state

- **Done so far:** task 01, the agents channel, with its tests; the connectors channel and its tests are unchanged. Task 02, the caller's own agent list, with its tests. Task 03, the `claude` kind in agent-claude, with an edit applying at the next turn. Task 04, the `acp` kind in agent-acp, with the shipped rows as templates, an edit applying at the next turn by another server on the same conversation. Task 05, the `cofold` kind in agent-cofold, with one store folder per record, a record's keyed search providers refused because the channel vaults top-level fields only. Task 06, the `pi` kind in agent-pi, with a record's variables resolved to pi's runtime key per provider each turn and never written to `process.env`, a record's model taking effect at the next turn; a variable pi uses as request headers rather than a key, `ANTHROPIC_AUTH_TOKEN`, is the one thing a record cannot set. Task 07, the migration: `config.json`'s presets and per-agent options become `owner: "host"` records at the first start, before any plugin loads, with a backup and a temp-file rename of the file and one line of ids; `ahpd configure` writes records; a bot whose agent is not served reads `unavailable`; the daemon starts on records alone; `presets` is gone from the plugins and their manifests. Task 08, the docs: PLUGINS.md registers `registerAgentKind`, documents every `AgentKind` field, and describes `x-ahpd-agents` with its grants, owners and vault names; the four agent READMEs state their kind, templates, host-only fields and key variables and carry record examples; both worked examples are off `presets`.
- **Merged:** reviewed and merged in #89 as `2ecd2025` on 2026-10-24, with CI green on Windows. The review added six fixes. A preset's key moves to the vault. A removed `claude` record stays removed. Only the presets that became records leave the file. The migration plans the file's own presets, not the run's flags. The marker is next to the records. A record's resolved model key is sent with the models fetch. The `presets` references in `README.md`, `docs/plugins/COMPUTERS.md`, `docs/server/PLUGINS.md`, `docs/server/CONFIGURE.md` and `.project/specs/plugin-loading.md` were corrected in the same PR.
- **Next action:** none. The plan is built, and `implemented.md` says what exists.
- **Open questions:** none.
- **Watch out for:** Softov's build sessions run on the agent `claude-deepseek-build`. A daemon with this plan must still offer it after the first start, with the same id.

## Final verification checklist

- [ ] On Softov's daemon, `claude-deepseek-build` and the other agents are listed after the first start, and a build session still runs.
- [ ] A second agent-cofold record is listed and answers a turn.
- [ ] An edit of a key applies at the next turn of a running session.
