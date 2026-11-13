---
title: The docs and the spec say a talk is one session
status: implemented
depends:
  - task-04-a-restart-wakes-the-bot-again.md
  - task-05-the-webhook-picks-its-session-shape.md
layer: "docs"
refs:
  - "[code://docs/plugins/BOTS.md](../../../../docs/plugins/BOTS.md) - the bot's doc, which says the Back is a session"
  - "[code://docs/plugins/WEBHOOKS.md](../../../../docs/plugins/WEBHOOKS.md) - the webhook's doc"
  - "[code://.project/specs/bots.md](../../../../.project/specs/bots.md) - the bot spec"
---

## Objective

The docs and the spec say what the code does.
They cover one session for each bot and person, its Back chat, `bot:chat`, and the two options.

## Files

- `UPDATE: docs/plugins/BOTS.md` - the Front, the Back chat, `bot:chat`, `session` on the read, the restart wake, `secondSession`, and the record without its `session` word.
- `UPDATE: docs/plugins/WEBHOOKS.md` - `threadSessions`.
- `UPDATE: packages/bot/README.md` - the same model, in short.
- `UPDATE: .project/specs/bots.md` - the model and the row `fronts`.
- `UPDATE: .project/plans/bots/00-bots.md` - the glossary and the known gaps.

## Steps

1. Rewrite the Back section of `BOTS.md` for the Back chat.
2. Add `bot:chat`, `session` on the read, the restart wake and `secondSession` to `BOTS.md`.
3. Remove the `session` word from the record table in `BOTS.md`.
4. Add `threadSessions` to `WEBHOOKS.md`.
5. Correct `README.md`, `specs/bots.md` and `00-bots.md` to the same model.

## Validation

- Every option, field and grant the code reads is in the docs, with its default.
- `node <do-spec>/scripts/lint-prose.mjs .project/specs/bots.md .project/plans/bots/00-bots.md` passes.

## Resume

- Written on 2026-11-13. Only the session model of `specs/bots.md` was changed. Its template scenarios were stale before this plan and stay as they were.

