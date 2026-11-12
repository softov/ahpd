---
title: An ACP agent's sessions are listed in their machines
domain: acp
status: planned
priority: medium
created: 2026-11-12
revalidated: 2026-11-12
requires: []
changes: []
creates: []
refs:
  - git://b4ad32951 - the commit of ahpd this plan was checked at
  - "[code://packages/sdk/src/host/catalogue.ts#L1266-L1273](../../../../packages/sdk/src/host/catalogue.ts#L1266-L1273) - the catalogue asks each agent's `list()` at every listing"
  - "[code://packages/agent-acp/src/catalog.ts#L556-L590](../../../../packages/agent-acp/src/catalog.ts#L556-L590) - `catalogueOf`, which always spawns the agent on the host, and its `session/list failed` line"
  - "[code://packages/agent-acp/src/catalog.ts#L405-L415](../../../../packages/agent-acp/src/catalog.ts#L405-L415) - `server`, a plain spawn of `command` and `args`"
  - "[code://packages/agent-acp/src/catalog.ts#L309-L363](../../../../packages/agent-acp/src/catalog.ts#L309-L363) - `forgetSession`, which already spawns in a machine through `computers.how`: the pattern to copy"
  - "[code://packages/sdk/src/host/lifecycle.ts#L667-L668](../../../../packages/sdk/src/host/lifecycle.ts#L667-L668) - `ranIn`, the machine a session ran in, from its config"
  - "[code://packages/agent-acp/src/catalog.ts#L452](../../../../packages/agent-acp/src/catalog.ts#L452) - `loadedSession`, the `session/load` replay, also on the host"
  - "[code://packages/agent-acp/src/catalog.ts#L609-L646](../../../../packages/agent-acp/src/catalog.ts#L609-L646) - `findListed` goes through `catalogueOf` too"
---

## Goal

An ACP agent whose sessions run in machines is listed from those machines.
Today the listing runs the agent's command on the host at every client connect.
For a command that exists only in the machine, such as `node /c/work/demo/acp-server.mjs`, each listing fails and logs a stack.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "server\(options" packages/agent-acp/src/catalog.ts` - `listingFor`, `loadedSession` and the host branch of `forgetSession` spawn on the host.
- `rg "machine\?: SessionMachine" packages/agent-acp/src` - only `forgetSession` takes a machine.

### Runtime path

```
listSessions -> catalogue -> agent.list() -> catalogueOf -> listingFor -> server() -> spawn on host -> session/list
```

### Gaps

- `catalogueOf`, `loadedSession` and `findListed` take no machine.
- The catalogue does not tell an agent where its sessions ran.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The listing runs in each machine where the agent has kept sessions, and on the host only for the sessions that ran there | Softov, 2026-11-12: "List inside its machines" | 01 |
| `loadedSession` and `findListed` use the machine the session ran in | `(defaulted: the same rule as the listing)` | 02 |
| Rows from each machine merge with the rows the host watched, as today | [code://packages/agent-acp/src/catalog.ts#L566](../../../../packages/agent-acp/src/catalog.ts#L566) | 01 |

## Proposed architecture

- **Data flow** - the catalogue gives `list()` the machines of the agent's kept sessions.
  `catalogueOf` spawns once per machine through `computers.how`.
  It spawns on the host only when a kept session ran there, or none is kept.
- **Layer responsibilities** - sdk: which machines · agent-acp: the spawn in each.
- **Source-of-truth files** - [`code://packages/agent-acp/src/catalog.ts`](../../../../packages/agent-acp/src/catalog.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The listing runs in its machines](task-01-the-listing-runs-in-its-machines.md) | todo | - |
| [02 - Load and find use the machine](task-02-load-and-find-use-the-machine.md) | todo | 01 |

## Risks and tradeoffs

- A machine that is not running cannot be asked - its sessions come from the watched rows only, as on a server with no listing.
- More machines mean more spawns per listing - the listing is cached as today.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-the-listing-runs-in-its-machines.md](task-01-the-listing-runs-in-its-machines.md).
- **Open questions:**
  1. An agent with no kept session still lists on the host, and fails once for a machine path.
     Proposed: after that failure, use the watched rows until the record changes.
- **Watch out for:** a disposable machine goes with its session, so its sessions are listed from the watched rows after that.

## Final verification checklist

- [ ] An agent whose kept sessions all ran in a machine spawns nothing on the host at a listing.
- [ ] An agent with host sessions lists as today.
- [ ] `pnpm typecheck` and the agent-acp and sdk suites pass.
