---
title: A Claude session runs on a preset, and the ahpd-only chips move into it
domain: claude
status: active
priority: high
created: 2026-09-29
revalidated: 2026-09-29
requires:
  - plans/host/31-a-sessions-config-outlives-a-restart/plan.md
decisions:
  - decisions/claude-options-are-declared-once-for-sessions-and-presets.md
  - decisions/claude-approvals-keeps-dont-ask.md
refs:
  - "[code://packages/agent-claude/src/plugin.ts#L30-L64](../../../../packages/agent-claude/src/plugin.ts#L30-L64) - `optionsSchema`, `optionsOf` and `apply`"
  - "[code://packages/agent-claude/src/claude.ts#L151-L332](../../../../packages/agent-claude/src/claude.ts#L151-L332) - `schema()` and `defaults()`: `outputStyle` 221-233, `thinking` 235-244, `sandboxEnabled` 254-263"
  - "[code://packages/agent-claude/src/claude.ts#L81-L88](../../../../packages/agent-claude/src/claude.ts#L81-L88) - `ClaudeOptions.workerStop`, the way an option reaches a session"
  - "[code://packages/agent-claude/src/session.ts#L2009-L2153](../../../../packages/agent-claude/src/session.ts#L2009-L2153) - `query()`: `sandboxOf` at 2092, `thinking` at 2149-2150"
  - "[code://packages/agent-claude/src/session.ts#L2482-L2488](../../../../packages/agent-claude/src/session.ts#L2482-L2488) - `outputStyle` through `applyFlagSettings`"
  - "[code://packages/agent-claude/src/session.ts#L2962-L3026](../../../../packages/agent-claude/src/session.ts#L2962-L3026) - the live `setConfig` paths"
  - "[code://.project/decisions/permission-modes-live-in-the-harness.md](../../../decisions/permission-modes-live-in-the-harness.md) - line 28 says the window draws six modes; it draws five"
---

## Goal

An operator writes named presets of Claude options in agent-claude's options, and every Claude session runs on one of them.
With one preset there is nothing to choose; with two or more the new-session screen offers `preset`, so a new option can be tried in one session without touching the others.
Output style, thinking and sandbox leave the composer and are preset fields, so Claude's chips match VS Code's except for `dontAsk`.

## Reconnaissance

The files read are the `refs` above.

### Runtime path

```
config.json plugins[agent-claude].options.presets -> optionsSchema check at load -> ClaudeOptions.presets
  -> schema(): preset enum when there are two or more -> createSession(settings.preset)
  -> session.ts: the preset's fields through their declarations -> query({ ... })
```

### Gaps

- `outputStyle`, `thinking` and `sandboxEnabled` are composer keys VS Code's Claude host does not have.
- Each key's schema and its translation into `query()` are written in two places.
- An operator cannot set any Claude option for every session, or for some.

## Decisions locked in

| Decision | Task |
| --- | --- |
| [A Claude option is declared once, and both the session schema and the preset schema are made from it](../../../decisions/claude-options-are-declared-once-for-sessions-and-presets.md) | 01 |
| [Claude's approval modes keep dontAsk, which VS Code's Claude host leaves out](../../../decisions/claude-approvals-keeps-dont-ask.md) | 03 |

| What | Source | Task |
| --- | --- | --- |
| The named sets are called presets, the word acp/05 uses for a named bundle of agent options | Softov, 2026-09-29, asked "is "preset" better?": "preset" | 02 |
| One preset: no `preset` key; two or more: `preset` is a session key listing their names, fixed at creation | Softov, 2026-09-29: "claude could expose a 'profile'... if only one its that one... if not.. then expose the profile names" | 02 |
| No presets configured is one empty preset, so today's install behaves as it does | (defaulted: an upgrade must not need a config change) | 02 |
| The default preset is the first one written | (defaulted: JSON keeps the order the operator wrote) | 02 |
| A session whose stored preset was removed or renamed runs on the default | Softov, 2026-09-29; built in host/31 task 02 | 02 |
| The first fields are `sandbox`, `thinking`, `outputStyle`, `env` and `extraArgs`; any other SDK option is a new declaration | Softov, 2026-09-29, asked "What can a Claude preset hold?": "Names fields" | 01 |
| `outputStyle`, `thinking` and `sandboxEnabled` leave the session schema | Softov, 2026-09-29: "Move, but keep dontAsk" | 03 |

## Proposed architecture

- **Data flow** - a declaration is `{ schema, toQuery(value, options) }`; `presetSchema` lists the declared fields, `schema()` adds `preset` when there are two or more, and `createSession` resolves the preset's values through each field's `toQuery`.
- **State flow** - the session stores only the preset's name (host/31); the preset's values are read from the loaded options when the session starts or resumes.
- **Layer responsibilities** - agent-claude only.
- **Source-of-truth files** - `CREATE: packages/agent-claude/src/options.ts`, [`code://packages/agent-claude/src/plugin.ts`](../../../../packages/agent-claude/src/plugin.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - Each Claude option is one declaration](task-01-each-option-is-one-declaration.md) | done | - |
| [02 - Presets, and the `preset` key](task-02-presets-and-the-preset-key.md) | done | 01, host/31 |
| [03 - The ahpd-only chips move into presets](task-03-the-chips-move-into-presets.md) | implemented | 02 |
| [04 - Docs, and the six-modes line corrected](task-04-docs.md) | done | 03 |

## Risks and tradeoffs

- A preset's `outputStyle` cannot be checked against the styles the CLI reports, which are only known once it runs; an unknown style is what the CLI does with it, and the plugin logs it.
- Sandbox was changeable during a session and becomes fixed at creation; a person who wants another picks another preset for a new session.

## Resume state

- **Done so far:** tasks 01, 02 and 04 done 2026-10-02. Task 03 is implemented; the schema no longer declares `outputStyle`, `thinking` or `sandboxEnabled`.
- **Next action:** Softov's check in ahpapp that a Claude composer draws none of the three chips; then task 03 is done and the plan closes.
- **Open questions:** none.
- **Watch out for:** a preset's `env` is laid under a signed-in credential, and `null` in it unsets a variable. A stored `thinking` or `sandboxEnabled` from before is kept and no longer read.

## Final verification checklist

- [ ] With no presets, a session starts as it does today, and no `preset` key is offered.
- [ ] With `presets: { work: {}, test: { thinking: "disabled" } }`, ahpapp offers `preset`; a `test` session runs without thinking and a `work` one with it.
- [ ] Removing `test` and restarting: a `test` session resumes on `work`.
- [ ] The composer shows no Output style, Thinking or Sandbox chip; Approvals keeps Don't Ask.
- [ ] `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.
- [ ] `plans/index.md` updated.
