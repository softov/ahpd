---
title: A computer is an object a person manages
domain: plugin
status: built
priority: high
created: 2026-09-23
revalidated: 2026-09-23
requires:
  - plans/plugin/08-resource-providers/plan.md
  - plans/plugin/09-computer-provider/plan.md
changes: []
creates: []
decisions:
  - decisions/the-computer-is-an-object-a-person-manages.md
  - decisions/a-tool-says-when-it-needs-advanced-permission.md
  - decisions/a-plugin-may-contribute-a-session-key.md
refs:
  - "[code://packages/computer/src/provider.ts](../../../../packages/computer/src/provider.ts) - the read-only provider this gives a write half"
  - "[code://packages/computer/src/runtime.ts](../../../../packages/computer/src/runtime.ts) - `ComputerRuntime`, which already has `run`, `remove` and `run`'s limits"
  - "[code://packages/computer/src/plugin.ts](../../../../packages/computer/src/plugin.ts) - the options and the two registrations"
  - "[code://packages/sdk/src/host.ts#L4604-L4608](../../../../packages/sdk/src/host.ts#L4604-L4608) - `storeFor`, which already routes `computer://` to the provider"
  - "[code://packages/sdk/src/host.ts#L4626-L4660](../../../../packages/sdk/src/host.ts#L4626-L4660) - `capabilityFor`, which already answers `computer:write` for a `computer://` write"
  - "[code://packages/sdk/src/types/resources.ts#L204-L211](../../../../packages/sdk/src/types/resources.ts#L204-L211) - `ResourceProvider`, whose write half is optional"
  - "[code://packages/sdk/src/host.ts#L3576](../../../../packages/sdk/src/host.ts#L3576) - `contributing`, the set a session is offered, which the permission filters"
  - "[code://packages/server/src/main.ts](../../../../packages/server/src/main.ts) - the base options the daemon passes"
  - "[code://packages/server/src/config.ts](../../../../packages/server/src/config.ts) - the key this adds"
  - "[code://packages/sdk/src/types/agent.ts#L96-L97](../../../../packages/sdk/src/types/agent.ts#L96-L97) - `Start.settings`, where a session key lands"
  - "[code://.project/research/a-computer-three-things.md](../../../research/a-computer-three-things.md) - the reading and the four choices"
---

## Goal

A person can make a computer, list what exists, read one's status and capabilities, and destroy it, using the resource commands every client already has and the `computer:read`/`computer:write` grants the host already derives from the scheme. A session can name the computer it runs in through a key the computer plugin contributes, and the plugin's three model tools declare that they need advanced permission and are absent from a session until the host permits advanced tools.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "write|remove|mkdir" packages/computer/src` - the provider has none of them; `runtime.ts` already has `run`, `stop`, `remove` and `exec`, so the gap is the provider half and not the runtime.
- `rg -n "storeFor|capabilityFor|resourceWrite" packages/sdk/src/host.ts` - a `computer://` write already routes to the provider and already needs `computer:write`, so no routing or gating work is needed.
- `rg -n "createOnly|-32010" packages/sdk/src` - `resourceWrite` carries `createOnly` and the resources store answers `-32010` for one onto something already there.
- `rg -n "register(Agent|Resources|Terminals|Sessions|Diagnostics)" packages/sdk/src/types/plugin.ts` - the `register*` list, which has no session-config method; the last is `registerDiagnostics`.
- `rg -n "foldHostOptions|tools" packages/sdk/src/plugins.ts` - the base's tools and every contribution's become one array at `:159`, and nothing records which is which, so the daemon is the one that can tell them apart.
- `rg -n "hostTools\\(\\)" packages test` - the daemon passes it once (`main.ts`), and a few tests do; the reference set is twelve tools.

### Runtime path

```
a client  -> resourceWrite(computer://<name>, body)  -> handle {1}
  -> capabilityFor: computer:write                   -> handle {2}
  -> storeFor('computer://<name>')                   -> the provider {3}
  -> provider.write(uri, content)                    -> runtime.run(spec)  -> docker run -d
a session -> createSession({ computer: 'computer://<name>' })  -> schema has the key {4}
  -> settle/config                                   -> Start.settings.computer -> the backend {5}
```

### Gaps

- The provider implements `list`, `resolve` and `read` and nothing else; `write` and `remove` are absent, so a `computer://` write answers `-32601`.
- The create body has no schema and no validation anywhere: `runtime.run` takes `cpus` and `memory` and the provider does not offer them.
- No daemon key says whether a plugin's tools may be offered; loading the plugin is the whole decision.
- `PluginHost` has no session-config registration, and a session's schema is `Agent.schema()` alone.
- No session key names a computer, and nothing reads one.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [A computer is an object a person manages, and a session runs in one](../../../decisions/the-computer-is-an-object-a-person-manages.md) | The user, 2026-09-23: "The intent is to create a computer and run a agent inside it", and "A resource write seens to be the correct approach." |
| 2 | [A tool says when it needs advanced permission, and the host says whether it has it](../../../decisions/a-tool-says-when-it-needs-advanced-permission.md) | The user, 2026-09-23: "A plugin tool could enforce to be off unless defined.. something like, `advancedPermission: true` on the tool. some important tools.. not all.." |
| 3 | [A plugin may contribute a session config key](../../../decisions/a-plugin-may-contribute-a-session-key.md) | The user, 2026-09-23: "For plugin contribution its a good thing. So it will show on session before creating its that the idea?" |

| What | Source | Task |
| --- | --- | --- |
| The create body is a JSON manifest the provider validates | decision 1 | 01 |
| A create onto a name that exists is `-32010`, from `createOnly` | decision 1 | 01 |
| Destroy is `resourceDelete`, and an absent machine is `-32008` | decision 1 | 01 |
| A tool's own `advancedPermission` claim is honoured by the host, and the host's `advancedTools` permits it | decision 2 | 04 |
| The session key is `computer` and its value is a `computer://<id>` | decision 3 | 05, 06 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A machine is made by a resource write](task-01-a-machine-is-made-by-a-resource-write.md) | done | - |
| [02 - A machine is destroyed by a resource delete](task-02-a-machine-is-destroyed-by-a-resource-delete.md) | done | 01 |
| [03 - What a client reads says what can be asked](task-03-what-a-client-reads.md) | done | 01 |
| [04 - A tool that needs advanced permission waits for the host](task-04-a-tool-that-needs-advanced-permission.md) | done | - |
| [05 - A plugin contributes a session key](task-05-a-plugin-contributes-a-session-key.md) | done | - |
| [06 - The computer a session names](task-06-the-computer-a-session-names.md) | done | 05 |

## Risks and tradeoffs

- A resource write that starts a container stretches the word "write", and a client that writes files casually could start machines.
  The mitigation is that it needs `computer:write`, which no built-in role has, and the body is a documented manifest rather than bytes with a meaning.
- The provider now runs a program on the strength of a URI and a body, so a malformed manifest is a refusal with a sentence rather than a container that starts wrong.
  The mitigation is one validation step before `runtime.run`, with a test per field.
- Marking a tool withholds it from a host that does not permit advanced tools, which changes what the computer plugin offers until the key is set.
  The mitigation is that it is one key, it is said at startup, and the reference twelve are unmarked so nothing else moves.
- A session key contributed by a plugin is a new kind of contribution and a new collision to refuse.
  The mitigation is one check at the plugin boundary, the way a duplicate scheme is refused, and a test that a key a backend already declares is refused.
- The `computer` key does nothing until a backend reads it, which is plan `plugin/11`'s work.
  The mitigation is that its absence means the backend's own place, so a session without it is exactly what a session is today.

## Resume state

- **Done so far:** every task, 2026-09-23. See [implemented.md](implemented.md). The plan is written and the three decisions are locked in.
- **Next action:** none; the plan is built. Was: [task-01-a-machine-is-made-by-a-resource-write.md](task-01-a-machine-is-made-by-a-resource-write.md).
- **Open questions:**
  1. Does `resourceMkdir` on `computer://` also mean something? - proposed: no, `mkdir` stays absent, because the manifest is the create and a directory under a machine has no meaning.
  2. Is the host key named `advancedTools` or `allowAdvancedTools`? - proposed: `advancedTools`, matching the tool's own `advancedPermission` field, and the user may rename it.
  3. Does the computer plugin's own option keep the name `tools`? - proposed: yes, and it decides what the plugin registers, so a host that permits advanced tools can still load the lifecycle alone.
- **Watch out for:** `capabilityFor` derives the grant from the URI's scheme, so a write to `computer://` is gated as `computer:write` and not `file:write`; the provider must throw `RpcError`, which is what the read half already does. A plugin's tool that the daemon drops is still reported by `ahpd plugin list`, which is about what would load and not about what a session is offered.

## Final verification checklist

- [x] `pnpm test`, `pnpm typecheck` and `pnpm boundary` green.
- [x] `resourceWrite` to `computer://box` with a manifest makes a machine in a fixture runtime; a second write with `createOnly` is `-32010`; a manifest naming no image is a refusal; `resourceDelete` removes it and an absent one is `-32008`.
- [x] A `computer://` write needs `computer:write` and a role with `file:write` alone is refused `-32009`.
- [x] With `advancedTools` unset a session reports no computer tool and a call does not run; with it set the three are offered beside the reference twelve.
- [x] A plugin can contribute a session key, and a key a backend already declares is refused at the plugin boundary.
- [x] A session created with `computer` reads it back, and the backend sees it in `Start.settings`.
- [x] `plans/index.md`, `docs/COMPUTER.md`, `docs/USERS.md` and `working/HANDOFF.md` updated.
