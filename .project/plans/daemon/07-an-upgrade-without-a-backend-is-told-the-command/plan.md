---
title: A daemon with no backend names the command that installs one, and an upgrade from 0.6 is told why
domain: daemon
status: active
priority: high
created: 2026-09-28
revalidated: 2026-09-28
requires:
  - plans/daemon/03-ahpd-plugin-install/plan.md
changes: []
creates: []
decisions: []
refs:
  - "[code://packages/server/src/commands/run.ts#L396-L410](../../../../packages/server/src/commands/run.ts#L396-L410) - the refusal, which names `npm i` in the configuration directory"
  - "[code://packages/server/test/daemon-backend.test.ts#L58-L90](../../../../packages/server/test/daemon-backend.test.ts#L58-L90) - the case that pins the sentence"
  - "[code://docs/DAEMON.md#L22-L46](../../../../docs/DAEMON.md#L22-L46) - \"It has no backend of its own\", whose quoted sentence is older than the code's"
  - npm://@ahpd/server@0.6.3 - Claude built in, so its configuration names no plugin
---

## Goal

An operator who upgrades from 0.6, where Claude was built in, and whose daemon now refuses to start, is told the one command that brings Claude back, and the docs say why it went.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- Checked on 2026-09-28: 0.6.3 installed in a scratch prefix and run on a scratch configuration served Claude with "plugins none"; the same prefix upgraded to this tree's packed 0.8.0 exited with the refusal; with `@ahpd/agent-claude` installed in the configuration directory and named in `plugins`, it served the same 11 models.
- `ahpd plugin install` installs a package in the configuration directory and adds it to `plugins` unless `--no-enable`.

### Gaps

- The refusal names `npm i` and not `ahpd plugin install`.
- `docs/DAEMON.md` quotes an older sentence and says nothing about 0.6.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| The refusal names `ahpd plugin install @ahpd/agent-claude` first, and `npm i` as the other way. | Softov, 2026-09-28, asked whether the message should name `ahpd plugin install` before tagging 0.8.0: "Fix it before the tag (Recommended)". | 01 |
| `docs/DAEMON.md` quotes the sentence as the code says it and has one note for an upgrade from 0.6. | the same answer | 01 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The refusal names ahpd plugin install, and DAEMON.md says why 0.6 had Claude](task-01-the-refusal-names-plugin-install.md) | implemented | - |

## Risks and tradeoffs

- None.

## Resume state

- **Done so far:** task 01 implemented and awaiting review: the refusal names `ahpd plugin install @ahpd/agent-claude`, with `--config-file <p>` when the daemon was started with one, then `npm i` as the other way; `docs/DAEMON.md` quotes it and has the note for an upgrade from 0.6.
- **Next action:** review task 01, then close the plan.
- **Open questions:** none.
- **Watch out for:** a daemon run with `--config-file` reads another file, so the command it names must carry the same `--config-file` or it would enable the plugin in a file the daemon does not read.

## Final verification checklist

- [ ] The refusal names the command, and a daemon run with `--config-file` names it with that file.
- [ ] `pnpm typecheck`, `pnpm boundary`, `pnpm test` green; `plans/index.md` updated.
