---
title: The plugin entry, and a daemon that serves provider `facio`
status: todo
depends:
  - task-02-a-turn-becomes-the-chat-actions.md
  - task-03-approval-and-questions.md
  - task-04-catalogue-transcript-and-resume.md
layer: packages/agent-facio
refs:
  - code://packages/sdk/src/types/plugin.ts - `Plugin` and `PluginHost`, which `apply` implements
  - code://packages/server/src/plugins.ts - `loadPlugins`, which resolves, manifest-checks and imports this package
  - code://packages/server/src/main.ts#L539-L545 - where the daemon folds what a plugin contributed
  - code://.project/decisions/plugin-manifest-is-package-json.md - the `ahpd` key and the peer range
  - code://test/plugin-end-to-end.test.ts - the spec-to-served-backend shape this test follows
  - code://docs/PLUGINS.md - the author's guide this package is the first real example of
---

## Objective

`@ahpd/agent-facio` is loadable as a plugin: its manifest declares the `ahpd` entry and a `@ahpd/sdk` peer range, its module exports `name` and `apply`, `apply` registers provider `facio` from the plugin's own options, and a daemon started with `--plugin @ahpd/agent-facio` serves a session whose turn answers through a configured model.

## Files

- `CREATE: packages/agent-facio/src/plugin.ts` - `name`, `title` and `apply(host, options)`.
- `UPDATE: packages/agent-facio/package.json` - the `ahpd` key and the entry the loader imports.
- `UPDATE: packages/agent-facio/src/index.ts` - export `apply` and `name` beside `facioAgent`.
- `CREATE: test/agent-facio-plugin.test.ts` - the loader path and the served session.
- `UPDATE: docs/PLUGINS.md` - the package as the worked example, and the session config it takes.

## Steps

1. Write `apply(host, options)` building one agent with `facioAgent(options)` and calling `host.registerAgent`, with the provider from the options and `facio` when none is named.
2. Pass the store path, the default model, the base URL, the instructions and the provider from `options`, and merge `options` over the package defaults the way the loader already merges a plugin's own `defaults`.
3. Export `name = '@ahpd/agent-facio'` and `apply` from the module the manifest names, with no default export, so the loader's shape check passes for the reason every plugin does.
4. Declare `ahpd: { entry, title }` in the manifest and keep the `peerDependencies` range pointed at `@ahpd/sdk`, which is the check the loader runs before it imports.
5. Write the end-to-end test the way `test/plugin-end-to-end.test.ts` writes its own: `loadPlugins` over a path spec, `createHost` on the folded options, a fake peer, a session on provider `facio`, and one turn answered by a stub model adapter passed through the plugin's options, because a test does not call a real endpoint.
6. Assert the manifest path: `test/plugin-list.test.ts`'s machinery is not reused, but a case here loads the package by path and reads its title from the `ahpd` key, so the key is exercised for real.
7. Add a case for two providers: two specs of the package with different `options.provider` and different stub models, folded over one base, both listed on the root channel and each answering its own turn.
8. Update `docs/PLUGINS.md` with the package and its config, and note that the API key belongs in the daemon's environment rather than in the session config a client sends.
9. By hand, once: build, start the daemon with `--plugin ./packages/agent-facio` and a configured endpoint, create a session, and watch one turn answer.
10. Pin the resume shape task 04 left open: a paused run reopened with `start.resume` is replayed through the mapping while the host also seeds `transcript(id)`, so the same open turn can reach a client twice. Decide and implement which side gives way - the seed omits the open turn, or the replay emits only the session-level request and not the turn's chat actions - and assert it in the end-to-end test with a client that subscribes after the resume and counts the turn once.

## Validation

- `test/agent-facio-plugin.test.ts`:
  - `loadPlugins(['./packages/agent-facio'], …)` answers no problems, one loaded plugin named `@ahpd/agent-facio`, and a title from the manifest.
  - a host built from the folded options advertises `facio` beside whatever the base had.
  - a session on `facio` runs one turn to `chat/turnComplete` with the stub model's text.
  - two specs with different providers contribute two backends and neither collides.
  - the loader's range check refuses the package when its `@ahpd/sdk` peer is pointed at a version this SDK is not.
  - a session resumed while its newest run is paused is answered and continues, and a client that subscribes after the resume sees the open turn once rather than twice.
- `pnpm test` green, `pnpm typecheck` green, `pnpm boundary` green, `pnpm build` builds four packages.
- By hand: the daemon serves provider `facio` and answers a turn through a real OpenAI-compatible endpoint, and a client needing a confirmation is asked and continues.

## Resume

Empty until started.
