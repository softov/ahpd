---
title: configure offers the web UI
domain: daemon
status: built
priority: medium
created: 2026-10-21
revalidated: 2026-10-21
refs:
  - "[code://packages/server/src/commands/configure.ts#L45-L52](../../../../packages/server/src/commands/configure.ts#L45-L52) - `BACKENDS` and `FIRST`, the packages configure asks about"
  - "[code://packages/server/src/commands/configure.ts#L172-L180](../../../../packages/server/src/commands/configure.ts#L172-L180) - the backend questions, and the switch for a package the file names"
  - "[code://packages/server/src/commands/configure.ts#L294-L307](../../../../packages/server/src/commands/configure.ts#L294-L307) - `installPlugins` with the missing packages"
  - "[code://packages/server/test/server-configure.test.ts](../../../../packages/server/test/server-configure.test.ts) - the configure cases"
  - "[code://docs/server/CONFIGURE.md](../../../../docs/server/CONFIGURE.md) - the configure page"
  - "npm://@ahpd/web@0.6.0 - the web UI, an ahpd plugin with `ahpd.entry`"
---

## Goal

`ahpd configure` asks `Web UI?` after the backend questions, and a Yes installs `@ahpd/web` with the backends.
The install script runs `ahpd configure`, so a one-line install also offers the web UI.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "@ahpd/" scripts/install/install.sh` - the script installs only `@ahpd/server`, and `ahpd configure` installs the plugins.
- `npm view @ahpd/web name version` - `@ahpd/web`, `0.6.0`.
- `installPlugins` installs each package at the newest version whose sdk range admits the daemon, so `@ahpd/web` needs no version of its own.

### Runtime path

```
install.sh -> ahpd configure -> Web UI? -> installPlugins(['@ahpd/web', ...]) -> config.json plugins
```

### Gaps

- `configure` asks only about the backends and the ACP agents, so the web UI is a second command, `ahpd plugin install @ahpd/web`.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Add `@ahpd/web` to the packages the install offers | Softov, 2026-10-21: "also on install script with the others packages... I want to add @ahpd/web as a package." | 01 |
| Enter takes the web UI on a first run | Softov, 2026-10-21: "Yes, install it" | 01 |

## Proposed architecture

- **Data flow** - a list of other plugins beside `BACKENDS`, asked with the same question and the same switch. A Yes adds the package to the missing packages that `installPlugins` installs.
- **Source-of-truth files** - [`code://packages/server/src/commands/configure.ts`](../../../../packages/server/src/commands/configure.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - configure asks about the web UI](task-01-configure-asks-about-the-web-ui.md) | done | - |

## Risks and tradeoffs

- The web UI is not a backend, so a daemon with only the web UI still refuses to start. The backend count stays the same.

## Resume state

- **Done so far:** [task-01](task-01-configure-asks-about-the-web-ui.md) is implemented. `configure` asks `Web UI?` after the backends, and Enter takes it on a first run. A Yes installs `@ahpd/web`, and a No on an entry the file names switches it off. The docs name the question. `server-configure.test.ts` passed 38 of 38. From the repository root, `pnpm -s build`, `pnpm -s typecheck` and `pnpm -s boundary` passed. The full suite passed 6476 tests with 29 skipped (387 files passed, 1 skipped).
- **Next action:** none. The plan is built, and `implemented.md` says what exists.
- **Open questions:** none.
- **Watch out for:** [daemon 37](../37-configure-sets-up-one-pi/plan.md) changed the same file and is also implemented. The web UI is not a backend, so a daemon with only the web UI still refuses to start.
