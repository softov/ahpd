---
title: A joined socket is a nested host the proxy talks to
status: done
depends: [task-01-ahpd-join-dials-the-hub.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/sessions/nested.ts#L112](../../../../packages/sdk/src/sessions/nested.ts#L112) - `NestedHost`"
  - "[code://packages/sdk/src/sessions/nested.ts#L156](../../../../packages/sdk/src/sessions/nested.ts#L156) - `NestedOptions.start`"
  - "[code://packages/sdk/src/host/spawn.ts#L796-L798](../../../../packages/sdk/src/host/spawn.ts#L796-L798) - `nestedAgent(agent, { plugins, log })`, built only for an agent that runs nested or a machine off this host"
  - "[code://packages/sdk/src/listen.ts#L97-L139](../../../../packages/sdk/src/listen.ts#L97-L139) - the door"
---

## Objective

The hub's listener takes a node's control and data sockets at a join path.
The node registry answers `connect(node, asked)` with a `NestedStarted`.
It holds the data socket as a `NestedHost`, and the node's workdir from `node/hello`.
The host gives it to `nestedAgent` as `start`.

## Files

- `CREATE: packages/sdk/src/nodes.ts` - the registry: who is connected, `open`, the `NestedHost` wrapper (a line out is one socket message, a message in is a line, `kill` closes, a close is `exit`).
- `UPDATE: packages/sdk/src/listen.ts:97-139` - a join path whose token is checked against nodes, not people; it does not ask for the deployment token, since a node's own token is that door's credential and opens nothing else (task 03).
- `UPDATE: packages/sdk/src/types/computers.ts` - `ComputerPort.connect?`, which returns `NestedStarted | undefined`.
- `UPDATE: packages/sdk/src/host/spawn.ts:796-798` - `nestedAgent(agent, { start })` when the port has `connect`.
- `CREATE: packages/sdk/test/nodes.test.ts`.

## Steps

1. The `NestedHost` type moves to `types/computers.ts` so the port can name it; `nested.ts` re-exports it.
2. `connect` answers `undefined` for an id that is not a node, and the host falls back to `startInside`.
3. Refuse a `node/hello` from an ahpd older than 0.14.1, with a sentence that says to update it.
4. A node that is not connected throws "node <name> is not connected", which the proxy reports as the session's failure.

## Validation

- `nodes.test.ts`: a fake node over an in-memory socket serves a scripted inner host; a nested session through `connect` answers a turn.
- A join with a node token and no deployment token is admitted at the join path; the deployment token alone is refused there.
- `nodes.test.ts`: the inner `createSession` gets the node's workdir, not the hub's folder.
- `nodes.test.ts`: the hub refuses a `node/hello` from 0.14.0 with the update sentence.

## Resume

- **Implemented** 2026-10-30.
- `packages/sdk/src/nodes.ts` holds `fileNodes` from task 03 and `liveNodes` beside it: the nodes connected now, and the sessions they serve. `JOIN_PATH` is `/join` and `OLDEST_AHPD` is `0.14.1`.
- A control socket answers `node/hello` and nothing else, with `METHOD_NOT_FOUND` for another method and `INVALID_PARAMS` for one that carries no `versions.ahpd`. An ahpd older than 0.14.1 is refused with `This node runs ahpd <v>, and this hub needs 0.14.1 or newer to resume its sessions by id. Update ahpd on the node.`, on the hello's own id.
- A hello keeps the node's `workdir`. A second control socket for a node replaces the first, and the replaced one's close is not the node going. A close abandons every `node/open` this node has not dialled for.
- `accept(node, peer, url)` reads the socket's URL: one with `data=<id>` is that session's, held as a `NestedHost` so the proxy reads a socket as a process (a line into `stdin` is one socket message, a message in is a line on `stdout`, `kill` closes the socket, and a close is `exit` then `close`). One without is the node's control socket.
- `connect(id, asked)` answers `undefined` for an id no node of the file has, which is the port's answer for a machine it does not serve, and throws `node <id> is not connected` for one it has that has not dialled. It mints a random hex name, asks `node/open { id, plugins }` (10 s), then waits for the data socket (20 s), and answers `{ host, workingDirectory: <node workdir> }`.
- `drop(id)` closes a node's connection and abandons its pending opens. It is the seam a served `node rm` uses; nothing in this build calls it.
- `NestedHost` and `NestedStarted` moved to `packages/sdk/src/types/computers.ts`, which `sessions/nested.ts` re-exports. `ComputerPort.connect?(id, asked: NestedStart): Promise<NestedStarted | undefined>` is the new verb.
- `packages/sdk/src/types/listen.ts` gained `Raw { raw, close }`, `Opened { url?, node? }`, the fourth argument of `OnConnect`, and the `join?: NodeDoor` option, whose `NodeDoor` is `{ path, verify(token) }`.
- `packages/sdk/src/listen.ts` decides the join path in `doorOf` by a node's own token and by nothing else, so the deployment key is refused there. `take()` hands a `Raw` connection the frame as it arrived. `opened` is threaded through Node, Bun, Deno and `overStdio`.
- `packages/sdk/src/rpc.ts` gained `Peer.raw?(text)`, which sends one frame already written: a relayed line is the inner host's message, not this host's, so it is not re-serialised through `send`.
- `packages/sdk/src/host/spawn.ts` gives `nestedAgent` a `start` that asks the port's `connect` when the port has one, and `sessions/nested.ts` falls back to `startInside` when `start` answers `undefined`.
- The join door is a path, so task 01's `packages/server/src/commands/join.ts` dials `<hub>/join`: `controlOf` appends the path unless the address already ends in it. This is the one departure from task 01's file list.
- `packages/server/src/run.ts` wires it, which task 02's file list does not name: with a users file, `run` builds `liveNodes({ file: fileNodes({ path: nodesFileOf(options.users) }), log: stamp })`, puts `join: { path: JOIN_PATH, verify }` in the door, and hands a connection whose `opened.node` is set to the registry instead of the host. A hub with no users file has no nodes.
- `packages/sdk/test/nodes.test.ts` has four cases: a node token opens `/join` and nothing else while the deployment key is refused there; a 0.14.0 hello is refused with the update sentence and a 0.14.1 hello is admitted with its workdir; `connect` answers `undefined` for no node of the file and throws for one that has not dialled; and a session in a joined node answers a turn, with the inner `createSession` at the node's workdir rather than the hub's folder.
- Verified: typecheck clean; `nodes.test.ts` 4 passed; the sdk regressions 144 passed across `nested-proxy`, `nested-start`, `listen`, `listen-identity`, `stdio`, `rpc`, `host-remote-session` and `computer-bringback`; `join.test.ts`, `server-commands.test.ts` and `server-cli.test.ts` 87 passed.
- `nested-start.test.ts` runs a real process and takes 5.2 s here, past vitest's 5 s default under load; it passes with `--testTimeout=20000`.
