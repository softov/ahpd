---
title: ahpd plugin install and remove
domain: daemon
status: built
priority: high
created: 2026-09-25
revalidated: 2026-09-25
requires:
  - plans/plugin/01-plugins-load-from-configuration/plan.md
changes: []
creates: []
decisions:
  - decisions/plugin-install-also-names-the-plugin.md
refs:
  - "[code://packages/server/src/main.ts#L601-L620](../../../../packages/server/src/main.ts#L601-L620) - the `plugin` verb, which takes only `list`"
  - "[code://packages/server/src/main.ts#L139-L160](../../../../packages/server/src/main.ts#L139-L160) - `USAGE`, where the subcommands are listed"
  - "[code://packages/server/src/plugins.ts#L145-L176](../../../../packages/server/src/plugins.ts#L145-L176) - `resolvePlugin`, the bare-name lookup against the configuration directory"
  - "[code://packages/server/src/config.ts#L108-L167](../../../../packages/server/src/config.ts#L108-L167) - `configDir`, `configPath` and `ensureConfigDir`"
  - "[code://packages/server/src/config.ts#L84-L92](../../../../packages/server/src/config.ts#L84-L92) - `plugins` on `Config`"
  - "[code://packages/server/src/version.ts](../../../../packages/server/src/version.ts) - the daemon's own version, for pinning `@ahpd/*`"
  - "[code://packages/computer/src/devcontainer.ts#L235-L262](../../../../packages/computer/src/devcontainer.ts#L235-L262) - the container installs `@ahpd/server` and no backend"
  - "[code://test/plugin-list.test.ts](../../../../test/plugin-list.test.ts) - how the `plugin list` verb is tested"
  - "[code://test/devcontainer.test.ts](../../../../test/devcontainer.test.ts) - how the container's install line is tested"
---

## Goal

`ahpd plugin install @ahpd/agent-claude` leaves a plugin the next run loads, and `ahpd plugin remove` undoes it.
The same command closes the container gap: the host inside a dev container installs the backends named in `devcontainer.plugins`, so `"plugins": ["@ahpd/agent-cofold"]` starts instead of exiting.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `grep -n "verb === '" packages/server/src/main.ts` - `start`, `stop`, `status`, `config`, `user`, `plugin`; `plugin` answers `list` and refuses anything else.
- `grep -rn "writeFileSync" packages/server/src` - nothing writes `config.json` today.
- `grep -n "npm i -g" packages/computer/src/devcontainer.ts` - the container's only install is the server itself.

### Runtime path

```
ahpd plugin install <names> -> npm install --prefix <configDir> <pinned names>
  -> config.json plugins += names -> ahpd plugin list shows them loadable
ahpd (run) -> resolvePlugin(bare name) -> createRequire(<configDir>/package.json) -> loads
devcontainer up -> npm i -g @ahpd/server@<v> -> ahpd plugin install <npm-named devcontainer.plugins> -> ahpd --stdio
```

### Gaps

- No install or remove verb.
- Nothing edits `config.json`.
- The container installs no backend, so the documented cofold setup exits on startup.
- `node-pty` builds only with `--allow-scripts=node-pty` on npm 12.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [ahpd plugin install installs the package and names it in the configuration](../../../decisions/plugin-install-also-names-the-plugin.md) | The user, 2026-09-25: "its there a way to make a install using ahpd? `ahpd plugin install`" |

| What | Source | Task |
| --- | --- | --- |
| npm does the install, run as `npm install --prefix <configDir>`; no registry code in ahpd | `(defaulted: npm is already required to install ahpd)` | 01 |
| A name under `@ahpd/` without a version is pinned to the daemon's own version; any other name is passed as written | `(defaulted: the peer range refuses a mismatched plugin anyway)` | 01 |
| `--allow-scripts=node-pty` is **not** passed: npm 12 refuses that flag on a project-scoped install (`EALLOWSCRIPTS`) and points at the project's `package.json` or `.npmrc` | the `node-pty` finding, 2026-09-25, re-checked 2026-09-26 with npm 12.0.2 | 01 |
| `--config-file` names which file is edited; the default is `configPath()` | `(defaulted: same meaning as for a run)` | 01 |
| A path or a URL spec is refused by `install`: only package names are installed | `(defaulted: a path is already usable as written)` | 01 |
| The container installs only npm-named entries of `devcontainer.plugins`, skipped when `install: false` | the open-work item on the container relay | 02 |

## Proposed architecture

- **Data flow** - `plugin install` builds the npm argument list, runs npm with inherited stdio, then reads the configuration file, adds names that `nameOf` does not already find in `plugins`, and writes it back with the same two-space JSON the other writers use.
- **Event flow** - none; a running daemon picks the change up on its next start, and the command says so.
- **State flow** - the configuration directory's `package.json` and `node_modules`, and `config.json`.
- **Layer responsibilities** - `@ahpd/server`: the verbs, the npm call and the configuration edit, in a new `src/install.ts`. `@ahpd/computer`: one more line in the container's install step.
- **Source-of-truth files** - [`code://packages/server/src/main.ts`](../../../../packages/server/src/main.ts), [`code://packages/computer/src/devcontainer.ts`](../../../../packages/computer/src/devcontainer.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - `plugin install` and `plugin remove`](task-01-install-and-remove.md) | done | - |
| [02 - The container installs its backends](task-02-the-container-installs-its-backends.md) | done | 01 |
| [03 - The docs say one command](task-03-docs.md) | done | 01, 02 |

## Risks and tradeoffs

- `--allow-scripts` is not usable for this install at all: npm 12 refuses it on a project-scoped (`--prefix`) install and points at the project's `package.json` or `.npmrc`. Checked with npm 12.0.2 on 2026-09-26, so the flag is left off, and the only native package a configuration-directory install reaches is the SDK's optional `node-pty`, whose binding the daemon gets from its own global install, where the docs still pass the flag. A plugin with a build script of its own installs its files and skips that script.
- Rewriting `config.json` loses formatting the person chose. It is JSON with no comments, and only `plugins` changes; the risk is whitespace.
- `sudo ahpd plugin install` writes into root's configuration directory, not the person's. The command prints the directory it installed into.
- A daemon already running keeps the old list until restarted. The command's last line says to restart.

## Resume state

- **Done so far:** every task done; see [implemented.md](implemented.md).
- **Next action:** none.
- **Open questions:** none. `remove` uninstalls unless `--keep`, which is what the original question proposed.
- **Watch out for:** the real npm install could not be run where this was implemented, because the npm cache there is read-only and the install fails before it starts. `test/plugin-install.test.ts` fakes npm, and task 01's by-hand line is the verifier's.

## Final verification checklist

- [x] `pnpm test`, `pnpm typecheck` and `pnpm boundary` green.
- [x] By hand: `ahpd plugin install @ahpd/agent-claude` in a clean `XDG_CONFIG_HOME`, then `ahpd plugin list` shows it loadable and `ahpd` starts with it.
- [ ] By hand: a dev container session with `"plugins": ["@ahpd/agent-cofold"]` starts with no mounted checkout.
- [x] `plans/index.md`, `README.md`, `docs/DAEMON.md`, `docs/CONTAINERS.md`, `packages/server/README.md` and `working/HANDOFF.md` updated.
