---
title: A plugin is a client of its own host, as a principal of its own
domain: plugin
status: planned
priority: high
created: 2026-09-26
revalidated: 2026-10-04
requires:
  - plans/plugin/01-plugins-load-from-configuration/plan.md
  - plans/host/11-a-grant-is-a-subject-and-a-verb/plan.md
changes: []
creates: []
decisions:
  - decisions/plugin-contributes-host-options.md
  - decisions/a-grant-is-a-subject-and-a-verb.md
refs:
  - "[code://packages/sdk/src/types/plugin.ts#L139-L279](../../../../packages/sdk/src/types/plugin.ts#L139-L279) - `PluginHost`, which gains one method"
  - "[code://packages/sdk/src/types/plugin.ts#L66-L73](../../../../packages/sdk/src/types/plugin.ts#L66-L73) - `PluginSpec`, which gains `grants`"
  - "[code://packages/sdk/src/types/host.ts#L753](../../../../packages/sdk/src/types/host.ts#L753) - `Host.accept(peer, principal, root)`, which serves the connection"
  - "[code://packages/sdk/src/types/rpc.ts#L34-L59](../../../../packages/sdk/src/types/rpc.ts#L34-L59) - `Peer`, the raw JSON-RPC shape"
  - "[code://packages/sdk/src/types/users.ts#L40-L101](../../../../packages/sdk/src/types/users.ts#L40-L101) - `Principal`, what the plugin's identity is, with `memberships` and `teams`"
  - "[code://packages/sdk/src/users.ts#L79](../../../../packages/sdk/src/users.ts#L79) - `holds`, the `*` matching a role's grants use"
  - "[code://packages/sdk/src/host/owners.ts#L47-L51](../../../../packages/sdk/src/host/owners.ts#L47-L51) - `ownerFor`, which makes any principal `user:<id>`"
  - "[code://packages/sdk/src/types/usage.ts#L19](../../../../packages/sdk/src/types/usage.ts#L19) - `Owner`, which has no plugin form"
  - "[code://packages/server/src/commands/options.ts#L408-L416](../../../../packages/server/src/commands/options.ts#L408-L416) - `pluginEntry`, the config schema of one `plugins` entry"
  - "[code://packages/sdk/src/plugins.ts#L299](../../../../packages/sdk/src/plugins.ts#L299) - `pluginHost`, where each plugin's `PluginHost` is built"
  - "[code://packages/server/src/plugins.ts#L684](../../../../packages/server/src/plugins.ts#L684) - where the loader builds it with the spec in hand"
  - "[code://packages/server/src/config.ts#L378-L392](../../../../packages/server/src/config.ts#L378-L392) - `asSpec`, which reads a configuration entry"
  - "[code://packages/server/src/commands/run.ts#L639](../../../../packages/server/src/commands/run.ts#L639) - `createHost`, after which a connection can exist"
  - file:///github/externals/vscode/src/vs/platform/agentHost/LOCAL_ENDPOINT.md - VS Code's workbench reaches its own agent host as a client over an in-memory transport
---

## Goal

A plugin can start a session, send a turn, answer an input request and run an automation, by speaking AHP to its own host over an in-memory connection.
It does so as `plugin:<name>`, with only the grants the operator wrote for it.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "accept\(" packages/sdk/src packages/server/src` - `Host.accept` is the one way a connection is served, and `listen` calls it per socket.
- `rg -n "grants" packages/sdk/src/types/plugin.ts packages/server/src/config.ts` - nothing; a plugin has no identity today.

### Runtime path

```
apply(host) -> [new] host.connect() held for later
createHost -> listen -> a plugin calls its connection
  -> in-memory peer pair -> Host.accept(peer, principal plugin:<name>)
  -> initialize, createSession, dispatch, subscribe -> the dispatch gate asks principal.can(grant)
  -> what the host sends reaches the plugin's onMessage
```

### Gaps

- `PluginHost` has no way to act.
- A plugin has no principal, and its configuration entry has no grants.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [A plugin contributes the host's own options, and there is no service container](../../../decisions/plugin-contributes-host-options.md) | "a plugin that wants to watch a running host is a client instead" |
| 2 | [A grant is a subject and a verb](../../../decisions/a-grant-is-a-subject-and-a-verb.md) | the grants the plugin's principal holds |

| What | Source | Task |
| --- | --- | --- |
| A plugin acts as an in-process AHP client, served by `Host.accept` over an in-memory peer | Softov, 2026-09-26: "for the other suggestion I'm ok" | 01 |
| The plugin gets the raw peer: `request`, `notify` and `onMessage`, and writes AHP with the SDK's existing protocol types; no typed client, no new layer | Softov, 2026-09-26: "Raw peer" | 01 |
| The connection is available once the host is built; asked for earlier, it refuses with a sentence | `createHost` runs after every `apply` | 01 |
| The connection's principal is `plugin:<name>`, with the grants written on the plugin's configuration entry as `grants`, and none by default | Softov, 2026-09-26: "for the other suggestion I'm ok" | 02 |
| The plugin's principal has no `memberships`, `primary` or `teams`, so its work is charged to nothing; a policy matches it by its id | (defaulted: a plugin belongs to no team, and the id is what a policy can name) | 02 |
| A malformed grant is dropped and reported in the loader's `problems`, naming `plugins.<name>.grants` | (defaulted: a load problem is reported where every other one is) | 02 |
| On a host with no user directory there is no gate, so the grants are not consulted | [`code://.project/decisions/the-door-is-a-door.md`](../../../decisions/the-door-is-a-door.md) | 02 |
| Acting as a person comes later, as a grant the plugin must hold | Softov, 2026-09-26 | - |
| `docs/PLUGINS.md` describes the connection and `grants` | the plugin docs cover every method | 03 |

## Proposed architecture

- **Data flow** - two ends of an in-memory pair; the host's end is a `Peer` handed to `Host.accept`, the plugin's end sends requests and notifications and receives what the host sends.
- **Event flow** - none new; the plugin subscribes to channels like any client.
- **State flow** - one connection per call, closed by the plugin or at `stopping`.
- **Layer responsibilities** - `packages/sdk`: the method, the pair, the principal · `packages/server`: `grants` on the spec and handing the built host to the plugins · `docs/PLUGINS.md`: the method.
- **Source-of-truth files** - [`code://packages/sdk/src/types/plugin.ts`](../../../../packages/sdk/src/types/plugin.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A plugin opens an in-memory connection to its host](task-01-a-plugin-opens-a-connection.md) | todo | - |
| [02 - The connection is plugin:<name>, with the grants its entry names](task-02-the-connection-is-the-plugins-principal.md) | todo | 01, and the open question in Resume state |
| [03 - Docs](task-03-docs.md) | todo | 02 |

## Risks and tradeoffs

- A plugin with `*:*` is root in all but name - the operator wrote it, and `none by default` makes it a choice.
- A plugin that never closes its connection keeps its subscriptions - connections close at `stopping`.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-a-plugin-opens-a-connection.md](task-01-a-plugin-opens-a-connection.md).
- **Open question (ask before task 02):** `ownerFor` (`host.ts:4507-4511`) makes any principal `user:<id>`, so a principal `plugin:<name>` owns its sessions as `user:plugin:<name>`, and `Owner` has no plugin form - (a) add a `plugin:<name>` form to `Owner` and have `ownerFor` answer it for a plugin's principal, or (b) own a plugin's work as `root:<host>`.
- **Watch out for:** the plugin's end must introduce itself with `initialize` like any client; the host refuses anything before it.

## Final verification checklist

- [ ] A fixture plugin creates a session and sends a turn through its connection, and a watching client sees the turn.
- [ ] With a user directory, a plugin with no `grants` is refused `-32009`, and one with `session:write` is not.
- [ ] Asking for a connection during `apply` refuses with a sentence.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm boundary` green; `docs/PLUGINS.md`, `plans/index.md` updated.
