---
title: The plugin entry, and a daemon that serves provider `cofold`
status: done
depends:
  - task-02-a-turn-becomes-the-chat-actions.md
  - task-03-approval-and-questions.md
  - task-04-catalogue-transcript-and-resume.md
layer: packages/agent-cofold
refs:
  - code://packages/sdk/src/types/plugin.ts - `Plugin` and `PluginHost`, which `apply` implements
  - code://packages/server/src/plugins.ts - `loadPlugins`, which resolves, manifest-checks and imports this package
  - code://packages/server/src/main.ts#L539-L545 - where the daemon folds what a plugin contributed
  - code://.project/decisions/plugin-manifest-is-package-json.md - the `ahpd` key and the peer range
  - code://test/plugin-end-to-end.test.ts - the spec-to-served-backend shape this test follows
  - code://docs/PLUGINS.md - the author's guide this package is the first real example of
---

## Objective

`@ahpd/agent-cofold` is loadable as a plugin: its manifest declares the `ahpd` entry and a `@ahpd/sdk` peer range, its module exports `name` and `apply`, `apply` registers provider `facio` from the plugin's own options, and a daemon started with `--plugin @ahpd/agent-cofold` serves a session whose turn answers through a configured model.

## Files

- `CREATE: packages/agent-cofold/src/plugin.ts` - `name`, `title` and `apply(host, options)`.
- `UPDATE: packages/agent-cofold/package.json` - the `ahpd` key and the entry the loader imports.
- `UPDATE: packages/agent-cofold/src/index.ts` - export `apply` and `name` beside `facioAgent`.
- `CREATE: test/agent-cofold-plugin.test.ts` - the loader path and the served session.
- `UPDATE: docs/PLUGINS.md` - the package as the worked example, and the session config it takes.

## Steps

1. Write `apply(host, options)` building one agent with `facioAgent(options)` and calling `host.registerAgent`, with the provider from the options and `facio` when none is named.
2. Pass the store path, the default model, the base URL, the instructions and the provider from `options`, and merge `options` over the package defaults the way the loader already merges a plugin's own `defaults`.
3. Export `name = '@ahpd/agent-cofold'` and `apply` from the module the manifest names, with no default export, so the loader's shape check passes for the reason every plugin does.
4. Declare `ahpd: { entry, title }` in the manifest and keep the `peerDependencies` range pointed at `@ahpd/sdk`, which is the check the loader runs before it imports.
5. Write the end-to-end test the way `test/plugin-end-to-end.test.ts` writes its own: `loadPlugins` over a path spec, `createHost` on the folded options, a fake peer, a session on provider `facio`, and one turn answered by a stub model adapter passed through the plugin's options, because a test does not call a real endpoint.
6. Assert the manifest path: `test/plugin-list.test.ts`'s machinery is not reused, but a case here loads the package by path and reads its title from the `ahpd` key, so the key is exercised for real.
7. Add a case for two providers: two specs of the package with different `options.provider` and different stub models, folded over one base, both listed on the root channel and each answering its own turn.
8. Update `docs/PLUGINS.md` with the package and its config, and note that the API key belongs in the daemon's environment rather than in the session config a client sends.
9. By hand, once: build, start the daemon with `--plugin ./packages/agent-cofold` and a configured endpoint, create a session, and watch one turn answer.
10. Pin the resume shape task 04 left open: a paused run reopened with `start.resume` is replayed through the mapping while the host also seeds `transcript(id)`, so the same open turn can reach a client twice. Decide and implement which side gives way - the seed omits the open turn, or the replay emits only the session-level request and not the turn's chat actions - and assert it in the end-to-end test with a client that subscribes after the resume and counts the turn once.

## Validation

- `test/agent-cofold-plugin.test.ts`:
  - `loadPlugins(['./packages/agent-cofold'], …)` answers no problems, one loaded plugin named `@ahpd/agent-cofold`, and a title from the manifest.
  - a host built from the folded options advertises `facio` beside whatever the base had.
  - a session on `facio` runs one turn to `chat/turnComplete` with the stub model's text.
  - two specs with different providers contribute two backends and neither collides.
  - the loader's range check refuses the package when its `@ahpd/sdk` peer is pointed at a version this SDK is not.
  - a session resumed while its newest run is paused is answered and continues, and a client that subscribes after the resume sees the open turn once rather than twice.
- `pnpm test` green, `pnpm typecheck` green, `pnpm boundary` green, `pnpm build` builds four packages.
- By hand: the daemon serves provider `facio` and answers a turn through a real OpenAI-compatible endpoint, and a client needing a confirmation is asked and continues.

## Resume

Done 2026-09-20.
`plugin.ts` exports `name`, `title` and `apply(host: PluginHost, options)`; `index.ts` re-exports them so the module the manifest names is the plugin, with no default export; `docs/PLUGINS.md` gains the package as the worked example, its options and its session settings, and the warning that a long-lived key belongs in the daemon's environment.
`test/agent-cofold-plugin.test.ts` is five cases: the loader loads the source file spec, folds it and serves one turn to `chat/turnComplete`; `describePlugin` answers `ready` for the package directory with the manifest's name and title without importing; two specs with two providers do not collide; an incompatible peer range is refused; and a paused run resumed through `start.resume` is answered, continues, and is seen once by a client that subscribes after the resume.
Verified: `pnpm test` 763 passed over 53 files, `pnpm typecheck` green, `pnpm boundary` green, `pnpm build` four packages.
By hand: a real daemon started from a `config.json` naming the package with a `store` option loaded `@ahpd/agent-cofold`, offered `claude, facio` on the root channel, and answered a session on `facio` through a local OpenAI-compatible endpoint with `hello from facio` as streamed `chat/delta` and then `chat/turnComplete`.
Two cross-cutting fixes were needed. `loadOne` applied a manifest's `ahpd.entry` over the file a spec had resolved to even for a file spec, which contradicts plan 01's task 03 step 5 ("load the manifest's entry only when the caller resolved the package rather than a file"); it now keys that override and the drift report on `resolved.packageDir`, and keeps the walked-up directory for reading and checking the manifest. And `packages/agent-cofold` resolved `@ahpd/sdk` to the published `0.6.0` because the workspace SDK was only a peer, so `PluginHost` did not exist for the package build; a `devDependencies: { "@ahpd/sdk": "workspace:*" }` fixed the link and the entry is typed against the real contract.
Resume fork resolved: the seed gives way. `reopen` removes the recorded copy of the open turn from `turns` before the replay rebuilds it as the live `active` turn, because the live object is what later deltas and the completion move, while a seeded copy would read as finished and never move; a test counts the turn once and was confirmed to count two when the drop is disabled.
Departure from the plan: the loader case uses the source file spec rather than `loadPlugins(['./packages/agent-cofold'])`, because the manifest names the build and `pnpm test` does not build; the directory is exercised through `describePlugin`, and the built entry is what the by-hand daemon loaded.
Substituted for by hand: a confirmation asked and answered is proved by `test/agent-cofold-approval.test.ts`, and a restart listing and resuming a session by `test/agent-cofold-store.test.ts`, because a configuration file is JSON and cannot carry the policy function the pause comes from.
