---
title: "`ahpd configure` sets the daemon up, and a first start at a terminal offers it"
domain: daemon
status: built
priority: medium
created: 2026-09-29
revalidated: 2026-09-30
requires:
  - plans/daemon/09-a-plugin-update-moves-every-plugin-together/plan.md
decisions:
  - decisions/a-start-in-an-unserved-folder-asks-to-serve-it.md
refs:
  - "[code://packages/server/src/commands/run.ts#L398-L406](../../../../packages/server/src/commands/run.ts#L398-L406) - the refusal a daemon with no backend gives today"
  - "[code://packages/server/src/commands/options.ts#L117-L263](../../../../packages/server/src/commands/options.ts#L117-L263) - `serverFields`, the settings and their defaults"
  - "[code://packages/server/src/commands/options.ts#L406](../../../../packages/server/src/commands/options.ts#L406) - the current folder served when `paths` is empty"
  - "[code://packages/server/src/install.ts#L137-L352](../../../../packages/server/src/install.ts#L137-L352) - `readEntry`, `writeEntry`, `enableNames` and `installPlugins`, which configure reuses"
  - "[code://packages/server/src/config.ts#L139-L146](../../../../packages/server/src/config.ts#L139-L146) - the configuration directory and `config.json`"
  - https://nodejs.org/api/readline.html#promises-api - `readline/promises`, built in
---

## Goal

`ahpd configure` asks, at the terminal, each setting a first install needs, showing the current value as the default (`Port [9187]:`), writes `config.json` and installs the backends chosen; run again, it edits what is there.
`ahpd` or `ahpd start` at a terminal with no configuration offers to run it, and in a folder the daemon does not serve asks to trust it; without a terminal nothing is asked.

## Reconnaissance

The files read are the `refs` above.

### Gaps

- A fresh install refuses to start with no backend, naming `ahpd plugin install @ahpd/agent-claude`; host, port, token and folders are flags to know beforehand.
- Neither cofold's terminal nor the server asks a question.
- A start in a folder outside `paths` serves nothing there and says nothing.

## Decisions locked in

| Decision | Task |
| --- | --- |
| [A start at a terminal in a folder the daemon does not serve asks to trust it, and `--no-cwd` neither serves nor asks](../../../decisions/a-start-in-an-unserved-folder-asks-to-serve-it.md) | 02, 04 |

| What | Source | Task |
| --- | --- | --- |
| The command is `ahpd configure`, not `init` | Softov, 2026-09-30: "on daemon/10 its maybe to be 'ahpd configure'?", then chose it | 02 |
| Each question shows the current value as the default, `Name [value]:`; Enter keeps it; an existing `config.json` is edited, keeping every key not asked | Softov, 2026-09-30: "show the current config as 'Port [1234]: 'Name [default]: '" | 01, 02 |
| It asks the backends (Claude, cofold, pi), host, port, the token and the folders; ACP is offered once acp/05's presets exist | Softov, 2026-09-29, the shape: "Both"; 2026-09-30, asked what configure asks for ACP: "Wait for acp/05" | 02 |
| The token: Enter generates one into a `connectionTokenFile` beside `config.json`, or the person types one; an existing token is kept by default | Softov, 2026-09-30, asked about the token: "Both offered" | 02 |
| A start at a terminal with no `config.json` offers configure; without a terminal it refuses as today | Softov, 2026-09-29, "Both"; 2026-09-30: "then start could ask for configuration.... not configured. start?" | 03 |
| No flags for configure's questions yet; start flags, `plugin install` and `plugin config` serve a script | Softov, 2026-09-30, asked about a non-interactive configure: "Later" | - |
| The trust question's Enter is No (`[y/N]`); a folder is served only on a typed yes | Softov, 2026-10-02, asked which answer Enter picks: "No" | 04 |
| A backend already configured and answered No is switched off (`enabled: false`), its options kept, as `plugin disable` does | Softov, 2026-10-02, asked what No does to a configured backend: "Switch it off" | 02 |
| A literal `connectionToken` is an existing token: Enter keeps it, moved into the token file | the row above: "an existing token is kept by default" | 02 |

## Proposed architecture

- **Data flow** - one `ask(label, current)` over `readline/promises` on a TTY; configure reads `config.json` through `readEntry`, asks, writes through `writeEntry`, then `installPlugins` for the backends chosen that are not installed.
- **Layer responsibilities** - server only.
- **Source-of-truth files** - `CREATE: packages/server/src/commands/configure.ts`, `CREATE: packages/server/src/ask.ts`

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A question at the terminal, with its default](task-01-a-question-with-its-default.md) | done | - |
| [02 - `ahpd configure`](task-02-ahpd-configure.md) | done | 01 |
| [03 - A start with no configuration offers configure](task-03-a-start-with-no-configuration-offers-configure.md) | done | 02 |
| [04 - A start in an unserved folder asks to trust it, and `--no-cwd`](task-04-a-start-in-an-unserved-folder-asks.md) | done | 01 |
| [05 - Docs](task-05-docs.md) | done | 02, 03, 04 |

## Risks and tradeoffs

- A question must never block a service or a script: every prompt checks `process.stdin.isTTY` and `process.stdout.isTTY`, and none runs over HTTP.
- `writeEntry` rewrites `config.json` as two-space JSON, as `plugin install` already does.

## Resume state

- **Done so far:** built 2026-10-02, see [implemented.md](implemented.md) and [deferred.md](deferred.md).

## Final verification checklist

- [ ] In an empty `XDG_CONFIG_HOME`, `ahpd configure` with Enter at every question writes a `config.json` that starts, and installs `@ahpd/agent-claude`.
- [x] Run again, it shows every value it wrote as the default.
- [ ] `ahpd start` in `/tmp/new` asks to trust it; yes adds it to `paths`; `ahpd start --no-cwd` there asks nothing.
- [x] `ahpd start < /dev/null` with no configuration refuses as today.
- [x] `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.
- [x] `plans/index.md` updated.
