---
title: The docs say a plugin installs at the version that fits
status: todo
depends: [task-02-install-asks-for-the-version-that-fits.md, task-03-update-moves-to-the-version-that-fits.md]
layer: "docs"
refs:
  - "[code://docs/DAEMON.md#L55-L75](../../../../docs/DAEMON.md#L55-L75) - install and update, which say the daemon's version"
  - "[code://packages/server/README.md#L34](../../../../packages/server/README.md#L34) - the upgrade paragraph"
---

## Objective

The docs say that install and update choose the newest version whose `@ahpd/sdk` range admits the daemon.
They also say that `@ahpd/sdk` itself stays at the daemon's version.

## Files

- `UPDATE: docs/DAEMON.md:55-75` - the version rule for install and update.
- `UPDATE: packages/server/README.md:34` - the upgrade paragraph.
- `UPDATE: packages/server/README.md:67` - the `plugin update all` line.

## Steps

1. Replace "at the daemon's version" for plugins with the new rule in each file above.
2. Keep the sentences that put `@ahpd/sdk` at the daemon's version.
3. Say that ahpd passes a name with a version or a tag to npm as written.

## Validation

- `rg -n "daemon's version" docs packages/server/README.md` names only `@ahpd/sdk`.

## Resume

