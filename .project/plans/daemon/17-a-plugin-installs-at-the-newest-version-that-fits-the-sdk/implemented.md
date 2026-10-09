---
title: A plugin installs at the newest version whose sdk range admits the daemon - implemented
date: 2026-10-09
refs:
  - git://9f27e65
  - "[code://packages/server/src/install.ts](../../../../packages/server/src/install.ts)"
  - "[code://packages/server/src/update.ts](../../../../packages/server/src/update.ts)"
---

`ahpd plugin install` and `ahpd plugin update` choose a plugin's version from its `@ahpd/sdk` peer range.
The version is the newest one that admits the running daemon, and a package with no such version is refused before npm runs.

## What was built

- [`code://packages/server/src/install.ts`](../../../../packages/server/src/install.ts) - `fittingVersion`, which reads the registry's abbreviated packument and picks the newest version whose peer range admits the daemon; install asks npm for that version.
- [`code://packages/server/src/update.ts`](../../../../packages/server/src/update.ts) - update moves every plugin by the same rule, `@ahpd/*` or not.
- [`code://packages/server/src/commands/configure.ts`](../../../../packages/server/src/commands/configure.ts) - its backends install through `installPlugins`, so they follow the rule too.
- `docs/DAEMON.md` and `packages/server/README.md` say the rule.

## Verified

- `plugin-install.test.ts` and `server-configure.test.ts` run against a fake registry, and every item of the plan's checklist passes.
- The gates passed before the merge in `9f27e65`.

## Departures from the plan

- none.

## Left for later

- none.
