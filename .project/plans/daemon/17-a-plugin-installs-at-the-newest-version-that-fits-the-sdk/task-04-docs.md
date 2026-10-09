---
title: The docs say a plugin installs at the version that fits
status: implemented
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

Built. `docs/DAEMON.md`: install says a bare name goes in at the newest version whose `@ahpd/sdk` peer range admits this daemon and a name with a version or a tag goes to npm as written; update says each package moves to the newest of its own versions whose range admits this daemon, or `latest` when the registry cannot be asked, that a package with no fit stops the update before npm runs, and what `--force` does with it. The `@ahpd/sdk`-at-the-daemon's-version sentences are kept. `packages/server/README.md`: the install paragraph and the upgrade paragraph carry the same rule, and the `plugin update all` line reads `move every installed plugin to the version that fits this daemon`. The validation command leaves one `daemon's version` in `docs/DAEMON.md` - the loader-refusal sentence that names the sdk and the version the range is checked against - and none in the README.

