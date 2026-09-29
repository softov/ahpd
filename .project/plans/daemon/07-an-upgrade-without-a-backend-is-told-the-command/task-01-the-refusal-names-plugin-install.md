---
title: The refusal names ahpd plugin install, and DAEMON.md says why 0.6 had Claude
status: done
depends: []
layer: "server, docs"
refs:
  - "[code://packages/server/src/commands/run.ts#L396-L410](../../../../packages/server/src/commands/run.ts#L396-L410) - the refusal"
  - "[code://packages/server/test/daemon-backend.test.ts#L58-L90](../../../../packages/server/test/daemon-backend.test.ts#L58-L90) - its case"
  - "[code://docs/DAEMON.md#L22-L46](../../../../docs/DAEMON.md#L22-L46) - the section that quotes it"
---

## Objective

A daemon that loads no backend says to run `ahpd plugin install @ahpd/agent-claude` (with `--config-file <p>` when it was started with one), which installs Claude Code in the configuration directory and adds it to `plugins`, and still names the file, the `plugins` key and `npm i` as the other way.

## Files

- `UPDATE: packages/server/src/commands/run.ts:396-406` - the sentence.
- `UPDATE: packages/server/test/daemon-backend.test.ts` - the case below.
- `UPDATE: docs/DAEMON.md:22-40` - the quoted sentence as the code says it, and a short paragraph: a configuration written for 0.6 names no plugin, because 0.6 had Claude built in, so after upgrading run `ahpd plugin install @ahpd/agent-claude` once.

## Steps

1. Keep one sentence per line where the file already is; `docs/DAEMON.md` is hard-wrapped where it is prose, so match its wrap in the lines you change and do not reflow the rest.

## Validation

- `daemon-backend.test.ts`: the refusal contains `ahpd plugin install @ahpd/agent-claude`, `"plugins"`, the configuration path and `npm i`; run with `--config-file <p>` it contains `--config-file <p>` in the command; each fails first.
- `pnpm typecheck`, `pnpm boundary`, `pnpm test` green.

## Resume

- **Changed:** `packages/server/src/commands/run.ts` builds the command as `ahpd plugin install @ahpd/agent-claude`, adding ` --config-file <p>` when `options.configFile` is set, and the refusal now reads: `No backend is loaded, so this host could serve nothing. Run <command> to install Claude Code and add it to "plugins" in <file>, or run npm i in <configDir> and add the package to "plugins" yourself.`
- **Flag checked:** `plugin install` takes `configFile` from `pluginWriteFields`, the same `--config-file PATH` field a run declares, and accepts it after the names (`server-cli.test.ts` runs `plugin install some-plugin ... --config-file <p>`).
- **Tests:** `daemon-backend.test.ts` gained two cases, and its `run` helper gained a `named` switch that leaves out `--config-file` and writes the file under `XDG_CONFIG_HOME` set to the test's own directory. "names the command that installs Claude Code, and npm i as the other way" (no flag: the command, no `--config-file`, `"plugins"`, the default path, `npm i in <dir>`) and "names the command with the file the daemon was started with" (the command with `--config-file <p>`) both failed first against the old sentence, which had neither `ahpd plugin install` nor the flag; both pass now.
- **Docs:** `docs/DAEMON.md` quotes the new sentence, says the command carries the daemon's `--config-file`, and says a 0.6 configuration names no plugin because 0.6 had Claude built in, so run `ahpd plugin install @ahpd/agent-claude` once after upgrading; new prose wrapped to the file's 80 columns, nothing else reflowed.
- **Gates:** `pnpm typecheck` clean; `pnpm boundary` clean (8 packages, none undeclared); full `pnpm test` 1595 of 1596 passed in 108 files, the one failure the known flake `agent-cofold-tools.test.ts` ("sends the after for an edit still waiting when the turn is cancelled", timed out waiting), which passed alone (27 of 27).
