---
title: A command says what it does to what, and the daemon serves on the cofold that checks it
domain: daemon
status: built
priority: high
created: 2026-10-06
revalidated: 2026-10-06
refs:
  - "[code://packages/server/src/commands/served.ts#L76-L86](../../../../packages/server/src/commands/served.ts#L76-L86) - `servedRegistry`, the commands `/api` serves"
  - "[code://packages/server/src/http.ts#L109-L116](../../../../packages/server/src/http.ts#L109-L116) - `apiHandler`, where `serve()` builds its routes when the daemon starts"
  - "[code://packages/server/src/commands/usage.ts#L85-L89](../../../../packages/server/src/commands/usage.ts#L85-L89) - `usage.list`: `:pool?` bound to `/usage/{pool}`, which the new `serve()` refuses"
  - "[code://packages/server/src/commands/plugin.ts#L287-L302](../../../../packages/server/src/commands/plugin.ts#L287-L302) - `plugin.config`, which shows a plugin's options or removes one"
  - "[code://packages/server/package.json#L47-L50](../../../../packages/server/package.json#L47-L50) - the `@cofold/*` ranges"
  - "npm://@cofold/commands - `effect` and `resource` on an action, from cofold plan commands/04"
  - "npm://@cofold/remote - the manifest carries both, and `serve()` refuses a path parameter that is not a required single input"
  - "npm://@cofold/terminal - `remove` asks first, `--yes`, and a missing argument is named (cofold commands/03)"
  - "file:///github/cofold/.project/plans/commands/04-an-action-declares-what-it-does-to-what/plan.md - the role table: list, get, create, item action"
---

## Goal

Every command the daemon serves says what it does (`read`, `add`, `change`, `remove`) and to which kind of thing, so `/api/cli-manifest` tells a client which command lists, which creates and which acts on one row.
The daemon moves to the cofold release that carries this, and that release refuses `usage.list` at startup, so `usage` and `plugin config` are each split in two first.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `servedRegistry` handed to the local cofold `serve()` (2026-10-06): refused with `usage.list binds {pool} in /usage/{pool}, but pool is optional`; of the 28 served commands, none declares an effect.
- `rg "plugin/config|api/usage|usage.list|plugin.config" ahpapp/src ahpc/src ahpd-web/src` - no client calls the two routes that change; ahpapp reads usage through the `usage:` scheme.
- petshop served the way `apiHandler` serves (`serve()` under `/api`, bearer token), with a CLI built by `commandsFrom` the way `remoteRegistry` is: effect and resource reach the manifest, a remote `remove` asks first and takes `--yes`, a missing argument is named.

### Runtime path

```
registry.action({ effect, resource }) -> manifestFrom -> /api/cli-manifest -> commandsFrom (ahpd CLI) / ahpd-web
                                      -> serve() routesOf -> refuses a bad path parameter at start
```

### Gaps

- `usage.list` answers two shapes from one command and binds an optional parameter in its path.
- `plugin.config` reads or removes depending on whether a key is given.
- No served command declares an effect or a resource.

## Decisions locked in

No decision file: these are fixes and the cofold role table applied.

| What | Source | Task |
| --- | --- | --- |
| `usage` splits: `usage.list` at `GET /usage` lists the pools, `usage.show` at `GET /usage/{pool}` reads one; the command line stays `ahpd usage` and `ahpd usage <pool>` | Softov, 2026-10-06, asked how `usage.list` should be served now that `serve()` refuses its optional `{pool}`, chose "Split in two" | 02 |
| `plugin config` splits: `plugin.config` shows a plugin's options, a new `plugin.config.unset` (`plugin config unset <name> <key>`) removes one, beside `plugin.config.set` | Softov, 2026-10-06, asked what `plugin config :name :key?` should become, chose "Split show and unset" | 03 |
| What each command declares is the table in task 04 | (defaulted: the cofold commands/04 role table; Softov may change any row) | 04 |
| Declaring effect and resource waits for the cofold release | daemon 15's second table, Softov 2026-10-06 | 01 |

## Proposed architecture

- **Data flow** - each `declare*` in `commands/` adds `effect` and `resource` to its `registry.action`; the served and the line registries share the declarations, so both carry them.
- **Layer responsibilities** - server `commands/*.ts`: the declarations · `@cofold/remote`: the manifest and the startup check · `@cofold/terminal`: the confirm on a remove.
- **Source-of-truth files** - [`code://packages/server/src/commands/served.ts`](../../../../packages/server/src/commands/served.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The server is on the cofold release that declares effects](task-01-the-server-is-on-the-cofold-release.md) | done | - |
| [02 - usage lists the pools and shows one, as two commands](task-02-usage-lists-and-shows-as-two-commands.md) | done | - |
| [03 - plugin config shows, and plugin config unset removes](task-03-plugin-config-shows-and-unset-removes.md) | done | - |
| [04 - Every served command declares its effect and resource](task-04-every-served-command-declares-its-effect.md) | done | 01, 02, 03 |
| [05 - A list's rows carry the key its item commands take](task-05-a-lists-rows-carry-the-key.md) | done | 04 |

## Risks and tradeoffs

- `user rm`, `team rm`, `project rm`, `plugin remove` and `vault delete` now ask before running; a script without a terminal exits 2 until it passes `--yes`. The message names `--yes`.
- `plugin config <name> <key>` no longer removes the option, and is refused; task 03 pins the message, and `plugin config unset <name> <key>` does it.
- `plugin config unset <name> <key>` has as many words as `plugin config <name> <key> <value>`; the literal `unset` outscores a slot, so it reads as the unset, and a plugin literally named `unset` can no longer have an option set from the line.
- Daemon 15 edits the same `user.ts`, `teams.ts` and `vault.ts` declarations; whichever lands second rebases.

## Resume state

- **Done so far:** all five tasks are done, reviewed 2026-10-06. The cofold release is on npm and the server is on it (01), with `usage` split into `usage.list` and `usage.show` (02), `plugin config` split into a show, a set and an unset (03), every served command declaring its effect and resource against a pinned thirty-row manifest (04), and every list's rows carrying the key its item commands take (05, which renamed `PluginRow.name` to the configured key and moved the declared name to `module`). Daemon 09 task 03 closed in the same bump.
- **Next action:** none; a credentialed git spec's masked row name is left to the plugin-id idea.
- **Open questions:** none.
- **Watch out for:** `plugin update :name...` is required on purpose (`all`, or names), so it is not a bug the new checks expose.

## Final verification checklist

- [x] `servedRegistry` handed to `serve()` starts; the daemon starts with `"http": true`.
- [x] `/api/cli-manifest` shows an effect on every served command, and a resource on every command in task 04's table that names one.
- [x] `ahpd user rm bob` with no terminal exits 2 naming `--yes`; with `--yes` it runs.
- [x] `npx tsc -b`, `pnpm boundary` and `pnpm build` green, and `npx vitest run` green over every package this plan touched; the two cases that time out at their 5 s default under parallel load pass alone and are recorded in `implemented.md`.
- [x] `plans/index.md` updated.
