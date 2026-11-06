---
title: A lapsed entry ends with its client
created: 2026-11-02
refs:
  - "[code://packages/sdk/src/host.ts#L474](../../packages/sdk/src/host.ts#L474) - `lapsed`, the channels each client was served a state of that has gone since"
  - "[code://packages/sdk/src/host.ts#L1199-L1203](../../packages/sdk/src/host.ts#L1199-L1203) - an entry is added when the host lets a state go"
  - "[code://packages/sdk/src/host/routing.ts#L356-L357](../../packages/sdk/src/host/routing.ts#L356-L357) - an entry is removed only when its client subscribes to that channel again"
  - git://4e6d5cb8 - the review of MayCXC's branch that found it, merged in #185
---

The host keeps, for each client, the channels it was served a state of that the host has let go of since.
An entry is removed only when that client subscribes to that channel again.
A client that never comes back, or never opens that channel again, keeps its entries for the life of the daemon.
The map is small, but it only grows on a daemon that runs for weeks.
An entry could end when the host forgets its client, or when the channel's chat is deleted.
