---
title: The nested host speaks AHP over stdio, so the relay is a pipe
status: accepted
date: 2026-09-24
refs:
  - "[code://packages/sdk/src/rpc.ts#L74-L100](../../packages/sdk/src/rpc.ts#L74-L100) - `createPeer`, whose only demand is a `Wire` of send, close and isOpen"
  - "[code://packages/sdk/src/rpc.ts#L163-L200](../../packages/sdk/src/rpc.ts#L163-L200) - `receive`, which takes one frame as a string"
  - "[code://packages/sdk/src/listen.ts#L195-L225](../../packages/sdk/src/listen.ts#L195-L225) - the socket transport, which is the same three calls over a WebSocket"
  - "[code://packages/sdk/src/listen.ts#L225-L300](../../packages/sdk/src/listen.ts#L225-L300) - the WebSocket server, and why a host that needs `ws` is a host that needs a package"
  - "[code://.project/ideas/dev-container-sessions.md](../ideas/dev-container-sessions.md) - the reference's relay, which is a WebSocket over the exec's stdio"
---

## Context

The reference relays by making a socket out of a pipe.
It spawns `devcontainer exec ... <relay command>` on the host, takes the child's stdout and stdin as a duplex (`Duplex.from({ readable: child.stdout, writable: child.stdin })`), and hands that duplex to a `ws` client as its `createConnection`, with the nested host's connection token on the URL as `?tkn=` (`devContainerAgentHostService.ts:502-545`).
That shape is forced by what the reference has: its agent host is a separate program that listens on a TCP port or a unix socket, so something inside the container has to bridge stdio to that endpoint (`buildAgentRelayCommand`), and the client that reaches it must speak WebSocket with a token on the URL.

This host owns both ends. The nested host is `ahpd`, which this repository builds, and its transport is a seam rather than a socket: `createPeer(wire)` needs `send`, `close` and `isOpen`, and `receive(text, peer, handle)` takes one frame as a string (`rpc.ts:74` and `:163`; the WebSocket transport is those same three calls in `listen.ts:199`).
The SDK has no runtime dependency by design, and `scripts/boundary.mjs` enforces it, so a host that needed `ws` inside a container would be a host with a package requirement its own package cannot take.

## Decision

The nested host speaks AHP over newline-delimited JSON on its own stdin and stdout, and the relay is a pipe between one client's frames and that process.

- `packages/server` gains a stdio mode: `receive` for each line read, and a peer whose `send` writes the frame and a newline. Nothing listens, so nothing inside the container can reach the nested host except through the outer connection.
- There is no port forwarder, no endpoint registry, no `ws` inside the container and no token on a URL, because there is no socket: the process's stdio is the transport and the outer host owns it.
- The port answers a duplex, which is a stream of bytes plus close, and the SDK does the framing because framing is protocol knowledge and a stream is not.
- The nested host still authorizes whatever it is configured to authorize: with a directory it answers `-32007` until the relayed client authenticates, which is where a credential for the container's models belongs rather than in the outer host's configuration.
- A connection over stdio is admitted as the host itself. There is no handshake to present a token on and no second door to guard, because the process that started this host holds the only handle to its pipes, and the outer host's own grant decided whether it may exist at all.

## Consequences

The relay is small enough to unit test with no Docker and no CLI: a fake port can spawn a real nested `ahpd` on stdio and the test can drive `initialize` through `connect` and `relaySend` to a real answer.
Nothing is exposed in the container, so a token in a URL cannot leak into a log, a docker inspect or a process listing. This is the one place where owning both ends buys something real, and it is worth saying plainly that the reference's shape is more machinery for a problem we do not have.
A stdio transport is a second transport in the daemon, which is one more path a frame can arrive on and therefore one more place the gate and the tap must hold. `receive` and `createPeer` are shared, so the parity is structural rather than copied: whatever the socket path applies to a frame applies to a stdio frame too, and the tests hold both.
The framing is newline-delimited, which means a frame containing a raw newline would split. Protocol frames are JSON, and JSON escapes a newline inside a string, so the only newlines on this wire are the separators. That is a fact worth a test rather than a note.

## Options

- **Copy the reference's WebSocket over a duplex.** Rejected: it exists to bridge stdio to a listening port, and our nested host can be given stdio directly, so the copy would add a forwarder, an endpoint registry, a token in a URL and a `ws` dependency inside the image.
- **A unix socket inside the container.** Rejected: a socket is the thing that then needs a forwarder, and the outer host would still have to carry the frames.
- **Run the nested host as a plugin inside the outer host's process.** Rejected: the point is that the host, its tools and its shells are the container's, and a plugin in this process is this process.
- **Smuggle the frames through `devcontainer exec` per request.** Rejected: every request would be a new process, and stdio for the turn would have nowhere to live.

