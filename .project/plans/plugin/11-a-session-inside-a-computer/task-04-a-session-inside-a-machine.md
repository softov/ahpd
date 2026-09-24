---
title: A session inside a machine, proved
status: done
depends:
  - task-03-acp-spawns-through-the-machine.md
layer: packages/agent-acp
refs:
  - "[code://packages/agent-acp/src/connection.ts](../../../../packages/agent-acp/src/connection.ts) - the server this starts in a machine"
  - "[code://packages/computer/src/runtime.ts](../../../../packages/computer/src/runtime.ts) - the runtime the machine comes from"
  - "[code://docs/COMPUTER.md](../../../../docs/COMPUTER.md) - where the by-hand case is written"
  - "[code://test/scenario.ts](../../../../test/scenario.ts) - the scripted host the suite drives"
  - "[code://README.md](../../../../README.md) - `pnpm test` is the suite with no network"
---

## Objective

The suite proves the shape without Docker: a session naming a machine gets a descriptor and the backend spawns it. A by-hand case proves the real thing: a machine from an image that has an ACP server, a session created with `computer`, and the server answering inside the machine.

## Files

- `CREATE: test/computer-session.test.ts` - a host with a fake `computers` port, an ACP backend, and a session created with `computer`, asserting the spawned command line.
- `UPDATE: docs/COMPUTER.md` - the by-hand case, with the image, the create manifest and the session, so it can be repeated.
- `UPDATE: .project/working/HANDOFF.md` - what the by-hand case needs and what it showed.

## Steps

1. Drive a host with a fake port and an ACP backend whose command is a script, create a session with `computer: 'computer://box'`, and assert the descriptor's command was spawned and not the plugin's.
2. Assert the reverse: a session without `computer` spawns the plugin's own command, so nothing that names none changes.
3. Write the by-hand case: an image with a `node` and a small ACP server, `resourceWrite` with a manifest that mounts the server and the workspace, `createSession` with `computer`, and what the person should see.
4. Record what the case needs that a checkout does not have, and what it showed when it ran.

## Validation

- `test/computer-session.test.ts` - the two spawn cases above, with no Docker and no network.
- By hand, in `docs/COMPUTER.md`: `docker` running, an image with the server, a machine made by a resource write, and a session whose server answers from inside the machine.
- `pnpm test` green with no network, which is the suite's own promise.

## Resume

Not started.
The by-hand case is the only one that touches a real container, and it is a checklist rather than a test because `pnpm test` is network-free and may have no Docker.
