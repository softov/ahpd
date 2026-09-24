---
title: A computer is an object a person manages, and a session runs in one
status: accepted
date: 2026-09-23
supersedes: decisions/a-machine-is-made-by-a-host-tool.md
refs:
  - "[code://packages/computer/src/tools.ts#L34-L132](../../packages/computer/src/tools.ts#L34-L132) - the three tools, which become the nested extra"
  - "[code://packages/computer/src/provider.ts#L27-L38](../../packages/computer/src/provider.ts#L27-L38) - the read-only provider, which gains a write and a remove"
  - "[code://packages/sdk/src/host.ts#L4604-L4608](../../packages/sdk/src/host.ts#L4604-L4608) - `storeFor`, which routes `computer://` to its provider"
  - "[code://packages/sdk/src/host.ts#L4626-L4660](../../packages/sdk/src/host.ts#L4626-L4660) - `capabilityFor`, which already answers `computer:read` and `computer:write`"
  - "[code://packages/sdk/src/types/resources.ts#L204-L211](../../packages/sdk/src/types/resources.ts#L204-L211) - `ResourceProvider`, whose `write` and `remove` a provider may implement"
  - "[code://packages/sdk/src/types/resources.ts#L69-L75](../../packages/sdk/src/types/resources.ts#L69-L75) - `createOnly` and `-32010`, the create-onto-a-name refusal"
  - "[code://packages/sdk/src/types/agent.ts#L96-L97](../../packages/sdk/src/types/agent.ts#L96-L97) - `Start.settings`, where a session key reaches the backend"
  - "[code://.project/research/host-owned-uri-resources.md](../../.project/research/host-owned-uri-resources.md) - the proposal that named the tool and said it is not the selector"
  - "[code://.project/research/a-computer-three-things.md](../../.project/research/a-computer-three-things.md) - the reading this decision settles"
---

## Context

`a-machine-is-made-by-a-host-tool` made creating, releasing and running in a machine three host tools, and recorded that as the user's choice.
The research it points at says something narrower: "A tool such as `request_disposable_computer` would be an agent-callable operation within a session, not the user's primary machine selector before a session exists."
The tool half was built and the selector half was not, so the only actor that can make a machine today is the model inside a session.

That is backwards for the thing a computer is for.
A model cannot create the machine it runs in: the session's machine has to exist before the harness starts, and a tool call happens after.
The user, 2026-09-23: "Agents are not suppose to create computers... The intent is to create a computer and run a agent inside it... restricted.. sandboxed.. private. On the same computer... or just fire/run/die a computer per session."
The user also chose the shape in the same pass: "A resource write seens to be the correct approach. We will be able to list computers and manage then that way."

## Decision

A computer is an object, and `computer://<id>` is its name whatever made it - which `one-computer-provider-with-runtimes-as-options` already settled.
A person lists it with `resourceList`, describes it with `resourceResolve` and `resourceRead`, creates it with `resourceWrite` to `computer://<name>` carrying a JSON manifest, and destroys it with `resourceDelete`.
The manifest names what the runtime needs - at least `runtime`, `image`, and the optional limits - and `createOnly` with `-32010` is the refusal for a name that is taken.
The provider gains a `write` and a `remove`, which `ResourceProvider` already allows and `a-scheme-provider-implements-less-than-a-resource-store` already anticipated; the read half is unchanged.

A session names the computer it runs in through a session config key the plugin contributes (decision `a-plugin-may-contribute-a-session-key`), and the value reaches the backend in `Start.settings`.
Running the session's agent inside it is the backend's half: this decision makes the machine exist and be named, and does not pretend the host can move a harness it does not spawn.

The three model tools stay as what the research said they were: an agent-callable nested machine, not the selector.
They declare `advancedPermission` and are withheld from every session unless the host permits advanced tools (decision `a-tool-says-when-it-needs-advanced-permission`).

## Consequences

The permission for the whole lifecycle already exists and needs no new vocabulary: `capabilityFor` derives `computer:read` from `resourceList`, `resourceRead` and `resourceResolve`, and `computer:write` from `resourceWrite` and `resourceDelete`, so a role that names `computer:write` may make and destroy machines and `file:write` confers none of it.
`scripts/computer.mjs` stops being the only way a person makes one, and stays as the operator's direct path to Docker.
The provider grows validation, because a write body is now an interface: a manifest that names no runtime, an image it cannot use, or a runtime this package does not have is a refusal with a sentence rather than a container that starts wrong.
A session created before a computer exists is still a session; the key is optional and absent means the backend's own place, which is what every session does today.
The three tools being withheld by default changes what a freshly configured computer plugin contributes: a lifecycle, and no tool a model can call. That is the secure default, and one host key permits them.

## Options

- **Keep creation as a tool only.** Rejected: it is the arrangement that produced the confusion, a model cannot make the machine it runs in, and the user cannot make one at all.
- **A host command such as `computerCreate` on a `computer:` channel.** Rejected: a new channel, a new method, a new subscription and a dispatch-gate entry, where the resource commands, their routing and their permission already exist.
- **A CLI verb that calls the runtime directly.** Rejected as the only route: the daemon and the CLI would each grow a path, and a remote client still could not make one.
- **No model tools at all.** Rejected: the user called them "a good thing to have" for a nested scratch machine, and the gate is what keeps them honest.
