---
title: A host joins another, which lists it as a computer and relays its sessions
domain: container
status: built
priority: medium
created: 2026-09-26
revalidated: 2026-10-30
requires:
  - plans/container/05-p9-an-ssh-machine-runs-a-nested-host/plan.md
  - plans/daemon/13-ahpd-restart/plan.md
changes: []
creates: []
decisions:
  - decisions/a-nested-host-speaks-stdio.md
refs:
  - "[code://packages/sdk/src/sessions/nested.ts#L112](../../../../packages/sdk/src/sessions/nested.ts#L112) - `NestedHost`: stdin, stdout, stderr, `on` and `kill`, all a socket needs to stand in for a process"
  - "[code://packages/sdk/src/sessions/nested.ts#L156](../../../../packages/sdk/src/sessions/nested.ts#L156) - `NestedOptions.start`, which returns a `NestedHost` instead of spawning"
  - "[code://packages/sdk/src/sessions/nested.ts#L173-L179](../../../../packages/sdk/src/sessions/nested.ts#L173-L179) - `nestedAgent`, which takes those options"
  - "[code://packages/sdk/src/sessions/nested.ts#L192-L215](../../../../packages/sdk/src/sessions/nested.ts#L192-L215) - `startInside`, the default `start` that spawns the port's descriptor"
  - "[code://packages/sdk/src/sessions/nested.ts#L279-L345](../../../../packages/sdk/src/sessions/nested.ts#L279-L345) - `stdioTransport`, one frame per line over a `NestedHost`"
  - "[code://packages/sdk/src/sessions/nested.ts#L846-L991](../../../../packages/sdk/src/sessions/nested.ts#L846-L991) - `bringUp`: the outer host is an `AhpClient` over that transport, then `createSession` and two subscriptions"
  - "[code://packages/sdk/src/host/spawn.ts#L796-L798](../../../../packages/sdk/src/host/spawn.ts#L796-L798) - where the host builds `nestedAgent` for a session"
  - "[code://packages/sdk/src/listen.ts#L97-L139](../../../../packages/sdk/src/listen.ts#L97-L139) - the door: the deployment token, then `identify` against the users directory"
  - "[code://packages/server/src/commands/run.ts#L1678-L1689](../../../../packages/server/src/commands/run.ts#L1678-L1689) - a stdio connection is admitted as the host itself"
  - "[code://packages/sdk/src/access/users.ts#L56-L79](../../../../packages/sdk/src/access/users.ts#L56-L79) - `SUBJECTS`, the grant subjects"
  - "[code://packages/sdk/src/plugins/plugins.ts#L292-L295](../../../../packages/sdk/src/plugins/plugins.ts#L292-L295) - one `computers` port per host, so nodes are listed by `@ahpd/computer`"
---

## Goal

`ahpd join <url> --token <t>` on a box behind NAT dials another ahpd, which lists it as `computer://<node>` and runs sessions on it through the nested proxy, over sockets the node opened.
No port is opened on the node, each node has its own token, and removing the node drops it.
A restart of either side leaves the node's sessions to resume.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg "join" packages/server/src/commands` - no `join` command.
- `rg "start\?:" packages/sdk/src/sessions/nested.ts` - the proxy already takes a `start` that returns streams instead of a process, which is what a socket is.
- `rg "SUBJECTS" packages/sdk/src/access/users.ts` - no subject names a node.

### Runtime path

```
node: ahpd join <hub> --token <t> -> control socket to the hub (reconnects)
hub: lists computer://<node> -> session there -> nestedAgent(start = node socket)
  -> control: open { id, plugins, env } -> node dials a data socket for it
  -> node spawns `ahpd --stdio --plugin <each>` in its own workdir and pipes the data socket to it
  -> hub: AhpClient over the data socket as a NestedHost -> the node's ahpd runs the agent
```

### Gaps

- A host can only reach a host it starts.
- The computers port answers a command to spawn, never a stream.
- No grant subject names a node, and no token is a node's.

## Decisions locked in

| Decision | Task |
| --- | --- |
| Any ahpd can be the hub other hosts join | 01, 02 |
| [The nested host speaks AHP over stdio, so the relay is a pipe](../../../decisions/a-nested-host-speaks-stdio.md) | 02 |
| [A grant is a subject and a verb](../../../../docs/sdk/USERS.md) | 03 |
| [Users, teams, projects and roles are resource schemes, each with its own grant subject](../../../../docs/sdk/USERS.md) | 03 |
| [A nested session is resumed by resuming the inner transcript by id](../04-a-cofold-session-in-a-computer/plan.md) | 05 |
| [A nested host is used only for a backend that runs nested and for a machine on another host](../05-an-agent-in-a-machine/plan.md) | 04 |

| What | Source | Task |
| --- | --- | --- |
| The hub owns the session and relays it, as it does for a nested host | (defaulted: the outer host already owns every nested session) | 02 |
| The hub is an `AhpClient` to the node's host over a joined socket, through `NestedOptions.start`; the relay is not a raw pipe of a client's frames | the proxy at [`code://packages/sdk/src/sessions/nested.ts#L846-L991`](../../../../packages/sdk/src/sessions/nested.ts#L846-L991) already speaks AHP to the inner host | 02 |
| A node is listed by `@ahpd/computer`, beside every other runtime | one `computers` port per host | 04 |
| The node's sessions resume after a restart of either side, by the inner transcript id | [A nested session is resumed by resuming the inner transcript by id](../04-a-cofold-session-in-a-computer/plan.md); daemon/13 | 05 |
| A node's session uses the node's own harness and configuration; reaching models through the hub's proxy is a later option of p12 | Softov, 2026-10-18, "using the harness and configuration that are on the host first.. we see about proxy in another moment. since it can be like configurable" | 04 |
| A relayed session that waits sends a push through the hub, to the devices that created or opened it there | Softov, 2026-10-11, to "Push 01: which waiting sessions should send a notification to a phone?": "for now created or openned here... but do not forget the subhost relay" | 02 |
| A node is a `node:` resource scheme with `node:read` and `node:write`; `node:write` adds a node and mints its token, removes it and drops it; a node's token opens the join door and nothing else | Softov, 2026-10-03, asked "is a node a `node:` scheme, or rows under `computer:`?": "a `node:` scheme with node:read/node:write" | 03 |
| For now one control socket per node and one data socket per session, so each session's transport is the proxy's own and needs no multiplexing | Softov, 2026-10-03, asked "one socket per session, or one carrying every session?": "as proposed" | 01, 02 |
| For now each session is served by its own `ahpd --stdio` on the node, as over ssh, so the node needs no daemon running and the hub's frames do not reach its other clients; the spawn is one function in `join.ts` | Softov, 2026-10-03, asked "does the node serve each session from its own `ahpd --stdio`, or its daemon?": "as proposed" | 01 |
| For now a node's id is `node.<name>`, through p9 task 01's `spellMachineId` and `parseMachineId` | Softov, 2026-10-03, answered in p9: "put runtime.name" | 04 |
| For now a node is owned by the host and its up time is metered while it is connected, from the registry's connect and drop events, through p9 task 01's metering function, which takes reachability events of which a listing is one source | follows p9's answer for an ssh machine, Softov, 2026-10-03: "host-owned and metered" | 04 |
| A node is listed as `running` while connected | (defaulted: `isRunning` reads `running` or `Up ` with a trailing space) | 04 |
| A node starts each session in its own workdir; `node/open` carries no `cwd` | (defaulted: a hub path is not a path on the node, as p9 says for an ssh machine) | 01 |
| The node says its workdir in `node/hello`, and `connect` returns it as `NestedStarted.workingDirectory`, so the hub does not send its own folder | Softov, 2026-10-30, chose "Node says it on join"; p9's ssh machine at [`code://packages/computer/src/plugin.ts#L1370-L1376`](../../../../packages/computer/src/plugin.ts#L1370-L1376) | 01, 02 |
| The hub refuses a node whose ahpd is older than 0.14.1 on join, with a sentence that says to update it, because an older node names its sessions `<provider>:/<id>` and cannot resume by id | Softov, 2026-10-30, chose "Refuse it on join" | 01, 02 |
| The join path takes a node token alone, not the deployment token | (defaulted: a node token opens only that door, and asking for the deployment token too would hand every node the host's key) | 02, 03 |
| A daemon option `nodeRestart` picks what a session does when its node's `ahpd join` restarts: `end` (the default) ends it with a sentence and the next turn resumes it by id; `reconnect` reopens it in place through a new data socket | Softov, 2026-10-13, asked "when a node's `ahpd join` restarts, what happens to the session?": "configurable"; then "which is the default?": "Ends, resumes by id". The option's name and that it is the hub's (defaulted: the hub holds the session) | 05 |

## Proposed architecture

- **Data flow** - the node keeps one control socket to the hub; per session the hub sends `open`, the node dials one data socket for it and pipes it to a local `ahpd --stdio`; the hub wraps that socket as a `NestedHost` and the existing proxy does the rest.
- **The port** - `ComputerPort.connect?(id, asked: NestedStart): Promise<NestedHost | undefined>`, the stream form of `nested`; the host passes it to `nestedAgent` as `start`, falling back to `startInside`.
- **Layer responsibilities** - `@ahpd/sdk`: the join door on the listener, the node registry, `connect` on the port · `@ahpd/server`: `ahpd join`, the node commands · `@ahpd/computer`: a `node` runtime listing the registry.
- **Source-of-truth files** - `CREATE: packages/sdk/src/nodes.ts`, `CREATE: packages/server/src/commands/join.ts`.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - `ahpd join` dials the hub and keeps the connection](task-01-ahpd-join-dials-the-hub.md) | done | 03 |
| [02 - A joined socket is a nested host the proxy talks to](task-02-a-joined-socket-is-a-nested-host.md) | done | 01 |
| [03 - A node has a token, and nodes are a grant subject](task-03-a-node-has-a-token.md) | done | - |
| [04 - The hub lists a node as a computer](task-04-the-hub-lists-a-node.md) | done | 02 |
| [05 - A restart of the hub or the node leaves its sessions to resume](task-05-a-restart-leaves-node-sessions-to-resume.md) | done | 04 |
| [06 - Docs](task-06-docs.md) | done | 05 |

## Risks and tradeoffs

- The node's local `ahpd --stdio` admits the hub as itself, as any stdio host does - joining is the node's operator trusting the hub with that box, and the docs say so.
- A hub that is down leaves its nodes idle - they reconnect with backoff, and a node's own sessions are not ended by the hub going away until the data socket closes.
- One data socket per session is one more connection through any proxy in between - one socket carrying every session would need multiplexing, and stays possible behind the same `connect` port.

## Resume state

- **Done so far:** every task, 2026-10-30. task 03, a node's token is minted, shown once and kept as a hash beside the users file, and `node:read` and `node:write` gate `ahpd node list|add|rm`; task 01, `ahpd join` dials the hub, says its versions and workdir, and serves each session from an `ahpd --stdio` of its own; task 02, the hub admits a node's token at its join path, refuses an ahpd older than 0.14.1, and holds a session's data socket as the `NestedHost` the proxy reads; task 04, `@ahpd/computer` serves a `node` runtime that lists a connected node as `node.<name>`, starts a session in it through the registry's `connect`, and charges its up time to the host from the moments it joined and left; task 05, `nodeRestart` reaches the proxy and defaults to `end`, which shows the session failed with a sentence naming the node and reopens it on its next turn, `reconnect` reopens it through the node's next data socket, and `connect` waits ten seconds for a node that is dialling again; task 06, `docs/plugins/COMPUTERS.md` has a *Joined nodes* section with the worked example, and `docs/sdk/USERS.md` counts fifteen host subjects, which `users-host.test.ts` now asserts.
- **Next action:** none. The plan is built, and `implemented.md` says what exists.
- **Open questions:** none; the one asked before task 05 was answered 2026-10-13.
- **Watch out for:** container/04 tasks 11 and 15 and p9 task 05 change how a nested session closes and resumes; a profile that names a node to make machines on is not planned, see [deferred.md](deferred.md).

## Final verification checklist

- [ ] A node behind NAT joins, is listed, and a session on it answers a turn.
- [ ] Removing the node drops its connection and refuses its token.
- [ ] A connected node's up time is written as stretches charged to the host.
- [ ] `ahpd restart` on the hub, then the node reconnects, and the session continues its conversation.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm boundary` green.
- [ ] `docs/plugins/COMPUTERS.md`, `docs/server/REFERENCE.md` updated.
