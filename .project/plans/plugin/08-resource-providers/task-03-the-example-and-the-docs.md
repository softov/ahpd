---
title: A read-only example, the docs and the kinds table
status: todo
depends:
  - task-02-the-host-routes-by-scheme.md
layer: docs
refs:
  - code://test/fixtures/plugin-echo - the shape a plugin fixture takes, manifest and entry together
  - code://test/plugin-end-to-end.test.ts - the loader-to-a-turn case the new fixture joins
  - code://docs/PLUGINS.md - the worked examples and the options table
  - code://.project/plans/plugin/00-plugin.md#L28-L54 - the registration kinds table and the four operations
  - code://.project/research/host-owned-uri-resources.md - the `computer://<id>/status` example this follows
---

## Objective

A read-only fixture provider serves `computer://local/status` and `computer://local/capabilities` through the real loader and a real host, `file:` still lists beside it, and `docs/PLUGINS.md` and the kinds table say what the new kind is and what a provider may leave out.

## Files

- `CREATE: test/fixtures/plugin-uri-resources/package.json` - the manifest with an `ahpd` key naming its entry and title, as `plugin-echo` has.
- `CREATE: test/fixtures/plugin-uri-resources/index.mjs` - a plugin whose `apply` registers one `computer:` provider with `read` and `resolve`, no `list`, no `watch` and no writes, and one server tool beside it only if it earns its place.
- `CREATE: test/uri-resources-plugin.test.ts` - the loader listing the fixture as `ready`, `resourceRead` over `computer://local/status` answering the fixture's bytes, `resourceList` on it answering `-32601`, and `file:` listing unchanged.
- `UPDATE: docs/PLUGINS.md` - a third worked example: the method, the URI shapes, what a provider may leave out and what a client then hears, and the relay precedence.
- `UPDATE: .project/plans/plugin/00-plugin.md` - a `resource provider` row in the kinds table with the `register, open key` operation, and the known-gaps line replaced by the plan.
- `UPDATE: .project/plans/index.md` - the plugin row for 08.

## Steps

1. Write the fixture as a real plugin, not a stub: a `ResourceProvider` with `read` and `resolve`, so the contract is exercised as an author would meet it.
2. Add the cases, driving them through `loadPlugins` and `createHost` rather than by handing the host a literal, because what is under test is that a plugin can do this at all.
3. Write the docs example, naming what the provider leaves out and what a client gets for it, and the precedence: a client-published URI is relayed before a registered scheme is consulted.
4. Add the kinds row and update the domain reference.
5. Run `pnpm test`, `pnpm typecheck`, `pnpm boundary` and `pnpm build`.

## Validation

- `test/uri-resources-plugin.test.ts` - the four cases in the Files list.
- `test/plugin-end-to-end.test.ts` - unchanged and green, which is the proof a `file:`-only host is untouched.
- `pnpm test`, `pnpm typecheck`, `pnpm boundary` and `pnpm build` green.
- By hand: `node packages/server/dist/main.js --plugin ./test/fixtures/plugin-uri-resources` loads it, and a client's `resourceRead` of `computer://local/status` answers.

## Resume

Done 2026-09-23.
Built: the fixture (`package.json` with `ahpd.entry`, and `index.ts` registering a read-only `computer:`), `test/uri-resources-plugin.test.ts`, the docs section and the kinds row.
Found: the fixture is TypeScript like `plugin-echo`, which the test loader imports and the daemon cannot, so the by-hand daemon check used a scratch `.mjs` provider instead - the path the docs already describe for a plugin with no manifest.
Left: the docs name Docker and KVM as the substrate a real provider would talk to, and nothing here starts either.
