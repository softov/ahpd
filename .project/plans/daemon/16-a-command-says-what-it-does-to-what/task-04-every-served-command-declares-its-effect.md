---
title: Every served command declares its effect and resource
status: todo
depends: [task-01-the-server-is-on-the-cofold-release.md, task-02-usage-lists-and-shows-as-two-commands.md, task-03-plugin-config-shows-and-unset-removes.md]
layer: "server"
refs:
  - "[code://packages/server/src/commands/served.ts#L76-L86](../../../../packages/server/src/commands/served.ts#L76-L86) - every `declare*` the served registry calls"
  - "[code://packages/server/test/server-commands.test.ts](../../../../packages/server/test/server-commands.test.ts) - the manifest cases"
  - "file:///github/cofold/.project/plans/commands/04-an-action-declares-what-it-does-to-what/plan.md - the role table: `read` with no key lists, `read` with a key gets, `add` with no key creates, `change` or `remove` with a key acts on a row; any other combination is a plain action"
---

## Objective

Each command `servedRegistry` declares carries the `effect` and `resource` below, on the line and over `/api`.
Commands only the line has (`start`, `stop`, `run`, `configure` and the like) declare nothing and stay plain actions.

| Command | Effect | Resource |
| --- | --- | --- |
| `daemon.status`, `daemon.config` | read | - |
| `daemon.restart` | change | - |
| `user.list` | read | `user` |
| `user.add` | add | `user` |
| `user.rm` | remove | `user` by `id` |
| `user.token`, `user.member`, `user.primary` | change | `user` by `id` |
| `team.list` / `team.add` / `team.rm` | read / add / remove | `team`, by `id` on `rm` |
| `project.list` / `project.add` / `project.rm` | read / add / remove | `project`, by `id` on `rm` |
| `plugin.list` | read | `plugin` |
| `plugin.install` | add | `plugin` |
| `plugin.remove` | remove | `plugin` by `name` |
| `plugin.update`, `plugin.enable`, `plugin.disable`, `plugin.config.set`, `plugin.config.unset` | change | `plugin` by `name` |
| `plugin.config` | read | `plugin` by `name` |
| `proxy.list` | read | `provider` |
| `usage.list` / `usage.show` | read | `pool`, by `pool` on `show` |
| `vault.list` | read | `secret` |
| `vault.set` | add | `secret` |
| `vault.delete` | remove | `secret` by `name` |

## Files

- `UPDATE: packages/server/src/commands/status.ts`, `config.ts`, `user.ts`, `teams.ts`, `plugin.ts`, `proxy.ts`, `usage.ts`, `vault.ts`, and wherever `daemon.restart` is declared - the two fields on each action.
- `UPDATE: packages/server/test/server-commands.test.ts` - the cases below.
- `UPDATE:` the README or docs page that lists the commands, if it shows a remove running without a question.

## Steps

1. Test first: the served manifest's `{ id, effect, resource }` for every command equals the table, pinned as one list, so a new served command without a row fails it.
2. Add the fields; registration refuses a key that is not an input field, so a wrong key fails at start.
3. Test that `ahpd user rm bob` with no terminal exits 2 naming `--yes`, and runs with `--yes`.

## Validation

- The pinned list matches; `servedRegistry` handed to `serve()` starts.
- The five removes ask first; `--yes` runs them without a terminal.
- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test`, `pnpm build` green.

## Resume
