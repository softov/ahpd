---
title: ahpd's commands are declared once, and the CLI is rendered from them
domain: daemon
status: planned
priority: medium
created: 2026-09-26
revalidated: 2026-09-26
requires:
  - plans/daemon/03-ahpd-plugin-install/plan.md
changes: []
creates: []
decisions:
  - decisions/ahpd-commands-are-declared-with-cofold-commands.md
refs:
  - "[code://packages/server/src/main.ts#L255-L310](../../../../packages/server/src/main.ts#L255-L310) - the flag parser this replaces"
  - "[code://packages/server/src/main.ts#L430-L660](../../../../packages/server/src/main.ts#L430-L660) - the verbs: `start`, `stop`, `status`, `config`, `user list|add|rm|token`, `plugin list|install|remove|enable|disable`"
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
| [ahpd's commands are declared once, with @cofold/commands](../../../decisions/ahpd-commands-are-declared-with-cofold-commands.md) | 02, 03 |

| What | Source | Task |
| --- | --- | --- |
| Behaviour is pinned by tests before anything moves | the migration touches every flag | 01 |
| A command's `scopes` are the grant pairs `NEEDS` uses (`config:write`, `admin`) | Softov, 2026-09-26: "the same permission control already existing" | 02 |
| The CLI still acts on files locally in this plan; talking to a running daemon comes with the HTTP API | `daemon/05` | - |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - Every flag and verb has a test that pins what it does](task-01-pin-every-flag-and-verb.md) | todo | - |
| [02 - The commands are declared, with their grants](task-02-the-commands-are-declared.md) | todo | 01 |
| [03 - main.ts runs through the terminal program](task-03-main-runs-through-the-program.md) | todo | 02 |
| [04 - Docs, dependencies and the lockfile](task-04-docs-and-dependencies.md) | todo | 03 |

## Risks and tradeoffs

- `@cofold/*` at 0.2.0 moves; a breaking change there is a release of both.
- `--stdio` must still write nothing to stdout but the protocol; `@cofold/terminal`'s output modes must not print there.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-pin-every-flag-and-verb.md](task-01-pin-every-flag-and-verb.md).
- **Open questions:** none.
- **Watch out for:** the update check and the daemon record are side effects of `start`; the pinning tests must see them, not only the parsed options.

## Final verification checklist

- [ ] Every test from task 01 passes unchanged after task 03.
- [ ] `ahpd --help`, `ahpd plugin --help`, `ahpd completion bash` and `ahpd status --json` work.
- [ ] `ahpd --stdio` writes only frames to stdout.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm boundary`, `pnpm install --frozen-lockfile` green.
- [ ] `docs/DAEMON.md`, `plans/index.md` updated.
