---
title: The docs say how a plugin opens a canvas
status: done
depends:
  - task-03-a-plugin-opens-a-canvas.md
layer: "docs"
refs:
  - "[code://docs/plugins/PLUGINS.md#L189-L220](../../../../docs/plugins/PLUGINS.md#L189-L220) - the `PluginHost` method table"
  - "[code://docs/sdk/AHP.md](../../../../docs/sdk/AHP.md) - what this host serves of the protocol, and which root keys it reads"
  - "[code://docs/sdk/CHATS.md](../../../../docs/sdk/CHATS.md) - what a chat holds"
  - "[code://UPSTREAM.md#L40](../../../../UPSTREAM.md#L40) - the Pass 7 canvas box"
---

## Objective

The plugin docs list the three canvas calls and their rules.
The AHP docs say that this host serves the canvas channel to a connection at `0.10.0` or later.

## Files

- `UPDATE: docs/plugins/PLUGINS.md:189-220` - add `openCanvas`, `updateCanvas` and `closeCanvas`, and a short section after the table.
- `UPDATE: docs/sdk/AHP.md` - add the canvas channel, the version gate and `canvasesEnabled`.
- `UPDATE: docs/sdk/CHATS.md` - say that a chat lists its canvases and that a canvas goes with its chat.
- `UPDATE: UPSTREAM.md:40` - tick the canvas box and name this plan.

## Steps

1. Add a row for each call to the `PluginHost` table.
2. Write the section: the state the plugin gives, the resource it gets, the owner rule and the `url` rules.
3. Say in that section that the plugin clears `url` when its source stops.
4. Say in that section that a loopback `url` is not reachable from a remote client.
5. Say in that section that only the plugin closes a canvas, and a client cannot.
6. Add the canvas channel and the version gate to `AHP.md`, and add `canvasesEnabled` to the keys this host reads.
7. Add the canvases of a chat to `CHATS.md`.
8. Tick the Pass 7 canvas box in `UPSTREAM.md`.

## Validation

- Read each changed page and check that it names the three calls as `types/plugin.ts` declares them.
- Run `pnpm docs:build` and expect no dead link.

## Resume

- **Done so far:** built. `docs/plugins/PLUGINS.md` has a *Showing a canvas on a chat* section with a row for each of the three calls, and it says the state a plugin gives, the resource it gets, the owner rule, the `url` rules, that the plugin clears `url` when its source stops, that a loopback URL does not reach a remote client, and that only a plugin closes a canvas. `docs/sdk/AHP.md` has `chat/canvasesChanged` (the `chat/*` table is 35 of 35), a `canvas/*` section for `canvas/stateChanged`, and the `0.10.0` gate. `docs/sdk/CHATS.md` has a *Canvases* section and the term. `docs/sdk/HOST.md` says six VS Code keys are read and names `canvasesEnabled`. `UPSTREAM.md` ticks the Pass 7 canvas box and names this plan.
- **Next action:** none. Every task is implemented, and `implemented.md` is written.
- **Open questions:** none.
- **Watch out for:** the plan put the keys this host reads in `AHP.md`, but that list is in `HOST.md` *Root config*, so the change went there and `AHP.md` links to it. The three calls are not `register*` methods, so their rows are in a table of the new section rather than in the register table, where every row is a registration. The `chat/*` heading keeps the file's em dash, as its siblings do.
