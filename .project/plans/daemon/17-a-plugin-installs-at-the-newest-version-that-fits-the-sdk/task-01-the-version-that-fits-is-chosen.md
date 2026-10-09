---
title: The version that fits the daemon's sdk is chosen from the registry
status: todo
depends: []
layer: "server"
refs:
  - "[code://packages/server/src/install.ts#L108-L122](../../../../packages/server/src/install.ts#L108-L122) - `pinned`, which the new reader replaces for plugins"
  - "[code://packages/server/src/compat.ts#L88](../../../../packages/server/src/compat.ts#L88) - `satisfies`"
  - "[code://packages/server/src/update.ts#L80-L90](../../../../packages/server/src/update.ts#L80-L90) - `askRegistry`"
---

## Objective

One function in `install.ts` answers which version of a registry package to install for this daemon.
That version is the newest one whose `@ahpd/sdk` peer range admits the daemon's version, not above `dist-tags.latest` and not a prerelease.
It answers `undefined` when the registry cannot be asked, and a refusal when no version admits the daemon.

## Files

- `UPDATE: packages/server/src/update.ts:80-90` - `askRegistry` takes an optional `accept` header, so a caller can ask for the abbreviated packument.
- `UPDATE: packages/server/src/install.ts:108-122` - add `fittingVersion(name, daemonVersion, options)`; `pinned` stays for `@ahpd/sdk` only.
- `UPDATE: packages/server/test/plugin-install.test.ts` - cases for `fittingVersion` against a fake registry.

## Steps

1. Add an optional `accept` to `askRegistry`'s options, with `application/json` as the default.
2. Ask for `<name>` with `accept: application/vnd.npm.install-v1+json`, the abbreviated packument.
3. Answer `undefined` when the answer is missing, or has no `versions` object.
4. Drop every prerelease version and every version above `dist-tags.latest`, comparing with `update.ts`'s `parse`.
5. Keep a version whose `peerDependencies["@ahpd/sdk"]` is absent, or which `satisfies` admits.
6. Skip a version whose range `satisfies` throws on.
7. Answer the newest version kept.
8. With none kept, throw an `Error` naming the package, the newest version's range and the daemon's version.
9. Add a test for each rule in steps 3 to 8.

## Validation

- `plugin-install.test.ts`: for daemon `0.10.0`, the function answers `0.1.0` when `0.1.0` asks `>=0.9`.
- `plugin-install.test.ts`: it answers `0.2.0` with `>=0.10` over `0.3.0` with `>=0.11`.
- `plugin-install.test.ts`: it never answers a prerelease or a version above `latest`.
- `plugin-install.test.ts`: it answers a version with no range.
- `plugin-install.test.ts`: it answers `undefined` when the registry does not answer.
- `plugin-install.test.ts`: with no fit, it throws a refusal that names `>=0.11` and `0.10.0`.
- `npx vitest run packages/server/test/plugin-install.test.ts` passes.

## Resume

