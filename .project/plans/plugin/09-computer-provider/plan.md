---
title: A computer: provider that makes machines
domain: plugin
status: built
priority: medium
created: 2026-09-22
revalidated: 2026-09-22
requires:
  - plans/plugin/08-resource-providers/plan.md
changes: []
creates: []
decisions:
  - decisions/one-computer-provider-with-runtimes-as-options.md
  - decisions/a-machine-is-made-by-a-host-tool.md
refs:
  - code://.project/plans/plugin/08-resource-providers/report.md - the review that found nothing connecting the scheme, the fixture and a running container
  - code://.project/research/host-owned-uri-resources.md - `computer://<id>/status`, `capabilities` and `request_disposable_computer`
  - code://packages/sdk/src/types/resources.ts#L186-L211 - `ResourceProvider`, which this package implements
  - code://packages/sdk/src/types/host.ts#L232-L254 - `HostTool`, `ToolCall` and `effects`
  - code://packages/agent-acp/src/plugin.ts - the package and plugin entry this one mirrors
  - code://packages/agent-acp/package.json - the manifest shape, `ahpd.entry` and the options table
  - code://scripts/boundary.mjs - the check a package with a peer dependency has to pass
  - code://scripts/computer.mjs - the operator's half, whose Docker verbs the runtime performs
  - code://docs/COMPUTER.md - what a person does once so an account may reach Docker and KVM
  - code://.github/workflows/release.yml - the five-wide loops that gain a sixth package
---

## Goal

`@ahpd/computer` is a plugin a daemon loads by name: it serves the `computer:` scheme read-only from a runtime, and offers three host tools so a session's model can make a machine, run something in it and throw it away.
Docker is the runtime that ships with it, chosen by an option, and the `capabilities` resource says which runtimes this host can be asked for.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "registerResourceProvider" packages/ docs/` - the scheme is served by one provider per host, so this package owns `computer:` and a second runtime cannot be a second package.
- `rg -n "HostTool|effects" packages/sdk/src/host.ts packages/sdk/src/sessiontools.ts` - the tool shape and the `effects` a policy reads, which the three tools declare.
- `rg -n "packages/agent" pnpm-workspace.yaml .github/workflows/*.yml tsconfig.json` - a new package joins the workspace, the release loops and the typecheck include without a change to any of them, and `scripts/boundary.mjs` finds it by reading `packages/`.
- `rg -n "0\\.6\\.3" packages/*/package.json .github/workflows/release.yml` - the five carry the published version and the workflow names each by hand in four places.

### Runtime path

```
ahpd --plugin @ahpd/computer -> apply(host, options)
  -> host.registerResourceProvider('computer', provider)   read-only: list, resolve, read
  -> host.registerTool(request_disposable_computer | release_computer | computer_exec)
a session's model calls request_disposable_computer({ image, cpus, memory })
  -> the runtime runs `docker run -d --label ahpd.computer=1 ... sleep infinity`
  -> the tool answers with computer://<id>, which the provider then reports
a client reads computer://<id>/status
  -> the provider asks the runtime (`docker inspect`) and answers JSON
```

### Gaps

- Nothing connects the scheme, the fixture and a container: `plugin/08` built the first two and `scripts/computer.mjs` the third, and no record names the three together.
- `Not found: a package that owns a URI scheme - searched "registerResourceProvider" through packages/; only the SDK, the docs and the fixture mention it.`
- `Not found: any test that drives a plugin through a command it spawns and a recorded call list - searched "spawn" through test/; the ACP tests spawn a fixture server and are the pattern to copy.`
- The release set is five names written by hand in the workflow, so a sixth package is a workflow change and not only a manifest.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [One computer: provider, one package, the runtime chosen by option](../../../decisions/one-computer-provider-with-runtimes-as-options.md) | The user, 2026-09-22: "I want 1 also as option", after the duplicate-scheme rule made two packages impossible. |
| 2 | [A machine is made by a host tool, not by a resource write](../../../decisions/a-machine-is-made-by-a-host-tool.md) | The user, 2026-09-22: asked how a machine would be set up if the provider only reported them. |

| What | Source | Task |
| --- | --- | --- |
| The package is named `@ahpd/computer`, one per scheme, with `runtime` as an option | decision 1 | 01 |
| `computer://<id>/status`, `capabilities` and a root listing are the resources | `code://.project/research/host-owned-uri-resources.md` | 01 |
| The runtime is reached by spawning the command, so a test drives a fixture | `code://scripts/computer.mjs` | 01 |
| A machine is created, released and run in through tools | decision 2 | 02 |
| The tools declare `effects`, so a backend with a policy can ask before one runs | `code://packages/sdk/src/host.ts#L237-L245` | 02 |
| The provider's own guards are a maximum number of machines and the limits it was configured with | (defaulted: nothing else stands between a tool call and the machine) | 02, 03 |

## Proposed architecture

- **Data flow** - the plugin builds one runtime from its options, hands it to a provider and to the tools, and registers both. Nothing else in the host knows what a container is.
- **Event flow** - unchanged; the host fires the tool and resource events it already does, and this package contributes none.
- **State flow** - none of its own. Machines live in the runtime, and the provider reads them when asked, so a host restart loses nothing but the option values.
- **Layer responsibilities** - packages/computer: the runtime adapter, the provider, the tools and the plugin entry · test/: a fake runtime for the units and a scripted `docker` for the end-to-end · docs: `PLUGINS.md` and `COMPUTER.md` · the workflow: a sixth package in four loops.
- **Source-of-truth files** - `code://packages/computer/src/`, `code://.github/workflows/release.yml`.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The package, the runtime and the provider](task-01-the-package-runtime-and-provider.md) | done | - |
| [02 - The three tools](task-02-the-three-tools.md) | done | 01 |
| [03 - The tests, the docs and the release set](task-03-tests-docs-and-release.md) | done | 02 |

## Risks and tradeoffs

- The provider spawns a command per call, so a slow Docker daemon makes a listing slow; the alternative was a socket client, and the script already pays this price.
- A tool call can start a container on the host the daemon runs on. The guards are the connection token, the configured limits and a maximum count; a real policy is the master's, which does not exist.
- The package is a sixth name in the release set, and a name that has never been published cannot be staged by OIDC: its first version needs the token bootstrap the two agents needed.
- A container is not a sandbox. It is separate from the host's files and shares its network, and the docs say so.

## Resume state

- **Done so far:** all three tasks, 2026-09-22. `@ahpd/computer` builds, loads as a plugin, serves `computer:` read-only from Docker and registers three tools; the suite is 67 files / 872 tests and the daemon path was checked by hand against a real container. See [implemented.md](implemented.md).
- **Next action:** none; the plan is built. What waits is a `kvm` runtime and the master that would authorize a machine, both named below.
- **Open questions:**
  1. Should `computer_exec` be offered at all, when a client may already open a terminal on the host? - answered: yes. It is narrower than what the host already grants through the `terminals` port, and an agent cannot use a client's terminal.
  2. Does the provider need a `watch`? - answered: no. A machine's record changes when the runtime says so, and nothing in the runtime pushes an event, so a watch would be a poll wearing a channel.
- **Watch out for:** the version. Six packages now carry `0.6.3`, and `@ahpd/computer` has never been published, so its first publish needs the token bootstrap the two agents needed before OIDC can stage it.

## Final verification checklist

- [x] `pnpm test` green: 67 files, 872 tests, the eight new cases included.
- [x] `pnpm typecheck`, `pnpm boundary` and `pnpm build` green; `pnpm install --frozen-lockfile` passes with the new importer.
- [x] By hand: `node packages/server/dist/main.js --plugin ./packages/computer` listed a real container the script made, read `computer://<id>/status` from `docker inspect`, answered `capabilities`, and refused a write `-32601`.
- [x] `plans/index.md` and [00-plugin.md](../00-plugin.md) updated.
