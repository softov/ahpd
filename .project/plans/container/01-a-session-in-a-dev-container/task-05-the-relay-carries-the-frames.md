---
title: The relay carries the frames
status: done
depends:
  - task-02-the-host-serves-the-surface.md
  - task-04-a-nested-host-runs-inside.md
layer: packages/sdk, packages/computer
refs:
  - "[code://packages/sdk/src/host.ts#L4686-L4760](../../../../packages/sdk/src/host.ts#L4686-L4760) - the handlers `relaySend` goes in"
  - "[code://packages/sdk/src/types/computers.ts](../../../../packages/sdk/src/types/computers.ts) - the port beside this one, whose contract is the shape to follow"
  - "[code://packages/sdk/src/rpc.ts#L163-L200](../../../../packages/sdk/src/rpc.ts#L163-L200) - `receive`, and the parse error a bad frame draws"
  - "[code://.project/plans/container/01-a-session-in-a-dev-container/task-01-the-daemon-answers-over-stdio.md](task-01-the-daemon-answers-over-stdio.md) - the transport the nested host is started with"
---

## Objective

A client's frames reach the nested host and its answers come back: one `relayMessage` per line, `output` for the CLI's own stderr, `relayClose` and `closeConnection` when the process ends, and the whole thing proved end to end with no Docker.

## Files

- `UPDATE: packages/sdk/src/containers.ts` - the framing: a line splitter for the channel's bytes and a writer that appends the separator.
- `UPDATE: packages/sdk/src/host.ts` - the notification wiring and the disposal path.
- `UPDATE: packages/computer/src/nested.ts` - stderr as `output` and the process's own exit as the channel's close.
- `CREATE: test/container-relay.test.ts` - the end-to-end case: a real nested `ahpd` on stdio behind a fake port.

## Steps

1. Frame both ways in one place. A frame on this wire is JSON, so a separator that is a newline cannot appear inside one; the writer appends one and the reader holds a partial tail until the separator arrives.
2. Write `relaySend` as one write to the channel and nothing else. The host does not parse the frame, does not answer it, and does not care which method it carries: the nested host is the one that reads it.
3. Emit `relayMessage` once per complete line, with the client's own `connectionId`, so the client's protocol stack sees exactly the frames the nested host wrote, in order.
4. Report the CLI's stderr and the nested host's stderr as `output`, which is what the reference's output notification is for: a container that is being built prints, and a person waiting should see it.
5. On the process's exit, emit `relayClose` and then `closeConnection`, dispose the channel, and forget the id. A second `relaySend` for that id is `-32008` rather than a silent nothing.
6. Prove the path without Docker: a fake port that spawns this repository's own daemon in stdio mode, with a temporary path, and a test that runs `connect`, then `initialize` and `ping` through `relaySend`, and asserts the nested host's answers arrived as `relayMessage`. This is the case that says the relay is real, and it runs in `pnpm test`.
7. Keep the frame count honest under a split: write half a frame, wait, write the rest, and the client sees one `relayMessage` rather than two.

## Validation

- `test/container-relay.test.ts` - the end-to-end case above; a frame split across two writes arrives once; two frames in one write arrive twice; a nested host that exits draws `relayClose` then `closeConnection`; a `relaySend` after that is `-32008`; a client's stderr arrives as `output`.
- `test/containers.test.ts` still passes, since the surface's contract did not change.
- `pnpm test`, `pnpm typecheck` and `pnpm boundary` green.

## Resume

Done, 2026-09-24. See [implemented.md](implemented.md).
The nested host is this repository's own daemon, so the end-to-end test needs no container, no Docker and no CLI.
