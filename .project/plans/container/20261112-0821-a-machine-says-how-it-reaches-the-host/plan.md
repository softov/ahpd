---
title: A machine says how it reaches the host
domain: container
status: planned
priority: medium
created: 2026-11-12
revalidated: 2026-11-12
requires: []
changes:
  - specs/host-tools.md
creates: []
refs:
  - git://b4ad32951 - the commit of ahpd this plan was checked at
  - "[code://packages/agent-acp/src/session/opening.ts#L80-L102](../../../../packages/agent-acp/src/session/opening.ts#L80-L102) - `toolsReachable`, a guess the comment says a port's answer can replace"
  - "[code://packages/agent-acp/src/session/opening.ts#L169-L172](../../../../packages/agent-acp/src/session/opening.ts#L169-L172) - `serversFor` leaves host tools out with `cannot reach the daemon`"
  - "[code://packages/server/src/commands/run.ts#L701-L702](../../../../packages/server/src/commands/run.ts#L701-L702) - the tools endpoint's origin is the bound address as it is"
  - "[code://packages/sdk/src/types/computers.ts#L293](../../../../packages/sdk/src/types/computers.ts#L293) - the port, where the new verb goes beside `how`"
  - "[code://packages/agent-acp/test/agent-acp-catalog.test.ts#L487-L522](../../../../packages/agent-acp/test/agent-acp-catalog.test.ts#L487-L522) - the reachability cases to change"
  - "[code://docs/plugins/PLUGINS.md#L2506-L2510](../../../../docs/plugins/PLUGINS.md#L2506-L2510) - the documented 'for now' rule"
  - https://docs.docker.com/desktop/features/networking/#connect-a-container-to-a-service-on-the-host - `host.docker.internal` reaches the host on Docker Desktop
---

## Goal

A session in a machine gets the host tools whenever the machine can reach the daemon.
Today a daemon on 127.0.0.1 is judged out of reach, and on Docker Desktop that is wrong: `host.docker.internal` reaches the host's loopback.
So machine sessions on Windows and macOS never get host tools.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "host.docker.internal|host-gateway|add-host" packages` - only a test URL; nothing maps an address.
- `docker info --format "{{.OperatingSystem}}"` on the Windows VM answers `Docker Desktop`.
- The rule came from [container/05-p2 task 05](../05-p2-an-acp-agent-says-what-its-machine-needs/task-05-host-tools-where-the-daemon-is-reachable.md), which called it "for now".

### Runtime path

```
serversFor -> own() endpoint http://127.0.0.1:<port> -> toolsReachable(url, machine) false -> left out
```

### Gaps

- The port has no verb that answers how a machine reaches a host address.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The port answers the URL a machine uses for a host endpoint, and `serversFor` uses that answer | Softov, 2026-11-12: "Machine says its address" | 01 |
| The docker runtime maps loopback and wildcard hosts to `host.docker.internal` on Docker Desktop | Softov, 2026-11-12: "Machine says its address" | 02 |
| On other Docker, a wildcard bind maps to `host.docker.internal` with `--add-host host.docker.internal:host-gateway`, and loopback has no answer | Softov, 2026-11-12: "Machine says its address" | 02 |
| Docker Desktop is told by `docker info` naming `Docker Desktop` as its operating system | `(defaulted: what the VM's Docker answered)` | 02 |
| A port with no answer keeps today's guess | [code://packages/agent-acp/src/session/opening.ts#L87-L90](../../../../packages/agent-acp/src/session/opening.ts#L87-L90) | 01 |

## Proposed architecture

- **Data flow** - `serversFor` asks `computers.reach(id, url)`; an answer replaces the URL, no answer falls back to `toolsReachable`.
- **Layer responsibilities** - sdk: the verb · agent-acp: its use · computer: the docker answer.
- **Source-of-truth files** - [`code://packages/sdk/src/types/computers.ts`](../../../../packages/sdk/src/types/computers.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The port answers a host URL](task-01-the-port-answers-a-host-url.md) | todo | - |
| [02 - Docker maps the host address](task-02-docker-maps-the-host-address.md) | todo | 01 |

## Risks and tradeoffs

- A machine on another box cannot reach this host's loopback - the remote and ssh runtimes give no answer, and the tools stay out.
- A daemon on a wildcard bind on Linux is then reachable from its machines - that is the point of a wildcard bind.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-the-port-answers-a-host-url.md](task-01-the-port-answers-a-host-url.md).
- **Open questions:** none.
- **Watch out for:** `--add-host` goes at `docker run`, so a machine made before the change has no `host.docker.internal` on Linux.

## Final verification checklist

- [ ] On Docker Desktop, a machine session with the daemon on 127.0.0.1 gets the host tools, and a tool call reaches the daemon.
- [ ] On Linux Docker, a daemon on 127.0.0.1 still leaves them out with the same line.
- [ ] `specs/host-tools.md` and `docs/plugins/PLUGINS.md` say the new rule.
