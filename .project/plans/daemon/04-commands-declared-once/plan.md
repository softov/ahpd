---
title: ahpd's commands are declared once, and the CLI is rendered from them
domain: daemon
status: built
priority: medium
created: 2026-09-26
revalidated: 2026-09-26
requires:
  - plans/daemon/03-ahpd-plugin-install/plan.md
changes: []
creates: []
decisions:
  - decisions/ahpd-commands-are-declared-with-cofold-commands.md
  - decisions/a-daemon-flag-is-declared-by-what-it-turns-on.md
  - decisions/ahpd-refuses-strictly-and-names-the-sub-commands.md
  - decisions/an-untyped-flag-stays-absent-in-cofold-input.md
refs:
  - "git://7a7e9d1 - packages/server/src/main.ts before the migration: the hand-written flag parser and the verbs `start`, `stop`, `status`, `config`, `user list|add|rm|token`, `plugin list|install|remove`"
  - "[code://packages/server/src/commands](../../../../packages/server/src/commands) - the declarations: one file per verb, the flags in `options.ts`"
  - "[code://packages/server/src/main.ts](../../../../packages/server/src/main.ts) - the entry: the `Program`, the `run` word for a bare line, `liveHelp`"
  - "[code://packages/server/test/server-cli.test.ts](../../../../packages/server/test/server-cli.test.ts) - the pinning cases, as a process"
  - "[code://packages/sdk/src/host.ts#L143](../../../../packages/sdk/src/host.ts#L143) - `NEEDS`, the grant pairs a command's `scopes` reuse"
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
| [ahpd's commands are declared once, with @cofold/commands](../../../decisions/ahpd-commands-are-declared-with-cofold-commands.md) | 02, 03, 14 |
| [A daemon flag is declared by what it turns on, and --no-X turns it off](../../../decisions/a-daemon-flag-is-declared-by-what-it-turns-on.md) | 06 |
| [ahpd keeps cofold's strict refusals, and a verb with no sub-command names its sub-commands](../../../decisions/ahpd-refuses-strictly-and-names-the-sub-commands.md) | 15 |
| [A boolean flag nobody typed stays absent in cofold's canonical input](../../../decisions/an-untyped-flag-stays-absent-in-cofold-input.md) | 17, 06 |

| What | Source | Task |
| --- | --- | --- |
| Behaviour is pinned by tests before anything moves | the migration touches every flag | 01 |
| A command's `scopes` are grant pairs as `NEEDS` uses them; which pair each command needs is set by [daemon/05](../05-an-http-api/plan.md) | Softov, 2026-09-26: "the same permission control already existing" | 02 |
| `start` forwards the words after `start`, wherever it appears on the line | Softov, 2026-09-26, on the orphaned daemon: a fix, not a fork | 05 |
| npm's output goes to stderr, so stdout is the command's own output | Softov, 2026-09-26, on `plugin install --json` | 08 |
| The CLI still acts on files locally in this plan; talking to a running daemon comes with the HTTP API | `daemon/05` | - |
| Restore those four as longer descriptions or an epilogue; `ahpd --help` never shows `run` and prints the global options once. | Softov, 2026-09-26: "restore some". | 07 |
| `--no-plugins` is declared with `negatable: false`, which `@cofold/commands` 0.2.1 honours, so `--plugins` is an unknown option again. | Softov, 2026-09-26: "Refuse it". | 12, 13 |
| `CliField.negatable` in `@cofold/commands`, released as 0.2.1 on 2026-09-26; ahpd depends on `^0.2.1`. | Softov, 2026-09-26: "Add negatable to cofold". | 12, 06 |
| `serve()` passes what its `authorize` returned to `registry.execute` as `request.actor`, released in `@cofold/remote` 0.3.1 on 2026-09-26. | Softov, 2026-09-26: "serve() passes actor". | 14 |
| A command's options typed before `start` are forwarded to the child like those after it, and only the program's own globals stay with the parent. | the program accepts a command's options before its word, and task 05's objective: the record names the process that is serving | 18 |
| The group hint fails as every other failure does, one `ahpd: ` line and exit 2 in every mode; a JSON shape for failures is [an idea](../../../ideas/failures-have-a-json-shape.md). | Softov, 2026-09-26, asked how `ahpd plugin` with no sub-command should fail: "one... and another latter". | 20 |
| Each handler throws a `CofoldError` that keeps today's exit code (`ArgumentError` for 2, kind `conflict` for 1) and writes only through its context; a failure's sentence moves to stderr as `ahpd: <sentence>`. | Softov, 2026-09-26, asked "How should ahpd's command handlers answer failure, instead of process.exit and process.stderr?": "Throw CofoldError". | 16 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - Every flag and verb has a test that pins what it does](task-01-pin-every-flag-and-verb.md) | done | - |
| [02 - The commands are declared, with their grants](task-02-the-commands-are-declared.md) | done | 01 |
| [03 - main.ts runs through the terminal program](task-03-main-runs-through-the-program.md) | done | 02 |
| [04 - Docs, dependencies and the lockfile](task-04-docs-and-dependencies.md) | done | 03 |
| [05 - start forwards the words after start, wherever it appears](task-05-start-forwards-the-words-after-start.md) | done | 04 |
| [06 - The update check is declared by what it turns on, and its test can fail](task-06-the-update-check-is-declared-by-what-it-turns-on.md) | done | 12, 17 |
| [07 - ahpd --help keeps the sentences a person acts on](task-07-help-keeps-the-sentences-a-person-acts-on.md) | done | 04 |
| [08 - plugin install and remove say each line as it happens, and npm writes to stderr](task-08-plugin-writes-say-each-line-as-it-happens.md) | done | 04 |
| [09 - The bare run completes its flags, and -v and --help are read only where they are flags](task-09-the-bare-run-completes-and-reads-flags-only-as-flags.md) | done | 04 |
| [10 - The pinning tests bind a port and start a daemon](task-10-the-pinning-tests-bind-a-port-and-start.md) | done | 05 |
| [11 - The comments under commands/ document the declarations, and the refs point at them](task-11-comments-document-the-declarations.md) | done | 04 |
| [12 - A cofold field says whether its flag negates, released by Softov](task-12-cofold-fields-say-whether-they-negate.md) | done | 04 |
| [13 - --plugins is an unknown option again](task-13-plugins-is-an-unknown-option.md) | done | 12 |
| [14 - The registry's authorize hook checks a command's scopes on every surface](task-14-the-registry-hook-checks-every-surface.md) | done | 04 |
| [15 - A bare plugin or user names its sub-commands](task-15-a-bare-verb-names-its-sub-commands.md) | done | 04 |
| [16 - The command handlers fail by throwing a cofold error, and never touch the process](task-16-handlers-fail-by-throwing.md) | done | 04 |
| [17 - cofold leaves a boolean flag nobody typed out of the canonical input, released by Softov](task-17-cofold-leaves-an-untyped-flag-out.md) | done | 12 |
| [18 - start forwards its options wherever they are typed, and finds the start that is the word](task-18-start-forwards-its-options-wherever-they-are-typed.md) | done | 05 |
| [19 - The pinning cases fail when --host or a conflict's 409 breaks, and read no personal configuration](task-19-the-pinning-cases-fail-when-host-or-a-conflict-breaks.md) | done | 10, 16 |
| [20 - A refusal takes only its sentence, and the group hint fails like every other failure](task-20-a-refusal-takes-its-sentence-and-the-group-hint-fails-like-the-others.md) | done | 15, 16 |
| [21 - The task refs and Resumes in this plan point at the code as it is](task-21-the-refs-follow-the-code.md) | done | 18, 19, 20 |
| [22 - A start regression leaves no daemon running, and the token case can fail](task-22-a-start-regression-leaves-no-daemon-and-the-token-case-can-fail.md) | done | 18 |
| [23 - The comments and records of this plan say what is true](task-23-the-comments-and-records-say-what-is-true.md) | done | 20 |

## Risks and tradeoffs

- `@cofold/*` at 0.2.0 moves; a breaking change there is a release of both.
- `--stdio` must still write nothing to stdout but the protocol; `@cofold/terminal`'s output modes must not print there.

## Resume state

- **Done so far:** every task is `done`, reviewed by Softov on 2026-09-28; the plan is built, see [implemented.md](implemented.md).
- **Next action:** none.
- **Open questions:** none.
  A JSON shape for failures is [an idea](../../../ideas/failures-have-a-json-shape.md).
- **Watch out for:** task 16 landed before [daemon/05 task 08](../05-an-http-api/task-08-served-commands-act-on-the-daemons-own-options.md), so that task rebases on the throwing handlers; task 14 landed before [daemon/05 task 09](../05-an-http-api/task-09-the-grants-each-command-needs.md), so task 09 applies the grants in the registry's `authorize` hook and `authorizeOverHttp` only identifies; `run` is a hidden command given its word when a line has no command, so the foreground daemon keeps matching `ahpd [options]`; this environment's global pnpm store is read-only, so installs need `--store-dir /tmp/pnpm-store`; the pinning cases set `CI=1`, which silences the update line in every case that does not remove it; [daemon/05](../05-an-http-api/plan.md) changes the scopes `packages/server/test/server-commands.test.ts:59-69` pins, so a scope failure there is daemon/05's to fix.

## Final verification checklist

- [x] Every test from task 01 passes unchanged after task 03.
- [x] `ahpd --help`, `ahpd plugin --help`, `ahpd completion bash` and `ahpd status --json` work.
- [x] `ahpd --stdio` writes only frames to stdout.
- [x] `pnpm test`, `pnpm boundary`, `pnpm install --frozen-lockfile` green.
- [x] `pnpm typecheck` green.
- [x] `ahpd --no-color start ...` starts a daemon that `ahpd status` and `ahpd stop` reach (task 05).
- [x] `updateCheck: true` means the check runs on every surface, and the update-check case runs without `CI` (task 06).
- [x] `ahpd --help` carries the trust warning, the container explanation, the configuration-key paragraph and the `?tkn=`/Bearer presentation, with no `ahpd run` and one global options section (task 07).
- [x] A failed `plugin remove` still shows `plugins -= <name>`, and `plugin install --json` writes only JSON to stdout (task 08).
- [x] `ahpd __complete -- --po` offers `--port`, and a value spelled `-v` is a value (task 09).
- [x] `--port`, `--host` and `start` each have a case that fails when they break (task 10).
- [x] No comment under `commands/` or in `main.ts` narrates history, and no ref names a line range of the old `main.ts` (task 11).
- [x] cofold's field-level `negatable` is released by Softov and ahpd depends on it (task 12).
- [x] `ahpd --plugins` exits 2 with `Unknown option --plugins` (task 13).
- [x] A scoped command is refused by the registry's `authorize` hook on every surface (task 14).
- [x] `ahpd plugin` and `ahpd user` name their sub-commands and exit 2 (task 15).
- [x] `@cofold/commands` leaves an untyped boolean out of the canonical input, released by Softov, and ahpd depends on it (task 17).
- [x] `ahpd --connection-token abc start` serves with that token, and `ahpd --path start start` starts one daemon (task 18).
- [x] The bind cases fail when `--host` or the file's `host` is dropped, a conflict is pinned at 409, and no case reads a personal configuration (task 19).
- [x] `refuse` is gone, and the group hint is one `ahpd: ` line and exit 2 with or without `--json` (task 20).
- [x] Every ref in tasks 05 to 20 names the lines it describes (task 21).
- [x] `docs/DAEMON.md`, `plans/index.md` updated.
