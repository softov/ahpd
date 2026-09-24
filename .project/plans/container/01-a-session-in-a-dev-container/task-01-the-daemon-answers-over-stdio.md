---
title: The daemon answers over stdio
status: done
depends: []
layer: packages/sdk, packages/server
refs:
  - "[code://packages/sdk/src/rpc.ts#L74-L100](../../../../packages/sdk/src/rpc.ts#L74-L100) - `createPeer`, whose only demand is a `Wire`"
  - "[code://packages/sdk/src/rpc.ts#L163-L200](../../../../packages/sdk/src/rpc.ts#L163-L200) - `receive`, one frame as a string"
  - "[code://packages/sdk/src/listen.ts#L195-L225](../../../../packages/sdk/src/listen.ts#L195-L225) - the socket transport built on the same two calls"
  - "[code://packages/server/src/main.ts#L250-L290](../../../../packages/server/src/main.ts#L250-L290) - where a flag is parsed"
  - "[code://packages/server/src/main.ts#L855-L885](../../../../packages/server/src/main.ts#L855-L885) - the one `listen` call and the host it accepts into"
  - "[code://scripts/boundary.mjs](../../../../scripts/boundary.mjs) - the dependency rule the SDK keeps"
---

## Objective

The daemon can serve a connection over its own stdin and stdout: newline-delimited JSON in, newline-delimited JSON out, through the same `createPeer` and `receive` the socket uses.

## Files

- `UPDATE: packages/sdk/src/listen.ts` - an `overStdio(options, onConnect)` beside `listen()`, returning the same `{ host, port, guarded, close }` shape with `host: 'stdio'` and `port: 0`, built from a line reader rather than a socket.
- `UPDATE: packages/server/src/main.ts` - `--stdio`, which chooses it instead of `listen`, and the startup line that says so in its own words rather than pretending a port exists.
- `UPDATE: docs/DAEMON.md` - one paragraph: what stdio mode is for, and that it binds nothing.
- `CREATE: test/stdio.test.ts` - the transport's cases, driven against a real host over pipes.

## Steps

1. Read stdin as lines. A line is one frame; a frame is JSON, so the only newlines are the separators. Refuse a line that is not valid JSON the way `receive` already does over a socket, with the same code and the same silence about what was in it.
2. Write a frame as one line plus `\n`, and flush. `isOpen` is whether stdout is still writable; `close` ends stdin rather than the process, so a host in stdio mode answers one client and then exits when its input ends.
3. Admit the connection as the host itself: over stdio there is no handshake to present a token on, and the process that started this one holds the only handle to its pipes. The outer host's own gate decided whether it may exist, which is where the authority is.
4. Keep the tap, the gate and the paging exactly as they are: the transport is chosen once, and everything above it is the same code. If a frame arrives over stdio, `receive` and the gate treat it as they treat a socket frame, and the tests say so.
5. Do not require a port, a token or `ws` in this mode, and do not print a `ws://` line the daemon record could later read as an address.

## Validation

- `test/stdio.test.ts` - `initialize` is answered over a pipe; a malformed line draws the parse error and no crash; a request with no grant is refused over stdio with the same code it draws over a socket; an escaped newline inside a string survives as one frame.
- `pnpm test`, `pnpm typecheck` and `pnpm boundary` green, with the SDK's dependencies unchanged.
- By hand: `ahpd --stdio` accepts a piped `initialize` from a shell and answers one line.

## Resume

Done, 2026-09-24. See [implemented.md](implemented.md).
The shape is `listen` for a pipe: one reader, one writer, and the two calls every transport already uses.
