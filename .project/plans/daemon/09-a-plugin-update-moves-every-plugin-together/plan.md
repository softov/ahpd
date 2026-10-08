---
title: A plugin update moves all or the named plugins
domain: daemon
status: active
priority: high
created: 2026-09-29
revalidated: 2026-09-29
requires: []
refs:
  - "[code://packages/server/src/commands/plugin.ts#L83-L140](../../../../packages/server/src/commands/plugin.ts#L83-L140) - `plugin install` and `plugin remove`, the shape `update` copies"
  - "[code://packages/server/src/install.ts#L108-L122](../../../../packages/server/src/install.ts#L108-L122) - `pinned`"
  - "[code://packages/server/src/install.ts#L436-L464](../../../../packages/server/src/install.ts#L436-L464) - `installPlugins`, and how npm's failure is reported"
  - "[code://packages/server/src/install.ts#L80-L93](../../../../packages/server/src/install.ts#L80-L93) - `NpmFailure` and `npmFailed`: `failed` for the terminal, `message` with npm's reason when served"
  - "[code://packages/server/src/install.ts#L498-L549](../../../../packages/server/src/install.ts#L498-L549) - `updatePlugins`, one npm call for everything it moves"
  - "[code://docs/DAEMON.md#L36-L70](../../../../docs/DAEMON.md#L36-L70) - the plugin commands and the 0.6 upgrade note"
  - "npm://@cofold/terminal@^0.2.0 - `unknown command` for a command missing its required argument; fixed in cofold commands/03"
---

## Goal

After upgrading the daemon, `ahpd plugin update` brings every installed plugin to the matching version in one step.
A failed npm call says once, at the terminal, what failed, after npm's own error has streamed; served over HTTP, the error keeps npm's reason.
`ahpd plugin install` with no name says a name is needed.

## Reconnaissance

The files read are the `refs` above.

### Runtime path

```
npm i -g @ahpd/server (0.8.0) -> ahpd plugin install @ahpd/agent-claude ... -> npm i @ahpd/agent-claude@0.8.0 ... in the config dir
  -> ERESOLVE: @ahpd/agent-acp 0.7.0 (installed, not loaded) peers @ahpd/sdk ^0.7 -> ahpd prints npm's error twice
```

### Gaps

- No command upgrades the plugins; a partial install can never resolve across a minor.
- The failure repeats npm's whole error and never names the package that blocks it.
- `ahpd plugin install` with no name reads `unknown command "plugin install". Did you mean "plugin install"?`.

## Decisions locked in

| Decision | Source |
| --- | --- |
| [`ahpd plugin update` takes `all` or the names to move](../../../decisions/plugin-update-takes-all-or-names.md) | Softov, 2026-09-29 |
| [ahpd installs the daemon's own @ahpd/sdk version beside the plugins, and npm checks no peers](../../../decisions/the-daemon-installs-its-own-sdk-beside-the-plugins.md) | Softov, 2026-09-29 |

| What | Source | Task |
| --- | --- | --- |
| `update all` moves every registry dependency in the configuration directory, `update <name>...` only those named; an `@ahpd/*` package goes to the daemon's version, as `pinned` does, any other to `latest` | [decision plugin-update-takes-all-or-names](../../../decisions/plugin-update-takes-all-or-names.md); (defaulted: the version rule is `pinned`'s) | 01 |
| `update` has the CLI and HTTP surfaces `install` has, the same scope and `deploymentTokenOnly`, and says to restart as `install` does | (defaulted: the shape of `plugin install`) | 01 |
| No resolve hook | [decision the-daemon-installs-its-own-sdk-beside-the-plugins](../../../decisions/the-daemon-installs-its-own-sdk-beside-the-plugins.md) | 06 |
| Install and update run npm with `--legacy-peer-deps` and `@ahpd/sdk` at the daemon's version; no refusal names a blocking plugin | [decision the-daemon-installs-its-own-sdk-beside-the-plugins](../../../decisions/the-daemon-installs-its-own-sdk-beside-the-plugins.md) | 08 |
| Our plugins' `@ahpd/sdk` peer range is `">=0.8"`, not `"^0.8"`, so a later daemon minor still loads them | Softov, 2026-09-29: "Something like requiresSdk: \">=2\" is enough in some cases and maybe necessary. right?", then asked "Change our six plugins' @ahpd/sdk peer range from \"^0.8\" to \">=0.8\"?": "Add it to daemon/09" | 09 |
| `@microsoft/agent-host-protocol` is a `dependency` of `@ahpd/sdk`, not a peer: the sdk imports it at runtime, and `--legacy-peer-deps` leaves peers out | Softov, 2026-09-29, asked "Move it to the sdk's `dependencies` (same range ^0.9.0, no new package)?": "Make it a dependency" | 08 |
| `plugin install` refuses, before npm, a registry package whose manifest at the version it would install has no `ahpd` field, read from `<registry>/<name>/<version or tag>`; `update` prints the versions npm installed | Softov, 2026-09-29, after `plugin install @softov/ahpc` enabled a package that is not a plugin: "maybe we need to check package.json?", then "this is possible? GET https://registry.npmjs.org/@ahpd%2Fagent-claude/latest or something alike" | 10 |
| `update`'s JSON and HTTP answer lists only what moved, as `{ name, from, to }` | Softov's `plugin update all --json`, 2026-09-29: `plugins: ["@ahpd/agent-pi"]` beside `Nothing to update.` | 11 |
| `update` moves only packages installed from the npm registry; a dependency whose spec is a path, a link, a git or an https URL is left as installed and named as left alone | Softov, 2026-09-29, asked "`plugin update` moves every dependency in the config dir. What about one installed from a local path or git?": "Leave it as installed" | 01 |
| Any failed npm call ends at the terminal with what failed and not npm's text, which already streamed; over HTTP the error keeps npm's reason | Softov, 2026-09-29, asked "Any npm failure other than the peer refusal still prints npm's error twice at the terminal. Which copy goes?": "Terminal drops it" | 02 |
| The JSON-RPC error path reads the code from an error named `RpcError` with a numeric `code` rather than `instanceof`; the computer plugin pins the container's server to `PluginContext.version` | [decision the-daemon-installs-its-own-sdk-beside-the-plugins](../../../decisions/the-daemon-installs-its-own-sdk-beside-the-plugins.md) | 06 |
| `all` beside names is refused, saying the two forms | Softov, 2026-09-29, asked "The builder made `ahpd plugin update all <name>` (all beside names) a refusal. Keep it?": "Keep the refusal" | 01 |
| `update all` keeps one npm call, and a failure fails the whole update with the `NpmFailure` line, which tells the person to rerun with `--force` to update only the plugins that can be updated; `--force` installs each package in its own npm call, so the others move and the failing one is named | Softov, 2026-10-04, asked "`update all` makes one npm call, so one package npm cannot install fails every move in it. Keep one call, or retry each package on its own?": keep one call, and the failure points at `--force`, which installs each package on its own | 01, 04 |
| `ahpd plugin install` with no name says the name is needed, fixed in `@cofold/terminal` for every command | Softov, 2026-09-29, asked "How should ahpd upgrade plugins, so a 0.7 to 0.8 upgrade works?", chosen option: "`plugin install` stays as it is, apart from the two message fixes" | 03 |
| The review's defects are fixed as a task in this plan | Softov, 2026-10-07, asked "How should the review's fixes be handled?" and answered "Fix tasks in each plan" | 12 |

## Proposed architecture

- **Data flow** - `plugin update` reads the configuration directory's `package.json`, builds each name with its version, and runs one `npm install` there; `config.json` is not touched.
- **Layer responsibilities** - server only; the missing-argument message is cofold's.
- **Source-of-truth files** - [`code://packages/server/src/install.ts`](../../../../packages/server/src/install.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - `ahpd plugin update`](task-01-plugin-update.md) | todo | - |
| [02 - A refused install names what blocks it](task-02-a-refused-install-names-the-blocker.md) | done | - |
| [03 - A missing plugin name is said as one](task-03-a-missing-name-is-said.md) | done | cofold commands/03 released |
| [04 - Docs](task-04-docs.md) | todo | 01, 02, 06, 08 |
| [05 - A plugin loads the daemon's sdk](task-05-a-plugin-loads-the-daemons-sdk.md) | dropped | - |
| [06 - A plugin keeps the sdk npm installs](task-06-the-plugin-keeps-npms-sdk.md) | done | - |
| [07 - Updating named plugins is refused while another is behind](task-07-update-one-refuses-a-plugin-behind.md) | dropped | 06 |
| [08 - Install and update put the daemon's sdk beside the plugins](task-08-the-daemon-pins-the-sdk.md) | done | 06 |
| [09 - Our plugins take any @ahpd/sdk from 0.8 on](task-09-a-plugin-names-its-oldest-sdk.md) | done | 08 |
| [10 - Install refuses a package that is not a plugin](task-10-install-refuses-a-package-that-is-not-a-plugin.md) | done | 08 |
| [11 - Update answers what moved](task-11-update-answers-what-moved.md) | done | 10 |
| [12 - Update and remove use the plugin root, and an sdk move asks for a restart](task-12-update-and-remove-use-the-plugin-root.md) | done | 11 |

## Risks and tradeoffs

- A dependency the person pinned by hand to another version is moved too; `update` says each move it made.

## Resume state

- **Done so far:** on main (21a4488, 5221af7): tasks 01, 02, 04, 06, 08, 09, 10 and 11 implemented 2026-09-29; tasks 05 and 07 dropped and undone; tasks 01 and 04 reopened 2026-10-04 for `--force`. Task 03 implemented 2026-10-06, in daemon 16 task 01's cofold bump.
- **Reviewed 2026-10-07:** 02, 06, 08, 09, 10 and 11 pass as code. The review found that update and remove ignore `AHPD_PLUGIN_ROOT`, which install reads since container/05 p3. Task 12 fixes it.
- **Done 2026-10-08:** task 12 implemented: one `pluginRoot` for install, update and remove, an sdk move answered in `moved`, and the registry asked in parallel.
- **Reviewed and merged 2026-10-08:** task 12 (e5134da); tasks 02, 06 and 08-12 done.
- **Next action:** [task-01-plugin-update.md](task-01-plugin-update.md) adds `--force`, and [task-04-docs.md](task-04-docs.md) says it.
- **Watch out for:** the npm runner is faked in tests through `Runner`; `plugin.ts` serialises writes with `oneAtATime`, and `update` joins it.

## Final verification checklist

- [ ] A configuration directory with four 0.7.0 `@ahpd` plugins and a 0.8.0 daemon: `ahpd plugin update` makes one npm call naming all four at 0.8.0.
- [ ] A failed install, update or remove says what failed once at the terminal, without npm's text again; the served error keeps npm's reason.
- [ ] `ahpd plugin install` with no name says a name is needed.
- [ ] An `update all` whose npm call fails names `--force` in its failure line; `update all --force` moves the packages npm can install and names the one it cannot.
- [ ] `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.
