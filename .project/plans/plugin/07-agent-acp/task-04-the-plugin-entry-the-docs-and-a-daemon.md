---
title: The plugin entry, the docs, and a daemon that serves a configured server
status: done
depends:
  - task-02-the-catalogue-a-resume-and-the-config-schema.md
  - task-03-the-hosts-files-and-shell-reach-the-server.md
layer: agents
refs:
  - code://packages/agent-cofold/src/plugin.ts - the entry this mirrors, options checked key by key
  - code://packages/server/src/plugins.ts - `loadPlugins`, which resolves, checks and imports this package
  - code://docs/PLUGINS.md - the worked example and the options table this package joins
  - code://.project/decisions/plugin-manifest-is-package-json.md - where a plugin declares `entry` and `title`
  - code://test/plugin-end-to-end.test.ts - the daemon-level test a contributed backend is held to
---

## Objective

`@ahpd/agent-acp` is a plugin a daemon loads by name, one spec per ACP server with the command as the option that tells them apart, and `docs/PLUGINS.md` says which commands it is known to work with and what each option does.

## Files

- `CREATE: packages/agent-acp/src/plugin.ts` - `name`, `title` and `apply(host, options)`, one `acpAgent` registered per spec.
- `UPDATE: packages/agent-acp/src/index.ts` - re-export `apply` and `name` from the entry.
- `UPDATE: packages/agent-acp/package.json` - the `ahpd` key with `entry` and `title`, and `private` only if the release is not part of this plan.
- `CREATE: test/agent-acp-plugin.test.ts` - the loader resolving the package, listing it as `ready` without importing, and serving a turn through the fixture.
- `UPDATE: docs/PLUGINS.md` - a second worked example: the options, the known commands and the capabilities that depend on the ports.
- `UPDATE: .project/plans/index.md` - the `plugin` rows gain 07.
- `UPDATE: .project/plans/plugin/00-plugin.md` - the domain reference gains the package and the closed deferred rows.
- `CREATE: .project/plans/plugin/07-agent-acp/implemented.md` - written when the plan is closed.

## Steps

1. Write `apply` checking each option for its type and dropping what it does not understand, as the cofold entry does, so a misspelled option does not fail the whole plugin.
2. Register one agent per spec, so two specs with two commands and two providers are two backends rather than a collision.
3. Add the `ahpd` manifest key and confirm `ahpd plugin list` reports the package as `ready` without importing it.
4. Run the fixture server through the daemon end to end and record what it showed, then write the docs and the index rows.

## Validation

- `test/agent-acp-plugin.test.ts` - the loader resolving the package and serving a turn through the scripted server, a manifest listed as `ready` without importing its entry, two providers from two specs, and a spec with no `command` reported and skipped.
- By hand: `scripts/acp-smoke.mts` drove one real turn against `copilot --acp` (GitHub Copilot CLI 1.0.87) through a host built from this package, and it completed with no error.
- By hand, through the daemon's own argv (2026-09-23): `node packages/server/dist/main.js --plugin ./packages/agent-acp` served one real turn against `@deepseek-ai/dsh-acp`, run as the shipped `dsh --profile acp` profile, with a WebSocket client driving `initialize`, `createSession`, `subscribe` and a one-word `chat/turnStarted`. Provider `dsh`, `PONG` streamed, `chat/turnComplete`, no `chat/error`, and `permissionMode` in the session's config schema.
- `npx tsc -p tsconfig.json --noEmit`, `node scripts/boundary.mjs` and the full suite green.
- `plans/index.md` and `plans/plugin/00-plugin.md` updated, which is the plan-closing change.

## Resume

Done 2026-09-22, and by hand against a real server as well.
Built: `packages/agent-acp/src/plugin.ts` (`name`, `title`, `apply`, one backend per spec, `command` required and reported at load when absent), the re-export from `index.ts`, the `ahpd` key in the manifest, and `test/agent-acp-plugin.test.ts`.
Then released: the manifest lost `private`, gained the published metadata and an `ahpd.options` declaring `command` required (so `ahpd plugin list` reports a spec with no command as `unconfigured`), and moved to `0.6.2` with the other four packages. `release.yml` now checks, packs and stages all five; see [release-versions-move-together.md](../../../decisions/release-versions-move-together.md).
Written: the `@ahpd/agent-acp` worked example in `docs/PLUGINS.md`, with the options, the four commands it is known to cover, the capability-to-port table and the binary permission rule.
Run by hand: `scripts/acp-smoke.mts` drives one real turn against `copilot --acp` (GitHub Copilot CLI 1.0.87) through a host built here. It handshook, named provider `copilot`, mapped Copilot's three modes into `permissionMode`, streamed `PONG` for a one-word prompt and completed with no error. Copilot puts its session store under `$HOME/.copilot`, which this sandbox mounts read-only, so the run names `COPILOT_HOME` to a writable directory; on a normal machine it needs no environment at all.
Run by hand through the daemon itself, 2026-09-23: `node packages/server/dist/main.js --plugin ./packages/agent-acp` loaded the package, listed provider `dsh` beside `claude`, and served one real turn against `@deepseek-ai/dsh-acp` - the shipped `dsh --profile acp` profile - ending in `chat/turnComplete` with `PONG` and no error. That closes the last line the plan's checklist had left open: the daemon's argv and configuration path rather than an in-process host, and `@deepseek-ai/dsh-acp` rather than only the scripted fixture and Copilot.
Two SDK gaps closed on the way, both on the terminal factory: it now opens the shell `rootConfig.defaultShell` names, and it fires the `terminal_open` event the client path fires, so a plugin watching for a shell cannot tell which half of the host opened it.
