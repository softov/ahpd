---
title: The plugin entry, the docs, and a daemon that serves a configured server
status: todo
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

- `test/agent-acp-plugin.test.ts` - the bare-name and directory specs, two providers from two specs, and a whole turn served through the loader.
- By hand: `node packages/server/dist/main.js --port 0 --plugin ./packages/agent-acp` serves the configured provider, and a session answers a turn from `@deepseek-ai/dsh-acp` with a real model configured.
- `npx tsc -p tsconfig.json --noEmit`, `node scripts/boundary.mjs` and the full suite green.
- `plans/index.md` and `plans/plugin/00-plugin.md` updated, which is the plan-closing change.

## Resume

Empty until started. Then: what was done, what is left, what was found that the plan did not know.
