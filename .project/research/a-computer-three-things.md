---
title: A computer is a place a session runs, a resource a person manages, and a tool a model may ask for
date: 2026-09-23
refs:
  - "[code://packages/computer/src/tools.ts#L34-L132](../../packages/computer/src/tools.ts#L34-L132) - the three tools that exist, and what they do"
  - "[code://packages/computer/src/provider.ts#L34-L38](../../packages/computer/src/provider.ts#L34-L38) - `ComputerProvider`, which is read-only today"
  - "[code://packages/computer/src/plugin.ts#L72-L91](../../packages/computer/src/plugin.ts#L72-L91) - the provider and the tools registered from one set of options"
  - "[code://packages/sdk/src/host.ts#L4604-L4608](../../packages/sdk/src/host.ts#L4604-L4608) - `storeFor`, which routes any non-`file:` scheme to its provider"
  - "[code://packages/sdk/src/host.ts#L4626-L4660](../../packages/sdk/src/host.ts#L4626-L4660) - `capabilityFor`, where a non-`file:` URI answers `<scheme>:read` or `<scheme>:write`"
  - "[code://packages/sdk/src/types/resources.ts#L204-L211](../../packages/sdk/src/types/resources.ts#L204-L211) - `ResourceProvider`, whose `write` and `remove` a provider may implement"
  - "[code://packages/sdk/src/types/resources.ts#L69-L75](../../packages/sdk/src/types/resources.ts#L69-L75) - `createOnly`, and `-32010` for a create onto something already there"
  - "[code://packages/sdk/src/host.ts#L3884-L3904](../../packages/sdk/src/host.ts#L3884-L3904) - `ROOT_CONFIG_SCHEMA`, a fixed literal a plugin cannot add a key to"
  - "[code://packages/sdk/src/types/agent.ts#L151-L152](../../packages/sdk/src/types/agent.ts#L151-L152) - `Agent.schema()`, which is where a session's config schema comes from"
  - "[code://packages/sdk/src/types/plugin.ts#L101-L140](../../packages/sdk/src/types/plugin.ts#L101-L140) - every `register*` a plugin has, and the `registerSessionConfig` that is not there"
  - "[code://packages/sdk/src/types/agent.ts#L92-L141](../../packages/sdk/src/types/agent.ts#L92-L141) - `Start`, which carries a working directory, ports and tools, and no place to run"
  - "[code://.project/decisions/one-computer-provider-with-runtimes-as-options.md](../../.project/decisions/one-computer-provider-with-runtimes-as-options.md) - one provider per scheme, the runtime an option, `computer://<id>` whatever made it"
  - "[code://.project/decisions/a-machine-is-made-by-a-host-tool.md](../../.project/decisions/a-machine-is-made-by-a-host-tool.md) - the tool route this note questions"
  - "[code://.project/decisions/a-scheme-provider-implements-less-than-a-resource-store.md](../../.project/decisions/a-scheme-provider-implements-less-than-a-resource-store.md) - a provider implements only what it serves, and the write half is optional"
  - "[code://.project/research/host-owned-uri-resources.md](../../.project/research/host-owned-uri-resources.md) - the proposal that named the tool, and said what it is not"
  - "[code://.project/ideas/dev-container-sessions.md](../../.project/ideas/dev-container-sessions.md) - running a session inside a container, which the reference host does with a relay"
---

# A computer is three things

Written 2026-09-23 after the user's correction: "Agents are not suppose to create computers... The intent is to create a computer and run a agent inside it... restricted.. sandboxed.. private. On the same computer... or just fire/run/die a computer per session." The confusion is real and the records explain it, so this is the reading they should have been given.

## What the records already say, and where the fork was

`one-computer-provider-with-runtimes-as-options` settles the catalogue: one package, the runtime an option, and `computer://<id>` names a machine whatever made it. That part is not in question.

`a-machine-is-made-by-a-host-tool` settles creation as three host tools, and records the source as the user choosing the tool route. The research that decision points at says something narrower, in its own words at `host-owned-uri-resources.md`: "A tool such as `request_disposable_computer` would be an agent-callable operation within a session, **not the user's primary machine selector before a session exists**." That sentence is the fork. The tool half was built; the selector half was not, and the decision's title reads as though the two were the same thing.

## What exists in the code

| | |
| --- | --- |
| `computer://` provider | read-only: `list`, `resolve`, `read`. Root lists the machines, each with `status` and `capabilities` (`packages/computer/src/provider.ts`) |
| Model tools | `request_disposable_computer`, `release_computer`, `computer_exec` (`packages/computer/src/tools.ts`), registered from the same plugin options as the provider |
| A client command to make or destroy one | none |
| A session key naming a computer | none, and no seam to add one: a session's schema comes from `Agent.schema()`, and `PluginHost` has no `registerSessionConfig` |
| A root config key about tools | none, and `ROOT_CONFIG_SCHEMA` is a fixed literal a plugin cannot extend |
| Resource routing for a scheme | works: `storeFor` routes `computer://` to the provider, and `capabilityFor` answers `computer:read`/`computer:write` for it |
| Create semantics | `resourceWrite` already carries `createOnly`, and `-32010` is the refusal for a create onto something already there |

So the three things are:

1. **A place a session runs.** The machine the harness and its commands execute in. Nothing in the host or the plugin does this today. `Start` (`packages/sdk/src/types/agent.ts`) carries a working directory, the resource store, the terminal factory and the host tools, and no place to run. The reference host does it for Dev Containers with `devcontainer up`, a relay child process and a `vscode.devContainers` capability key, which is written up in `.project/ideas/dev-container-sessions.md`.
2. **An object a person manages.** A catalogue you can list, create, describe and destroy. The catalogue exists read-only; create and destroy do not, except through the model tools.
3. **A tool a model may ask for.** A nested machine for a task, which is what the three tools are. They only make sense once the model is running somewhere, and never as the way a session gets its own machine.

A model cannot create the machine it runs in: the tool call is made from inside a session, and the session's machine has to exist before the harness starts. That is the user's point, and it is why the tool route as the only route is wrong.

## Options for each

### 1. The lifecycle: how a person makes and destroys one

| Option | Pros | Cons |
| --- | --- | --- |
| **A resource write** (recommended). `resourceWrite` to `computer://<name>` with a JSON body (`image`, `cpus`, `memory`, `runtime`), `resourceDelete` to destroy | The routing, the gate and the client already exist: `storeFor` sends it to the provider, `capabilityFor` asks `computer:write`, every client can write a resource, and `createOnly` plus `-32010` gives "make me a new one, refuse if the name is taken" for free. The URI is the object, so list/create/describe/destroy are one vocabulary | A write that starts a container is a stretch of the word, so the body schema has to be documented and validated; a provider that validates nothing would accept any bytes |
| A host command (`computerCreate`/`computerDestroy`) on a `computer:` channel | Explicit and typed | A new channel, a new method, a new subscription, and the dispatch gate has to learn the channel. Nothing else in this host creates objects that way |
| Keep tools only, and add a CLI verb that calls the same functions | Smallest change to the plugin | The client and the daemon each grow their own path, and a remote client still cannot make one |

The user's own conclusion, "a resource write seems to be the correct approach", is the one the code supports.

### 2. The model tools: keep, gate, or remove

| Option | Pros | Cons |
| --- | --- | --- |
| **Keep, and let each tool say when it needs advanced permission** (recommended) | They are useful for a nested sandbox, the user says so ("its a good thing to have"), and only the tools that answer "more than a session's ordinary work" wait for the host's permission | Needs the claim and the permission to exist (below), and the tools still describe a machine, not the session's machine |
| Remove them | The feature is unambiguous: computers are a place, not a tool | Throws away working code and the one thing that lets a model ask for a scratch machine |
| Keep ungated | Nothing to build | Any model, in any session, can start containers on the host |

### 3. The permission a tool may need

| Option | Pros | Cons |
| --- | --- | --- |
| **The tool declares `advancedPermission` and the host permits advanced tools** (recommended, and what was chosen) | The claim is the tool's and the permission is the operator's, which is the split `effects` already has with a backend's policy; a harmless tool in the same plugin is unaffected; one key to permit them | `HostTool` gains a public field, and the computer's three change from offered to withheld until the key is set |
| A blanket switch over every plugin-contributed tool | One key, one place | It hides a harmless plugin tool along with a dangerous one, and it was written into the question rather than said by the user |
| The plugin's own option, `plugins: [{ name: "@ahpd/computer", options: { tools: false } }]` | Needs no SDK change: the plugin simply does not `registerTool` | It is per plugin, so every tool-contributing plugin repeats it, and the operator's answer about their own host has no home |
| A daemon list of permitted tool names | One advanced tool can be permitted without another | A second configuration language to document, and a boolean plus the plugin option covers the cases here |

### 4. How a session chooses a computer

Nothing can do this today, and the seam is the decision.

| Option | Pros | Cons |
| --- | --- | --- |
| **A plugin-contributed session key** (recommended), a `registerSessionConfig(key, schema)` on `PluginHost` | The key only exists when the plugin is loaded, which is exactly "if plugin is loaded"; a client draws it beside the model and effort controls, so it shows before the session is created; the plugin owns the key, not the core | One SDK seam to add, and the plugin cannot know how a backend honours it (below) |
| A host key in the session schema (`computer`) | No plugin seam, drawn for every session | The core learns what a container is, which is what the plugin boundary is for |
| The session's working directory is a `computer://<id>` URI | No new key; the existing workspace path carries it | A working directory is a host path today (`file://` is stripped, terminals check their `cwd`), so this changes what a workspace means, and it only moves files, not the process |
| A host-wide default computer in `ROOT_CONFIG_SCHEMA` | One key, no session seam | Every session runs in the same machine, which is not "fire/run/die per session" |

### 5. Running the agent inside it

This is per backend, and the honest answer is that the host cannot do it generically.

| Backend | What it would take |
| --- | --- |
| `@ahpd/agent-acp` | It spawns one command (`packages/agent-acp/src/connection.ts`), so pointing that command at the computer is a wrapper, which is the smallest real step |
| `@ahpd/agent-claude` | The Claude Agent SDK spawns the CLI itself, so this needs a spawn or executable seam in the backend, and the SDK's own tool execution (Bash, Read, Write) is what has to run inside the computer, not only the host's ports |
| `@ahpd/agent-cofold` | It runs in this process. Moving it into a computer means running the daemon there, or the Dev Container relay from `.project/ideas/dev-container-sessions.md` |

A `Start` field naming the computer (or an execution port) is the seam; each backend decides whether it can honour it, and one that cannot should refuse rather than run on the host and stay quiet.

### 6. The per-session gate on the tools, as a proposal

Once a session can name a computer, a `tools: false` on that session (or a session key that says "no machine tools here") is the per-session half. It depends on the seam in option 4 and on the permission in option 3, and it is a proposal rather than part of this step.

## The choices made

The user, 2026-09-23, chose one from each group above:

| # | Chosen | Decision |
| --- | --- | --- |
| 1 | A resource write creates and `resourceDelete` destroys | [`the-computer-is-an-object-a-person-manages`](../decisions/the-computer-is-an-object-a-person-manages.md), which supersedes `a-machine-is-made-by-a-host-tool` |
| 2 | The model tools stay, each marked `advancedPermission`, with one host key to permit advanced tools | [`a-tool-says-when-it-needs-advanced-permission`](../decisions/a-tool-says-when-it-needs-advanced-permission.md) |
| 3 | A plugin may contribute a session key | [`a-plugin-may-contribute-a-session-key`](../decisions/a-plugin-may-contribute-a-session-key.md) |
| 4 | This step includes a session running inside a computer | no decision needed: the fork was how a backend reaches one, which is [a-backend-reaches-a-computer-through-a-port](../decisions/a-backend-reaches-a-computer-through-a-port.md); the work is [plugin/10](../plans/plugin/10-a-computer-a-person-manages/plan.md) and [plugin/11](../plans/plugin/11-a-session-inside-a-computer/plan.md) |

So the shape is: a person makes a machine with a resource write, a session names one through a key the plugin contributes, the model tools each say they need advanced permission and wait for the host's key, and the ACP backend proves a session running inside a machine in the same pass.

## What this would change in the records

- `a-machine-is-made-by-a-host-tool` would be superseded: creation becomes a resource write a person makes, with the tools kept as an optional agent-facing extra.
- `one-computer-provider-with-runtimes-as-options` stands as it is.
- `a-scheme-provider-implements-less-than-a-resource-store` stands, and is the decision that allows the provider to grow a `write` and a `remove` half.
- The Dev Container idea is the existing home of "a session runs inside a machine"; a generic `computer:` substrate is the same shape with the runtime as an option.

## Later, and not part of this step

The user's other thought, importing cofold's command or config framework for the CLI, configuration and an HTTP API in front of ahpd, is a proposal for another time. My read: the useful part is the convention (verbs, an options schema, generated help), and the part to avoid is a dependency from the daemon to a coding-agent framework, which is what `plugin-contributes-host-options` deliberately declined when it refused a container. An HTTP surface in front of AHP is a client-side bridge rather than a core key, so it belongs in a package that speaks AHP outward, not in the host. Worth an ideas file when it is picked up, not now.
