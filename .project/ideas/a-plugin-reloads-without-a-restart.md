---
title: A plugin reloads without restarting the daemon
created: 2026-09-29
---

Raised with daemon/11, where a changed plugin configuration takes effect through `ahpd restart`.

A plugin could be torn down and loaded again while the daemon runs, so a change to one plugin does not restart every session.

## What it needs

- A `teardown()` a plugin may export, called before it is unloaded, for the timers, watches and processes it started itself.
- A host that can take an agent, a tool, a scheme and a port away and add them again while it runs; today it is built once from every plugin's contributions ([`code://packages/sdk/src/plugins.ts`](../../packages/sdk/src/plugins.ts)).
- A rule for the sessions still running on an agent the plugin registered: wait for them, refuse the reload, or end them.
- A fresh module: Node keeps an ES module for the life of the process, so loading the same file again returns the old one unless the import is made unique or the plugin runs in its own worker or process.
- A registration that throws half way is undone, so a failed reload leaves nothing of the plugin behind.
