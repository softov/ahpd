---
title: A plugin cannot change what the host gave it
domain: plugin
status: planned
priority: high
created: 2026-10-08
revalidated: 2026-10-08
requires: []
changes: []
creates: []
decisions:
  - decisions/a-plugin-gets-frozen-copies-of-host-values.md
refs:
  - "[code://packages/sdk/src/users.ts#L782-L810](../../../../packages/sdk/src/users.ts#L782-L810) - a principal is a writable literal; `can` and `id` are own properties"
  - "[code://packages/server/src/commands/authorize.ts#L29-L33](../../../../packages/server/src/commands/authorize.ts#L29-L33) - `ROOT`, one module-level principal for the deployment token"
  - "[code://packages/sdk/src/host/resourcemethods.ts#L74-L92](../../../../packages/sdk/src/host/resourcemethods.ts#L74-L92) - `list` and `read` get `connection.principal` itself"
  - "[code://packages/sdk/src/host/admission.ts#L206-L231](../../../../packages/sdk/src/host/admission.ts#L206-L231) - `authorize` gets the principal before the gate calls `who.can`"
  - "[code://packages/sdk/src/host/sessionconfig.ts#L325-L368](../../../../packages/sdk/src/host/sessionconfig.ts#L325-L368) - `sessionSchema` and `runningSchema` return other plugins' schema entries by reference"
  - "[code://packages/sdk/src/host/tooling.ts#L110-L122](../../../../packages/sdk/src/host/tooling.ts#L110-L122) - `shapedDefinition` returns the live `HostTool.definition`"
  - "[code://packages/sdk/src/host/tooling.ts#L270-L282](../../../../packages/sdk/src/host/tooling.ts#L270-L282) - a tool's `context()` returns another backend's live turns"
  - "[code://packages/sdk/src/host/tooling.ts#L408](../../../../packages/sdk/src/host/tooling.ts#L408) - `mcpFor` copies the map, not the `McpServer` entries with their credentials"
  - "[code://packages/sdk/src/host/spawn.ts#L460-L470](../../../../packages/sdk/src/host/spawn.ts#L460-L470) - `Start.resources` is the host's own file store"
  - "[code://packages/sdk/src/plugins.ts#L176-L181](../../../../packages/sdk/src/plugins.ts#L176-L181) - `foldHostOptions` spreads the base, which reads the `mcpServers` getter once"
  - "[code://packages/server/src/commands/run.ts#L566-L571](../../../../packages/server/src/commands/run.ts#L566-L571) - the `mcpServers` getter, so a root-config edit reaches the next session"
  - "[code://packages/sdk/src/plugins.ts#L370-L402](../../../../packages/sdk/src/plugins.ts#L370-L402) - the fold keeps each plugin's `PluginTriggers` object live"
  - "[code://packages/sdk/src/plugins.ts#L660-L680](../../../../packages/sdk/src/plugins.ts#L660-L680) - `registerTriggerType` still writes after the fold"
  - "[code://packages/sdk/src/host/automations.ts#L912-L918](../../../../packages/sdk/src/host/automations.ts#L912-L918) - `fired` does not check that the type is the firing plugin's"
  - "[code://packages/sdk/src/plugins.ts#L725-L740](../../../../packages/sdk/src/plugins.ts#L725-L740) - `raise` hands one event object to every listener in turn"
  - "[code://packages/server/src/plugins.ts#L600-L645](../../../../packages/server/src/plugins.ts#L600-L645) - `apply` options; `secretAtUse` nodes are passed as they are"
  - "[code://packages/server/src/plugins.ts#L740-L760](../../../../packages/server/src/plugins.ts#L740-L760) - the context each plugin gets; `paths` is the daemon's own array"
  - "[code://packages/server/src/plugins.ts#L957](../../../../packages/server/src/plugins.ts#L957) - the plugin's `optionsSchema` is kept live and masks its secrets"
---

## Goal

A plugin cannot change the host's state through any value the host gives it, or through a value it gave the host.
Today a resource provider can rewrite the principal that the gate checks.
An agent can change another plugin's session settings, a host tool's definition or an MCP server's credentials.
A plugin can take another plugin's trigger type after load.
After this plan, every value that crosses the plugin boundary is a frozen copy.
Each site in the survey gets a test that tries the write.
This guards the host against a plugin's writes; it does not sandbox a plugin.

## Reconnaissance

### Searches performed

- `rg "Object.freeze" packages/sdk/src packages/server/src` - none.
- `rg "structuredClone" packages/sdk/src` - only the replay buffer and snapshots.
- `rg "can: \(" packages/*/src` - two principal builders: `users.ts:804` and `ROOT` in `authorize.ts`.
- A survey of every crossing on 2026-10-08; its findings are the refs above, and each task names its sites.

### Runtime path

```
host value -> copy + freeze at the crossing -> plugin (provider, agent Start, tool context, event listener, apply)
plugin contribution -> copy + freeze at registration or fold -> host keeps only its copy
```

### Gaps

- No test anywhere writes to a value a plugin was given.
- `Not found: a check that a fired trigger type belongs to the plugin that fires it - searched "fired" in packages/sdk/src/host/automations.ts.`

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [A plugin gets frozen copies of the host's values, never the host's own objects](../../../decisions/a-plugin-gets-frozen-copies-of-host-values.md) | Softov, 2026-10-08 |

| What | Source | Task |
| --- | --- | --- |
| Every principal the host builds is frozen, `ROOT` included | survey, 2026-10-08 | 01 |
| An agent's `Start` holds copies: schema, tool definitions, MCP servers, a per-session file store | survey, 2026-10-08 | 02 |
| A tool's `context()` returns a frozen copy of the turns | survey, 2026-10-08 | 02 |
| The fold copies contributions; trigger types, tool definitions, session-config schemas and `optionsSchema` are copies the host holds | survey, 2026-10-08 | 03 |
| A registration after `apply` returns is refused, as `on` and `registerAgent` already do nothing | survey, 2026-10-08 | 03 |
| `fired` checks the type belongs to the plugin that fires it | survey, 2026-10-08 | 03 |
| Each listener gets its own frozen event; each plugin gets its own frozen `paths`; `apply` options are copied whole | survey, 2026-10-08 | 04 |
| `foldHostOptions` keeps the base's getters, so a root-config edit to `mcpServers` reaches the next session | survey, 2026-10-08, found on the way | 05 |
| `docs/PLUGINS.md` says every value a plugin gets is read-only | (defaulted: plugin authors read that file) | 06 |

## Proposed architecture

- **Data flow** - one sdk helper, `frozenCopy(value)`, copies plain data with `structuredClone` and freezes it deep. An object with methods, such as a store or a principal, is built new and frozen with `Object.freeze`.
- **State flow** - the host keeps its own record of what it writes later, such as a trigger's `deliver`. It does not write onto the plugin's object.
- **Layer responsibilities** - sdk: the helper, principals, `Start`, tool context, the fold, `raise` · server: `ROOT`, the plugin context, `apply` options, `optionsSchema`.
- **Source-of-truth files** - [`code://packages/sdk/src/plugins.ts`](../../../../packages/sdk/src/plugins.ts), [`code://packages/sdk/src/host/spawn.ts`](../../../../packages/sdk/src/host/spawn.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - a principal cannot be changed](task-01-a-principal-cannot-be-changed.md) | todo | - |
| [02 - an agent's start holds copies](task-02-an-agents-start-holds-copies.md) | todo | 01 |
| [03 - the host holds copies of contributions](task-03-the-host-holds-copies-of-contributions.md) | todo | 01 |
| [04 - events, paths and options are per plugin copies](task-04-events-paths-and-options-are-per-plugin-copies.md) | todo | 01 |
| [05 - the fold keeps the base's getters](task-05-the-fold-keeps-the-bases-getters.md) | todo | - |
| [06 - docs](task-06-docs.md) | todo | 02, 03, 04 |

## Risks and tradeoffs

- A plugin that writes to a value it was given now throws. In-repo plugins and agents are checked by the full suite; a write the suite finds is fixed in that plugin, not by unfreezing.
- `structuredClone` of tool context turns costs a copy per call - the call is rare, a tool asking for history.
- A plugin is still trusted code: it can import `fs` or patch modules. Running plugins out of process is the real boundary and is not this plan.
- `say()` lets any plugin add a Host name every route accepts. That is a feature to weigh, not a write to host state, and stays out of this plan.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-a-principal-cannot-be-changed.md](task-01-a-principal-cannot-be-changed.md).
- **Open questions:** none.
- **Watch out for:** plugin/37 changes `resourcemethods.ts` and `plugins.ts`. Rebase on it before task 01, and freeze the principal that `write` gets too.

## Final verification checklist

- [ ] Every crossing in the refs has a test that writes to the value and checks the host is unchanged.
- [ ] `rg "connection.principal" packages/sdk/src` shows no site that hands an unfrozen principal out.
- [ ] `node tools/schema.mjs`, `pnpm build`, `pnpm typecheck`, `pnpm boundary`, `npx vitest run` pass.
- [ ] `plans/index.md` updated.
