---
title: "`ahpd join` dials the hub and keeps the connection"
status: done
depends: [task-03-a-node-has-a-token.md]
layer: "server"
refs:
  - "[code://packages/server/src/commands/registry.ts](../../../../packages/server/src/commands/registry.ts) - commands declared once"
  - "[code://packages/server/src/commands/run.ts#L1678-L1689](../../../../packages/server/src/commands/run.ts#L1678-L1689) - the stdio host a session is served from"
---

## Objective

`ahpd join <url> --token <t>` opens a control socket to the hub's join door, says the node's ahpd and protocol versions, and for each `open` dials a data socket and pipes it to a local `ahpd --stdio --plugin <each>` started in the node's own working directory, as p9 does for an ssh machine; a directory the hub names is a path on the hub, not on the node.

## Files

- `CREATE: packages/server/src/commands/join.ts` - the command, CLI only.
- `UPDATE: packages/server/src/commands/registry.ts` - registered.
- `CREATE: packages/server/test/join.test.ts`.

## Steps

1. Speak JSON-RPC on the control socket: `node/hello { versions, workdir }` from the node, `node/open { id, plugins, env? }` from the hub.
2. Start each session in the node's `workdir`: the `--workdir` flag of `ahpd join`, or the start directory. `node/open` has no `cwd`.
3. Put in `env` only what p12 sends; p12's open question decides it.
4. Reconnect a dropped control socket with backoff up to a minute.
5. Stop on a refused token or version, and show the hub's sentence.
6. A data socket that closes ends its process; a process that exits closes its socket.
7. One control socket per node and one data socket per session; each session is its own `ahpd --stdio` process, started by one function, `serveSession(open)`, so serving from a running daemon later changes that function only.

## Validation

- `join.test.ts`: the fixture host is started in the node's `--workdir`, whatever the hub's own path is.
- `join.test.ts`: `node/hello` carries the `--workdir`, and a hub that refuses the version stops `ahpd join` with its sentence.
- `join.test.ts`: against a fake hub, `open` starts a fixture host, a frame crosses both ways, closing either end ends the other, and a dropped control socket reconnects.

## Resume

- **Implemented** 2026-10-30.
- `packages/server/src/commands/join.ts` declares `node.join`, `join <url> --workdir <folder>`, and only `cliRegistry()` registers it: a hub runs no join, and a `--remote` client would be joining from its own network.
- The token is the program's own `--token`, `--token-file` or `AHPD_TOKEN`, read from `context.globals` rather than declared a second time, because `--token` is one name on the program. Joining with none stops with exit 2.
- The control socket is `<url>?tkn=<token>`. The node sends `{ jsonrpc, id: 1, method: 'node/hello', params: { versions: { ahpd, protocol }, workdir } }` on every open, with `version()` and `SUPPORTED_PROTOCOL_VERSIONS`.
- The hub asks for a session with `node/open { id, plugins?, env? }`, answered `{ result: { id } }` once the host is spawned and its socket is dialling. An `open` with no id is answered `-32602`, and one that carries no id at all is a notification.
- A refusal is a JSON-RPC error that answers the hello's id. Its message is printed as it is and the command exits 1 through `conflict()`. Task 02's hub sends that sentence for an ahpd older than 0.14.1.
- A data socket is the control URL with `data=<id>` added and the token kept. It carries one JSON frame per message, the same newline-delimited AHP a stdio host speaks, so the relay is a pipe in both directions.
- The session host is this node's own program: `process.execPath`, `process.execArgv`, the resolved `process.argv[1]`, then `--stdio` and one `--plugin` per spec. It runs in `--workdir` with `env` merged over the node's environment. Its stderr is the node's stderr, so a session's log is the join's log.
- A data socket that closes kills its host, and a host that exits closes its socket. A session lives outside the control loop, so a dropped control socket leaves it running.
- Reconnect: a control socket that carried a hello and then dropped is dialled again after 1 s. One that never carried a hello is dialled again with a wait of 1 s that doubles to 60 s.
- A failed handshake is told apart from a hub that is not up by a plain `GET` to the http twin of the hub's URL. Any answer, a 401 included, means the hub refused this node, so the command stops with the sentence. No answer means the hub is down, so the node waits and dials again.
- `packages/server/test/join.test.ts` has six cases: the hello's workdir and a served session in that folder, a session socket closed by its host exiting, a refused version stopping with the hub's sentence, a control socket dropped and dialled again, no token stopping with exit 2 and dialling nothing, and a hub that answers and refuses the token.
- The workdir case proves the host's folder with the fixture at `fixtures/plugin-env`, named by a relative spec that resolves against the host's cwd, and reads its line on the join's stderr.
- Verified: typecheck clean, `join.test.ts` 6 passed, and `server-commands.test.ts` plus `server-cli.test.ts` 81 passed.
