---
title: A plugin serves a host-owned URI scheme
domain: plugin
status: built
priority: medium
created: 2026-09-23
revalidated: 2026-09-23
requires: []
changes: []
creates: []
decisions:
  - decisions/host-owned-schemes-are-provider-contributions.md
  - decisions/a-scheme-provider-implements-less-than-a-resource-store.md
refs:
  - code://.project/research/host-owned-uri-resources.md - the proposal this plan answers, and where the gap was written down
  - code://packages/sdk/src/types/plugin.ts#L83-L130 - `PluginHost`, the contribution surface the new method joins
  - code://packages/sdk/src/types/plugin.ts#L163-L187 - `Contribution`, which gains a bucket beside `ports`, `agents` and `tools`
  - code://packages/sdk/src/plugins.ts#L78-L156 - `foldHostOptions`, which folds a keyed registration and reports its conflicts
  - code://packages/sdk/src/plugins.ts#L176-L239 - `pluginHost`, where one `apply` records what it registered
  - code://packages/sdk/src/validate.ts#L148-L183 - `PORT_METHOD` and `checkPort`, the pattern the new checker follows
  - code://packages/sdk/src/types/host.ts#L132-L245 - `HostOptions`, where `resourceProviders` joins
  - code://packages/sdk/src/types/resources.ts#L125-L183 - `ResourceStore`, the file-shaped contract a provider does not have to satisfy
  - code://packages/sdk/src/resources.ts#L48-L58 - `why`, the sentence an unserved scheme already gets
  - code://packages/sdk/src/host.ts#L5024-L5041 - `resourceList` and `resourceRead`, the two handlers that name the store today
  - code://packages/sdk/src/host.ts#L5183-L5215 - `createResourceWatch`, which needs `watch`
  - code://packages/sdk/src/host.ts#L5225-L5290 - the write half, where an absent method is `-32601`
  - code://packages/sdk/src/host.ts#L5419 - `resourceResolve`
  - code://packages/sdk/src/host.ts#L4726-L4745 - the `@` completion, which stays on the file store
  - code://packages/sdk/src/host.ts#L7160-L7194 - the client relay, which runs before every handler
  - code://docs/PLUGINS.md - the worked examples and the options table the new kind joins
  - code://.project/plans/plugin/00-plugin.md#L28-L54 - the registration kinds, one method each, grouped by operation
---

## Goal

A plugin can serve one host-owned URI scheme - a `computer:` or anything else - beside the daemon's file store, and the host routes each resource command to whichever of them owns the URI.
Nothing that works today changes: `file:` keeps the same store, a client-published URI is still relayed to its client, and the `@` menu is still a file menu.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "options.resources" packages/sdk/src/host.ts` - one store is named by `resourceList`, `resourceRead`, `resourceResolve`, the five write methods, `createResourceWatch` and the `@` completion; there is no per-scheme routing anywhere.
- `rg -n "registerResources" packages/sdk/src packages/server/src` - the port is a singleton, and `replace` is the only way a plugin gets the key.
- `rg -n "computer://|disposable_computer" /github` - only the research names it. There is no consumer in `ahpapp`, `ahpc`, `cofold` or `ahpd`, which is why this plan ships a fixture provider rather than a `computer:` package.
- `rg -n "REVERSE|elsewhere" packages/sdk/src/host.ts` - the client relay runs at `:7191`, before the handler, so a registered scheme cannot shadow a URI a connected client publishes.
- Checked against the code and recorded as corrections below: the research's authorization section is stale after the write-gate change, and its routing list omits `resourceResolve`, the watch and the completion call.

### Runtime path

```
ahpd --plugin <pkg> -> loadPlugins -> apply(host) -> host.registerResourceProvider('computer', store)
  -> one Contribution with a schema-keyed bucket
  -> foldHostOptions -> HostOptions.resourceProviders = { computer: store }
  -> createHost -> a resource command parses the URI's scheme
       client-published authority -> relayed at :7191, before this
       changeset side of an edit  -> resourceRead asks it first, unchanged
       scheme 'file'              -> HostOptions.resources, unchanged
       a registered scheme        -> its provider, each method through need()
       anything else              -> the sentence `why` already writes
```

### Gaps

- One `ResourceStore` serves every URI, so a plugin that wants a scheme must take the key with `replace` and wrap the file store.
- No keyed registration kind exists: `PortKey` is the closed set of `set` keys and the appended kinds are `agents` and `tools`; a scheme is a name the plugin invents, which is the `register, open key` operation the domain reference describes but nothing has built.
- `ResourceStore` requires `list`, `read`, `resolve` and `complete`, so a provider with no directories and no paths cannot honestly implement it.
- The research's authorization requirement is stale: "the current blanket `file:` grant in `resourceRequest` must not silently grant `computer:` writes" described a gate that no longer exists. Since `0.6.3` the write half is served to any connection and nothing is granted, so a provider's absent write method is the refusal, which is simpler and not widenable by accident.
- `Not found: a test that loads a plugin contributing anything keyed by a name the plugin invents - searched "open key" and "registerConfig" through test/; the four operations built so far are append, set and listen.`

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [A host-owned URI scheme is a provider a plugin contributes](../../../decisions/host-owned-schemes-are-provider-contributions.md) | The user, 2026-09-23: asked which route the plan should take and answered "The provider mechanism". |
| 2 | [A scheme provider implements less than a resource store](../../../decisions/a-scheme-provider-implements-less-than-a-resource-store.md) | (defaulted: a `computer:` provider has no path completion to offer, and the research asks for a smaller contract rather than fake file semantics). |

| What | Source | Task |
| --- | --- | --- |
| A registered scheme is keyed, so two plugins can own two schemes and the operation is `register, open key` | decision 1 | 01 |
| `file` and anything on `ahp-` are reserved, and a duplicate scheme is refused where it is registered | decision 1 | 01 |
| A client-published URI still wins, because the relay runs before the handlers | `code://packages/sdk/src/host.ts#L7191` | 02 |
| `resourceRead` still asks the changeset source first, then the scheme | `code://packages/sdk/src/host.ts#L5027-L5036` | 02 |
| An absent provider method answers `-32601`, the same as an absent write on a read-only store | decision 2 | 02 |
| A `move` or `copy` whose two ends are different schemes is refused `-32602` | (defaulted: neither provider could carry it out, as with two clients) | 02 |
| The `@` completion stays on the file store | decision 2 | 02 |
| Discovery, a URI picker and a machine catalogue are not in this plan | the research names them as the master's problem | - |

## Proposed architecture

- **Data flow** - `HostOptions.resourceProviders` is a record keyed by scheme. A handler parses the URI's scheme once through one helper and gets a store back: `options.resources` for `file:`, the record for anything registered, and `undefined` otherwise, which answers the scheme sentence.
- **Event flow** - unchanged; `resource_write` and the rest fire as they do, and a provider's changes reach a client through the same watch channel `createResourceWatch` mints.
- **State flow** - nothing new is stored. The record lives in `HostOptions` for the host's life, and a plugin's registration is folded before `createHost` sees it.
- **Layer responsibilities** - packages/sdk: the contract, `HostOptions.resourceProviders`, the keyed fold, the checker and the routing · packages/server: nothing but the loader's existing per-kind checks, if they name kinds explicitly · test/: the fold, the validation, the routing and a fixture provider · docs: `docs/PLUGINS.md` and the kinds table in `00-plugin.md`.
- **Source-of-truth files** - `code://packages/sdk/src/types/resources.ts`, `code://packages/sdk/src/types/plugin.ts`, `code://packages/sdk/src/plugins.ts`, `code://packages/sdk/src/host.ts`.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A plugin contributes a provider for one scheme](task-01-a-plugin-contributes-a-provider.md) | done | - |
| [02 - The host routes a resource command by scheme](task-02-the-host-routes-by-scheme.md) | done | 01 |
| [03 - A read-only example, the docs and the kinds table](task-03-the-example-and-the-docs.md) | done | 02 |

## Risks and tradeoffs

- A plugin now chooses part of the host's routing surface, which is a larger grant than a port; the mitigation is that the scheme is checked at registration and the relay still runs first.
- The smaller provider contract moves absence checks into the host's handlers; a method left out of a provider and out of a handler's `need` would be a `TypeError` rather than `-32601`, so every routed call goes through `need`.
- Cross-scheme transfer is refused rather than implemented, so a client cannot move a file into a provider. That is deliberate and the same answer two clients already get.
- The example is a fixture, not a shipped package. A real `computer:` provider needs the master, which is a separate system, and the plan does not invent its contract.
- The research's own precondition still holds: no client browses `computer:` today, so nothing here is load-bearing until one does.

## Resume state

- **Done so far:** all three tasks, 2026-09-23. A plugin registers a scheme, the host routes every resource command by it, and a read-only `computer:` fixture is loaded through the real loader. See [implemented.md](implemented.md).
- **Next action:** none; the plan is built. Docker and KVM are named as the substrate a real provider would talk to, and that provider is its own plan.
- **Open questions:**
  1. Should a provider be allowed to claim a scheme a connected client is publishing right now? - answered: no check is made, because a registration cannot know what a future client will publish; the relay wins and the precedence is documented.
  2. Should the provider contract keep `resolve`? - answered: yes and optional, and the fixture implements it, so a client that browses asks what a URI is before it reads it.
- **Watch out for:** the `@` completion takes a *path*, not a URI, so it was left on the file store. A reader who expects it routed by scheme will look for a rename that is not there.

## Final verification checklist

- [x] `pnpm test` green: 65 files, 864 tests, with the fold, validation, routing and fixture cases.
- [x] `pnpm typecheck`, `pnpm boundary` and `pnpm build` green.
- [x] By hand: a scratch `.mjs` provider was loaded by the real daemon (`ahpd ... --plugin ./.tmp-scratch-computer.mjs`), a `computer://local/status` read and resolve reached it, `file:` still listed, a `computer:` write answered `-32601`, and an unregistered scheme answered the `nothing here serves notes:` sentence.
- [x] `plans/index.md` and [00-plugin.md](../00-plugin.md) updated.
