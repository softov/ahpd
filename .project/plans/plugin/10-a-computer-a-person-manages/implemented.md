---
title: A computer is an object a person manages - implemented
date: 2026-09-23
refs:
  - code://packages/computer/src/manifest.ts
  - code://packages/computer/src/provider.ts
  - code://packages/computer/src/runtime.ts
  - code://packages/computer/src/plugin.ts
  - code://packages/computer/src/tools.ts
  - code://packages/sdk/src/types/host.ts
  - code://packages/sdk/src/types/plugin.ts
  - code://packages/sdk/src/types/resources.ts
  - code://packages/sdk/src/plugins.ts
  - code://packages/sdk/src/host.ts
  - code://packages/server/src/config.ts
  - code://packages/server/src/main.ts
  - code://docs/COMPUTER.md
---

A person makes a computer with a resource write and destroys it with a resource delete, using the `computer:write` grant the host already derives from the scheme. A session names the computer it runs in through a key the plugin contributes, a tool that declares it needs advanced permission is absent until the daemon permits it, and the reference host's own twelve tools are untouched.

## What was built

- `code://packages/computer/src/manifest.ts` - `manifestOf`, the create body: `runtime`, `image`, `cpus`, `memory`, `mounts`, `workdir`, each validated with a sentence and defaults from the provider.
- `code://packages/computer/src/provider.ts` - `write` (create, `-32010` onto a name that is taken, the `max` limit, runtime failures as `-32603`) and `remove` (destroy, `-32008` when absent), `capabilities` naming the manifest, and `ProviderOptions.label`.
- `code://packages/computer/src/runtime.ts` - `MachineSpec.mounts` and `workdir`, and `docker run -v`/`-w`; the action words are `create`, `destroy`, `exec`.
- `code://packages/computer/src/plugin.ts` - the label passed to the provider, the `computer` session key with `sessionDefault` and `sessionSetting`, and the `computers` port.
- `code://packages/computer/src/tools.ts` - the three tools declare `advancedPermission: true`.
- `code://packages/sdk/src/types/host.ts` - `HostTool.advancedPermission`, `HostOptions.advancedTools`, `HostOptions.sessionConfig`.
- `code://packages/sdk/src/types/plugin.ts` - `registerSessionConfig` and `Contribution.sessionConfig`.
- `code://packages/sdk/src/plugins.ts` - the session-config registration, its per-plugin duplicate check, and the fold's cross-plugin and backend collisions as reported problems.
- `code://packages/sdk/src/host.ts` - one `permitted()` filter over the offered tools, and `sessionSchema`/`contributedDefaults` merging a contributed setting into the schema and the values a backend sees.
- `code://packages/sdk/src/validate.ts` - the `computers` port in the member and method tables.
- `code://packages/server/src/config.ts`, `code://packages/server/src/main.ts` - the `advancedTools` key, `--advanced-tools`, and a startup line.
- `code://docs/COMPUTER.md`, `code://docs/DAEMON.md`, `code://docs/PLUGINS.md`, `code://docs/USERS.md` - the lifecycle, the setting, the key and the two registrations.

## Verified

- `test/computer.test.ts` - the manifest field by field, `createOnly` to `-32010`, the maximum, destroy and `-32008`, the leaf and root refusals, and `capabilities` naming the manifest.
- `test/host.test.ts` - a marked tool is absent without the permission and present with it, and an unmarked one is present either way.
- `test/computer-plugin.test.ts` - the three tools are contributed either way and only offered when the daemon permits them; the `computer` setting reaches the session schema with the default; `advancedPermission` is on all three; a bad `sessionDefault` is refused.
- `test/plugin-host.test.ts`, `test/plugin-fold.test.ts` - a contributed setting on the schema and in `values`, and the two collisions.
- `pnpm test` 73 files / 971 tests, `pnpm typecheck`, `pnpm boundary` and `pnpm schema` green.
- By hand, against real Docker: a manifest written to `computer://box` started a container, `resourceList` showed it, `capabilities` named the manifest fields, and `resourceDelete` left `docker ps -a --filter label=ahpd.computer=1` empty.

## Departures from the plan

- `manifestOf` returns the spec without the label, which the provider adds, because a manifest does not know what this host labels its machines.
- A blank `image` in a body is refused while an absent one takes the default, which is stricter than the plan and is what a client that wrote the field meant.
- The host key is named `advancedTools` as the decision defaulted, not `pluginTools`.

## Since built

- `pnpm build` was missing `tsc -p packages/computer`, so `packages/computer/dist` - which is what the package manifest's `ahpd.entry` names - stayed at a build from before this plan. A daemon loading `@ahpd/computer` therefore got the read-only provider while advertising the scheme honestly, which is a plugin that lists computers and cannot make one. The build script names it now.

## Left for later

- The per-session gate on the machine tools, which needs the seam this plan built and is the proposal in [research/a-computer-three-things.md](../../../research/a-computer-three-things.md).
- Verifying a JWT locally, and roles from an issuer's claims or groups, still wait in [host/08's deferred.md](../../host/08-an-issuer-behind-the-users-port/deferred.md).
