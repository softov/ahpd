---
title: A client can tell what a scheme does before it asks one
domain: plugin
status: built
priority: high
created: 2026-09-23
revalidated: 2026-09-23
requires:
  - plans/plugin/08-resource-providers/plan.md
  - plans/plugin/10-a-computer-a-person-manages/plan.md
changes: []
creates: []
decisions:
  - decisions/a-resource-scheme-is-advertised-in-meta.md
  - decisions/a-scheme-nobody-serves-is-not-a-permission-error.md
refs:
  - "[code://packages/sdk/src/types/resources.ts#L204-L211](../../../../packages/sdk/src/types/resources.ts#L204-L211) - `ResourceProvider`, which gains `describe`"
  - "[code://packages/sdk/src/types/host.ts](../../../../packages/sdk/src/types/host.ts) - `HostOptions.resourceProviders`, the map the advertisement is built from"
  - "[code://packages/sdk/src/host.ts#L4604-L4608](../../../../packages/sdk/src/host.ts#L4604-L4608) - `storeFor`, the routing step the refusal moves into"
  - "[code://packages/sdk/src/host.ts#L4779](../../../../packages/sdk/src/host.ts#L4779) - `initialize`, where `automations` is advertised by presence and `_meta` is built"
  - "[code://packages/sdk/src/validate.ts](../../../../packages/sdk/src/validate.ts) - `checkResourceProvider`, which must allow a method it does not demand"
  - "[code://packages/computer/src/manifest.ts](../../../../packages/computer/src/manifest.ts) - the manifest the provider would describe"
  - "[code://packages/computer/src/provider.ts](../../../../packages/computer/src/provider.ts) - the worked example's answer"
  - "[code://test/uri-resources.test.ts#L84-L93](../../../../test/uri-resources.test.ts#L84-L93) - the case that changes"
  - "[code://.project/research/how-a-host-advertises-a-resource-scheme.md](../../../research/how-a-host-advertises-a-resource-scheme.md) - the reading behind this"
---

## Goal

A client can learn from the handshake that this host serves `computer:`, what it can do with it, and what a create body may contain, without asking a URI under the scheme and reading an error. A scheme nobody serves answers a code that says so, so the probe is a branch and not a string match.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "resourceProviders" packages/sdk/src packages/server/src` - the map exists on `HostOptions`, is registered by `registerResourceProvider`, and is read only by `storeFor`; nothing publishes it.
- `rg -n "_meta" packages/sdk/src/host.ts` - `_meta` is built once, in the `initialize` result, with the `vscode.*` flags; the root state carries none, so this adds one to each from one function.
- `rg -n "nothing here serves" packages test` - one sentence in the file store and one test asserting `-32009` for it, which is the whole of the behaviour to change.
- `rg -n "capabilities" packages/computer/src/provider.ts` - the provider already answers the manifest fields as prose, per machine, so a schema exists to lift out and the two must not drift.
- `rg -n "describe\\(" packages/sdk/src packages/computer/src` - no method of that name, so nothing collides with the addition.

### Gaps

- Nothing advertises a scheme, so a client discovers one by failing.
- The create body is only readable from a machine that already exists, which is the one thing a client wants before making the first one.
- A scheme nobody serves answers `-32009`, the same code as a person being refused, so a probe cannot be a branch on the code.
- `ResourceProvider` has no way for a provider to say what it is for, and the host may not hardcode `computer` for the same reason it may not know what a container is.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [A resource scheme is advertised in `_meta`, and a client reads it there](../../../decisions/a-resource-scheme-is-advertised-in-meta.md) | The user, 2026-09-23: "I liked the _meta suggestion... if its the only way", after the reading showed no typed host field exists and adding one is an upstream change. |
| 2 | [A scheme nobody serves is not a permission error](../../../decisions/a-scheme-nobody-serves-is-not-a-permission-error.md) | The user, 2026-09-23: "-32009 is a permission gate? If does not exists its not -32008?", which is the question this answers. |

| What | Source | Task |
| --- | --- | --- |
| The key is `ahpd.resourceProviders`, advertised on `initialize._meta` and `RootState._meta` from one function | decision 1 | 02 |
| `operations` is derived by the host, never claimed by the provider | decision 1 | 02 |
| A provider describes itself through an optional `describe()` | decision 1 | 01 |
| A scheme nobody serves answers `-32601`, with the sentence kept | decision 2 | 03 |
| The typed `InitializeResult` field supersedes this when it exists | decision 1 | - |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A provider says what its scheme is for](task-01-a-provider-says-what-its-scheme-is-for.md) | done | - |
| [02 - The host advertises them on the handshake](task-02-the-host-advertises-them.md) | done | 01 |
| [03 - A scheme nobody serves is not a permission error](task-03-not-a-permission-error.md) | done | - |
| [04 - The pages a provider author and a client read](task-04-the-pages.md) | done | 01, 02, 03 |

## Risks and tradeoffs

- The advertisement is a claim by the provider, so a client may draw a form from a manifest the provider then refuses.
  The mitigation is that the manifest is the same schema the provider validates against, and a refusal still comes back as a sentence the client shows.
- `_meta` is implementation-defined, so a client that does not know the key learns nothing.
  The mitigation is that the protocol says clients must ignore unknown keys, the key is `ahpd.`-prefixed, and the fallback for an old client is the same probe it would have used anyway.
- Changing the code for an unserved scheme touches a message one test pins.
  The mitigation is that the sentence is unchanged and only the code moves, which is what the task asserts.
- `RootState._meta` is re-sent on every snapshot, so a large advertisement would be repeated.
  The mitigation is that a description is small - a title, a line and a schema - and the map is keyed by scheme rather than repeated per machine.

## Resume state

- **Done so far:** every task, 2026-09-23. See [implemented.md](implemented.md). The plan is written and the two decisions are locked in.
- **Next action:** none; the plan is built. Was: [task-01-a-provider-says-what-its-scheme-is-for.md](task-01-a-provider-says-what-its-scheme-is-for.md).
- **Open questions:**
  1. Is the advertisement on `initialize._meta`, root `_meta`, or both? - answered by decision 1: both, from one function.
  2. Does the provider's manifest schema change when a runtime option changes? - answered by task 01: the provider builds it from its options, so the defaults it names are its own.
  3. Is `-32601` or `-32008` the right answer for a scheme nobody serves? - answered by decision 2: `-32601`, to match a provider that lacks a method.
- **Watch out for:** the `vscode.*` flags already in `initialize._meta`; the advertisement merges beside them rather than replacing them. `checkResourceProvider` must be told `describe` is allowed, because it currently checks the members it knows and would otherwise be the boundary that refuses a method it does not demand.

## Final verification checklist

- [x] `pnpm test`, `pnpm typecheck` and `pnpm boundary` green.
- [x] With the computer plugin loaded, `initialize._meta['ahpd.resourceProviders'].computer` names the title, `computer://`, the five operations and the manifest schema; the root state carries the same map.
- [x] With a host that has no computer plugin, the map is absent and `resourceList` on `computer://` answers `-32601` with the sentence naming the scheme.
- [x] A provider that implements no `write` advertises no `write` operation.
- [x] `test/uri-resources.test.ts` asserts `-32601` for an unregistered scheme with the same message.
- [x] `plans/index.md`, `docs/PLUGINS.md`, `docs/COMPUTER.md`, `packages/sdk/README.md` and `working/HANDOFF.md` updated.
