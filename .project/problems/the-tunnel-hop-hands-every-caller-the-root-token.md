---
title: The tunnel hop hands every caller the daemon's root token
status: open
date: 2026-11-08
severity: blocker
blocks: []
refs:
  - "[code://packages/tunnel-devtunnel/src/forward.ts#L40-L44](../../packages/tunnel-devtunnel/src/forward.ts#L40-L44) - `withToken` sets `tkn` to the daemon's token"
  - "[code://packages/tunnel-devtunnel/src/forward.ts#L80-L100](../../packages/tunnel-devtunnel/src/forward.ts#L80-L100) - every request and upgrade on the hop goes through `withToken`"
  - "[code://packages/sdk/src/listen.ts#L75-L83](../../packages/sdk/src/listen.ts#L75-L83) - `presented` reads the query `tkn` before `Authorization`"
  - "[code://packages/sdk/src/listen.ts#L172-L174](../../packages/sdk/src/listen.ts#L172-L174) - the deployment token is admitted as root"
  - "[code://packages/server/src/commands/run.ts#L748-L762](../../packages/server/src/commands/run.ts#L748-L762) - `root: true` on a daemon with users"
  - "[code://packages/sdk/src/listen.ts#L268-L290](../../packages/sdk/src/listen.ts#L268-L290) - the upgrade checks the token and no `Origin`"
  - git://1564b69aa - the hop became an HTTP proxy that sets the token
  - git://83efef0ca - the audit branch's head when the problem was read
  - git://598b5d35b - main when the problem was read again, on 2026-11-11
---

## Symptom

Read from the code in the security review of 2026-11-08, and not reproduced.
A daemon with a token and a users directory runs the system tunnel on a port other than 31546.
A process on the same machine opens `ws://127.0.0.1:31546/` with no token.
The daemon admits the socket as root.

## Cause

At `e388d12f5` the hop copied bytes between two sockets, and the client had to present its own token.
The hop now sets `tkn` to the daemon's own token on every request and every upgrade.
`searchParams.set` replaces a `tkn` the client sent.
The daemon reads the query `tkn` before the `Authorization` header, so a person's bearer token is ignored too.
The daemon's token is root on a daemon with users.
The WebSocket upgrade checks no `Origin`, so a browser page reaches the socket.

## Impact

- Any web page the operator opens can get a root AHP connection through `127.0.0.1:31546`.
- Any local user or process on the machine gets the same connection.
- Any tunnel visitor is root, whatever their own token says. With `anonymous: true`, that is anyone.
- A root connection can create sessions and terminals, which runs code as the daemon's user.
- A node join through the hop loses its own token, so the join fails.

## Workaround

Start the daemon on port 31546, so no hop is made.
Or do not run the system tunnel.

## Fix

Choices asked on 2026-11-08. A plan builds them after Softov validates this file.

| Decision | Options | Chosen |
| --- | --- | --- |
| Whose grants a tunnel caller gets | A person the tunnel names; pass every token through, as at `e388d12f5`; the derived token as root, as VS Code's CLI | A person the tunnel names (Softov, 2026-11-08) |
| An `Origin` check on the WebSocket upgrade | Check it against the list the `/api` routes use; no check | Open: "skip this one for now" (Softov, 2026-11-08) |

The chosen fix:

- A tunnel gets a setting that names one person, as `user:<id>`.
- The hop swaps a `tkn` only when it equals the tunnel's derived token, and swaps it for a token with that person's grants.
- The hop passes every other `tkn` and `Authorization` through unchanged.
- With no person set, the hop swaps nothing, so VS Code over a tunnel needs an admin to name a person first.
- A tunnel has no person as its owner, so the setting is new (`packages/sdk/src/tunnels/channel.ts` header).
- The plan finds how the hop gets a token for a person, because the hop holds only the daemon's token today.
