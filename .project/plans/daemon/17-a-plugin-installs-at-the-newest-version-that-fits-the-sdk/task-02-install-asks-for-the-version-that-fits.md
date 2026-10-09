---
title: Install asks npm for the version that fits
status: implemented
depends: [task-01-the-version-that-fits-is-chosen.md]
layer: "server"
refs:
  - "[code://packages/server/src/install.ts#L393-L455](../../../../packages/server/src/install.ts#L393-L455) - `refuseNonPlugins` and `installPlugins`"
---

## Objective

`ahpd plugin install <name>` installs a bare registry name at the version `fittingVersion` chooses, for every package and not only `@ahpd/*`.
The manifest check asks the registry at that same version.

## Files

- `UPDATE: packages/server/src/install.ts:393-414` - `refuseNonPlugins` chooses each bare name's version with `fittingVersion` and returns the names to install.
- `UPDATE: packages/server/src/install.ts:436-455` - `installPlugins` installs the names `refuseNonPlugins` returned, not `pinned` ones.
- `UPDATE: packages/server/test/plugin-install.test.ts` - install cases.

## Steps

1. In `refuseNonPlugins`, call `fittingVersion` for each bare registry name, all names at once.
2. Use `<name>@<version>` when it answers a version, and the name as written when it answers `undefined`.
3. Pass a name that already carries a version or a tag as written, with no `fittingVersion` call.
4. Ask the manifest check at the chosen version.
5. Return the chosen names, and install those in `installPlugins`.
6. Let a refusal from `fittingVersion` end the install before npm runs.
7. Keep `daemonsSdk` and its `@ahpd/sdk` pin as they are.
8. Replace the `pinned` test with cases for the new rule.

## Validation

- `plugin-install.test.ts`: `install @ahpd/web` runs npm with `@ahpd/web@0.1.0` and `@ahpd/sdk@0.10.0`.
- `plugin-install.test.ts`: `install left-pad` runs npm with the fitting version.
- `plugin-install.test.ts`: `install @ahpd/web@0.1.0` asks for no packument.
- `plugin-install.test.ts`: a package with no fit runs no npm.
- `plugin-install.test.ts`: an unreachable registry runs npm with the bare name.
- `npx vitest run packages/server/test/plugin-install.test.ts` passes.

## Resume

Built. `refuseNonPlugins` returns the names to install: each bare registry name is chosen with `fittingVersion`, all names at once, and becomes `<name>@<version>`, the name as written when it answered `undefined`, and a name that already carries a version or a tag unchanged with no `fittingVersion` call. The manifest check asks the registry at the chosen version, and a refusal from `fittingVersion` ends the install before npm runs. `installPlugins` installs what it returned rather than `pinned` ones; `daemonsSdk` and its `@ahpd/sdk` pin are unchanged.

`packages/server/test/server-configure.test.ts` was outside this task's files and asserted the old pin (`@ahpd/agent-claude@0.8.0` from `pinned`); its fake registry now answers a packument holding `0.8.0` with `@ahpd/sdk: >=0.8`, so it still asserts the exact version configure installs. `configure.ts`'s stale `version` comment now says what the code does.

