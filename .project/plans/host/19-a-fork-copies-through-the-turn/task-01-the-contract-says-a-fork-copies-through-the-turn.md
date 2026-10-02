---
title: The contract says a fork copies through the turn
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/session.ts#L230-L256](../../../../packages/sdk/src/types/session.ts#L230-L256) - the `forkPoint` and `endPoint` comments"
  - "[code://packages/sdk/src/host.ts#L6955-L6956](../../../../packages/sdk/src/host.ts#L6955-L6956) - the host's comment on the fork point"
---

## Objective

`Session.forkPoint` is documented as the backend's name for the last entry a turn left behind, which a fork copies through, and nothing in `packages/sdk` says a fork re-asks the turn.

## Files

- `UPDATE: packages/sdk/src/types/session.ts:230-256` - `forkPoint`: the last entry the turn left behind, copied through by a fork, as the AHP spec's `ForkChatSource` says; `endPoint`: drop "a fork re-asks the turn" and say the two may name the same entry, and why both exist.
- `UPDATE: packages/sdk/src/host.ts:6955-6956` - the comment names the point as the end of the turn, not its prompt.

## Steps

1. Rewrite both comments in the file's own style.
2. Change no code in the host: it already seeds `all.slice(0, at + 1)`.

## Validation

- `pnpm typecheck`, `pnpm boundary` green.
- Read against `ForkChatSource.turnId` in the protocol package.
