---
title: The traffic log is the daemon's --wire capture, written in the shape VS Code writes
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/server/src/commands/run.ts#L344-L360](../../packages/server/src/commands/run.ts#L344-L360) - the `--wire` tap, which writes `{ at, from, peer, frame }` per line today"
  - "[code://packages/sdk/src/types/listen.ts#L26-L35](../../packages/sdk/src/types/listen.ts#L26-L35) - `Tap`, every frame both ways as it crosses the socket"
  - "[code://tools/wire.mjs#L221-L232](../../tools/wire.mjs#L221-L232) - `framesIn`, which already reads a bare message as well as a wrapped one"
  - "file:///github/externals/vscode/src/vs/platform/agentHost/common/ahpJsonlLogger.ts - VS Code's AHP traffic log: the message at the root, `_ahpLog` beside it, rotated files"
  - file:///github/externals/vscode/src/vs/platform/agentHost/node/webSocketTransport.ts - where VS Code's agent host server logs every connection's frames, in the transport rather than in a plugin
---

## Context

A person debugging a client against ahpd wants every frame in and out, in a file a viewer reads.
ahpd already has that: `--wire <file>`, a tap on the listener, one JSON line per frame, checked by `pnpm wire`.
Its line is ahpd's own shape, `{ at, from, peer, frame }`.

VS Code's agent host writes the same log in the transport, not in an extension, and in a different shape: the JSON-RPC message itself with a root-level `_ahpLog` of `ts`, `dir` (`c2s` or `s2c`), `connectionId`, `transport` and `byteLength`, one file per connection, rotated at 75 MiB and kept to five, with oversized strings elided and `truncated` set.
Tooling built for VS Code's log reads that shape and not ahpd's.

The plugin surface has no hook on frames, and adding one would be a new kind for what the listener already does.

## Decision

The traffic log is `--wire` and the `wire` configuration key, in the daemon, and not a plugin.
Its lines take VS Code's shape: the message at the root and `_ahpLog` beside it, with the same fields, the same size cap and file count, and the same truncation.
It stays one file, the one `--wire` names, with connections told apart by `connectionId`, because the flag names a file and not a folder.
No frame hook is added to the plugin surface.

Source: Softov, 2026-09-26, accepted this when it was proposed in answer to his brief.

## Consequences

A capture from ahpd opens in whatever reads a VS Code capture, and one tool reads both.
`pnpm wire` keeps working, because `framesIn` already takes a bare message; the checker has to ignore `_ahpLog`, which is not a protocol field.
The old `{ at, from, peer, frame }` line is gone, and `framesIn` still reads old captures.
A plugin still cannot see frames, which keeps a plugin that forwards or rewrites traffic out of reach on purpose.

## Options

- **A `transport` observer kind for plugins.** Rejected: a new registration kind for something the daemon already does, and a plugin on the socket path is a plugin that can slow every frame.
- **Keep ahpd's own line shape.** Rejected: a second format for the same log, readable by ahpd's tool and nothing else.
- **Write both shapes, chosen by a flag.** Rejected: two formats to keep for one purpose.
