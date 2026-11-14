---
title: A tunnel row carries alerts
created: 2026-11-14
refs:
  - "[code://packages/sdk/src/tunnels/channel.ts#L180-L190](../../packages/sdk/src/tunnels/channel.ts#L180-L190) - `stateOf`, where a row gets its `status`, `url` and `error`, and where its alerts would go"
  - "[code://packages/sdk/src/types/plugin.ts#L821-L835](../../packages/sdk/src/types/plugin.ts#L821-L835) - `Alert`, the shape a plugin, a connector and an agent row already carry"
  - "[code://packages/tunnel-devtunnel/src/kind.ts#L91-L96](../../packages/tunnel-devtunnel/src/kind.ts#L91-L96) - the `anonymous` setting, the first case that would warn"
---

A tunnel row could carry `alerts` from its kind, in the same `Alert` shape as a plugin, a connector and an agent row.
A client would draw them on the tunnel page without the name of any field.
The first case is devtunnel with `anonymous` on: anybody who has the URL reaches the host, and the page shows only "Anonymous: Yes".
Softov asked on 2026-11-14 for a warning there, and chose that the host says it, not ahpw.
The idea [an-operation-says-when-it-applies](an-operation-says-when-it-applies.md) is a similar case: the host says the condition and the client draws it.
