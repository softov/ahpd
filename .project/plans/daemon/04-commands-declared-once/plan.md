---
title: ahpd's commands are declared once, and the CLI is rendered from them
domain: daemon
status: active
priority: medium
created: 2026-09-26
revalidated: 2026-09-26
requires:
  - plans/daemon/03-ahpd-plugin-install/plan.md
changes: []
creates: []
decisions:
  - decisions/serve-hands-the-principal-to-the-registry-as-actor.md
  - decisions/ahpd-commands-are-declared-with-cofold-commands.md
  - decisions/a-daemon-flag-is-declared-by-what-it-turns-on.md
  - decisions/ahpd-help-keeps-the-sentences-a-person-acts-on.md
  - decisions/a-cofold-field-says-whether-its-flag-negates.md
  - decisions/no-plugins-has-no-positive.md
  - decisions/ahpd-refuses-strictly-and-names-the-sub-commands.md
refs:
  - "git://7a7e9d1 - packages/server/src/main.ts before the migration: the hand-written flag parser and the verbs `start`, `stop`, `status`, `config`, `user list|add|rm|token`, `plugin list|install|remove`"
  - "[code://packages/server/src/commands](../../../../packages/server/src/commands) - the declarations: one file per verb, the flags in `options.ts`"
  - "[code://packages/server/src/main.ts](../../../../packages/server/src/main.ts) - the entry: the `Program`, the `run` word for a bare line, `liveHelp`"
  - "[code://test/server-cli.test.ts](../../../../test/server-cli.test.ts) - the pinning cases, as a process"
  - "[code://packages/sdk/src/host.ts#L141](../../../../packages/sdk/src/host.ts#L141) - `NEEDS`, the grant pairs a command's `scopes` reuse"
  - file:///github/cofold/packages/commands/src/registry.ts - `createRegistry` and `authorize`
  - file:///github/cofold/packages/terminal/src/program.ts - `Program`
  - file:///github/cofold/docs/commands - how a command is declared
---

## Goal

Every ahpd verb and flag is one declaration: `ahpd --help`, `ahpd <verb> --help`, shell completion and `--json` come from it, and each command says which grant it needs.
Nothing a person types today changes meaning.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Gaps

- No test pins every flag and verb; a migration could drop one silently.
- The verbs print their own text; none has `--json`.
- No command says what grant it needs; the CLI acts as whoever runs it, on files.

## Decisions locked in

| Decision | Task |
| --- | --- |
| [serve() hands the principal its authorize resolved to the registry as the actor](../../../decisions/serve-hands-the-principal-to-the-registry-as-actor.md) | 14 |
| [ahpd's commands are declared once, with @cofold/commands](../../../decisions/ahpd-commands-are-declared-with-cofold-commands.md) | 02, 03, 14 |
| [A daemon flag is declared by what it turns on, and --no-X turns it off](../../../decisions/a-daemon-flag-is-declared-by-what-it-turns-on.md) | 06 |
| [ahpd --help keeps the sentences a person acts on, and shows no word nobody types](../../../decisions/ahpd-help-keeps-the-sentences-a-person-acts-on.md) | 07 |
| [A cofold field says whether its flag negates, and ahpd declares updateCheck through it](../../../decisions/a-cofold-field-says-whether-its-flag-negates.md) | 12, 06 |
| [--no-plugins has no positive, so --plugins is an unknown option](../../../decisions/no-plugins-has-no-positive.md) | 12, 13 |
| [ahpd keeps cofold's strict refusals, and a verb with no sub-command names its sub-commands](../../../decisions/ahpd-refuses-strictly-and-names-the-sub-commands.md) | 15 |

| What | Source | Task |
| --- | --- | --- |
| Behaviour is pinned by tests before anything moves | the migration touches every flag | 01 |
| A command's `scopes` are grant pairs as `NEEDS` uses them; which pair each command needs is set by [daemon/05](../05-an-http-api/plan.md) | Softov, 2026-09-26: "the same permission control already existing" | 02 |
| `start` forwards the words after `start`, wherever it appears on the line | Softov, 2026-09-26, on the orphaned daemon: a fix, not a fork | 05 |
| npm's output goes to stderr, so stdout is the command's own output | Softov, 2026-09-26, on `plugin install --json` | 08 |
| The CLI still acts on files locally in this plan; talking to a running daemon comes with the HTTP API | `daemon/05` | - |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - Every flag and verb has a test that pins what it does](task-01-pin-every-flag-and-verb.md) | implemented | - |
| [02 - The commands are declared, with their grants](task-02-the-commands-are-declared.md) | implemented | 01 |
| [03 - main.ts runs through the terminal program](task-03-main-runs-through-the-program.md) | implemented | 02 |
| [04 - Docs, dependencies and the lockfile](task-04-docs-and-dependencies.md) | implemented | 03 |
| [05 - start forwards the words after start, wherever it appears](task-05-start-forwards-the-words-after-start.md) | todo | 04 |
| [06 - The update check is declared by what it turns on, and its test can fail](task-06-the-update-check-is-declared-by-what-it-turns-on.md) | todo | 12 |
| [07 - ahpd --help keeps the sentences a person acts on](task-07-help-keeps-the-sentences-a-person-acts-on.md) | todo | 04 |
| [08 - plugin install and remove say each line as it happens, and npm writes to stderr](task-08-plugin-writes-say-each-line-as-it-happens.md) | todo | 04 |
| [09 - The bare run completes its flags, and -v and --help are read only where they are flags](task-09-the-bare-run-completes-and-reads-flags-only-as-flags.md) | todo | 04 |
| [10 - The pinning tests bind a port and start a daemon](task-10-the-pinning-tests-bind-a-port-and-start.md) | todo | 05 |
| [11 - The comments under commands/ document the declarations, and the refs point at them](task-11-comments-document-the-declarations.md) | todo | 04 |
| [12 - A cofold field says whether its flag negates, released by Softov](task-12-cofold-fields-say-whether-they-negate.md) | done | 04 |
| [13 - --plugins is an unknown option again](task-13-plugins-is-an-unknown-option.md) | todo | 12 |
| [14 - The registry's authorize hook checks a command's scopes on every surface](task-14-the-registry-hook-checks-every-surface.md) | todo | 04 |
| [15 - A bare plugin or user names its sub-commands](task-15-a-bare-verb-names-its-sub-commands.md) | todo | 04 |

## Risks and tradeoffs

- `@cofold/*` at 0.2.0 moves; a breaking change there is a release of both.
- `--stdio` must still write nothing to stdout but the protocol; `@cofold/terminal`'s output modes must not print there.

## Resume state

- **Done so far:** tasks 01 to 04 implemented on 2026-09-26: the pinning cases, the declarations with their scopes, `main.ts` through `@cofold/terminal`'s `Program`, and `docs/DAEMON.md` with the lockfile. Task 12 done: `@cofold/commands` 0.2.1 is released and ahpd depends on `^0.2.1`.
- **Next action:** [task-05-start-forwards-the-words-after-start.md](task-05-start-forwards-the-words-after-start.md).
- **Open questions:** none.
- **Watch out for:** tasks 06 and 13 build on `@cofold/commands` 0.2.1's `negatable`; task 14 and [daemon/05 task 09](../05-an-http-api/task-09-the-grants-each-command-needs.md) touch the same check, so the second to land rebases on the first; `run` is a hidden command given its word when a line has no command, so the foreground daemon keeps matching `ahpd [options]`; this environment's global pnpm store is read-only, so installs need `--store-dir /tmp/pnpm-store`; the pinning cases set `CI=1`, which silences the update line in every case that does not remove it; [daemon/05](../05-an-http-api/plan.md) changes the scopes `test/server-commands.test.ts:41-51` pins, so a scope failure there is daemon/05's to fix.

## Final verification checklist

- [x] Every test from task 01 passes unchanged after task 03.
- [x] `ahpd --help`, `ahpd plugin --help`, `ahpd completion bash` and `ahpd status --json` work.
- [x] `ahpd --stdio` writes only frames to stdout.
- [x] `pnpm test`, `pnpm boundary`, `pnpm install --frozen-lockfile` green.
- [x] `pnpm typecheck` green.
- [ ] `ahpd --no-color start ...` starts a daemon that `ahpd status` and `ahpd stop` reach (task 05).
- [ ] `updateCheck: true` means the check runs on every surface, and the update-check case runs without `CI` (task 06).
- [ ] `ahpd --help` carries the trust warning, the container explanation, the configuration-key paragraph and the `?tkn=`/Bearer presentation, with no `ahpd run` and one global options section (task 07).
- [ ] A failed `plugin remove` still shows `plugins -= <name>`, and `plugin install --json` writes only JSON to stdout (task 08).
- [ ] `ahpd __complete -- --po` offers `--port`, and a value spelled `-v` is a value (task 09).
- [ ] `--port`, `--host` and `start` each have a case that fails when they break (task 10).
- [ ] No comment under `commands/` or in `main.ts` narrates history, and no ref names a line range of the old `main.ts` (task 11).
- [ ] cofold's field-level `negatable` is released by Softov and ahpd depends on it (task 12).
- [ ] `ahpd --plugins` exits 2 with `Unknown option --plugins` (task 13).
- [ ] A scoped command is refused by the registry's `authorize` hook on every surface (task 14).
- [ ] `ahpd plugin` and `ahpd user` name their sub-commands and exit 2 (task 15).
- [ ] `docs/DAEMON.md`, `plans/index.md` updated.
