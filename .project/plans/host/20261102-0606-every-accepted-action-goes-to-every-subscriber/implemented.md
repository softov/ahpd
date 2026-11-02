---
title: Every accepted action goes to every subscriber, implemented
plan: plan.md
built: 2026-11-02
commits:
  - git://dea0309f - the plan
  - git://1afe816d - the change, its docs and its tests
---

## What changed

- [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - `echoTo` is gone; `refuse` moves `serverSeq` before its envelope, which still goes to its sender alone and is not buffered.
- [`code://packages/sdk/src/host/context.ts`](../../../../packages/sdk/src/host/context.ts) - `echoTo` left the context; `refuse` says it takes the next `serverSeq`.
- [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts) - a chat bit, a held draft, a session folder, a chat folder, a cancel naming another turn and a background request go through `dispatch`.
- [`code://packages/sdk/src/host/actions.ts`](../../../../packages/sdk/src/host/actions.ts) - a review, a run's cancel, an unchanged set, a session bit, terminal input and a held terminal title go through `dispatch`.
- An unchanged active client set goes out as the host's entry, as a changed one does.
- [`code://docs/sdk/AHP.md`](../../../../docs/sdk/AHP.md) - its section on accepted actions says the rule, the refusal's sequence and the client's guard.
  Twelve rows say the action goes to every client.
- [`code://docs/sdk/CHATS.md`](../../../../docs/sdk/CHATS.md), `handshake.ts` and `types/session.ts` - the comments that rested on a counter moving with state alone.

## Verified

- The oracle's ten `senderOnly` rows are gone, and the ten cases pass.
  On e4694965 each fails: a client that only watched holds less than the reducer's state.
- `presence.test.ts`: an unchanged set and a session bit reach both clients, each at a greater `serverSeq`.
  A client that reconciles as VS Code's session handler does sends its set once while the other client sends three.
- That case could fail: with the client's two guards taken out, the same host received 4073 sets before the test ended.
- `host-snapshots.test.ts`: a refusal right after a subscribe carries a `serverSeq` above the snapshot's `fromSeq`; on e4694965 it carried the same number.
- The review, folder, background request, draft, chat read and terminal cases each reach every client; each fails on e4694965.
- The seven changed files on e4694965's source: 21 failed, 833 passed. With the change: 854 passed.
- `pnpm run typecheck`, `pnpm run boundary` and `pnpm run i18n` exit 0.

## Not done here

- A folder named in another spelling than the one held is a no-op to the host and an append to the reducer.
  It now reaches every client, and the held state follows the reducer; the host's own list stays as it was (ledger A4).
- An unchanged set goes out with the connection's `clientId` and `tools` filled in, as a changed one does.
  Whether that rewrite stands is the ledger's open C12, under correction 3.
