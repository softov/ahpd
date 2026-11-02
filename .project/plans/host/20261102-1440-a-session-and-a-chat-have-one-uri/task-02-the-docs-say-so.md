---
title: The docs say so
status: todo
depends:
  - task-01-the-host-answers-one-uri.md
layer: docs
refs:
  - "[code://docs/sdk/AHP.md#L615-L668](../../../../docs/sdk/AHP.md#L615-L668) - the default chat's role and the session URIs"
  - "[code://docs/sdk/SESSIONS.md#L18](../../../../docs/sdk/SESSIONS.md#L18) - how a session is named"
  - "[code://docs/sdk/CHATS.md#L21](../../../../docs/sdk/CHATS.md#L21) - the default chat's role"
  - "[code://docs/sdk/AUTHENTICATION.md#L78](../../../../docs/sdk/AUTHENTICATION.md#L78) - the sessions a token is spent on"
---

## Objective

The docs say a session and a chat have one URI, and what an older VS Code window is shown.

## Files

- `UPDATE: docs/sdk/AHP.md` - the session URIs section, the default chat's role, and the rows for `fetchTurns`, `authenticate` and `auth/required`.
- `UPDATE: docs/sdk/SESSIONS.md` - a session is held under the URI it was created with.
- `UPDATE: docs/sdk/CHATS.md` - the default role moves, and the URI of the chat that held it stays that chat's.
- `UPDATE: docs/sdk/AUTHENTICATION.md` - a token is spent on the sessions a connection watches.

## Steps

1. Rewrite the session URIs section of `AHP.md` from the code: one URI, the older window, and a tool's new session.
2. Rewrite the default chat paragraph of `AHP.md` and the role in `CHATS.md` without the re-pointing.
3. Rewrite the `fetchTurns`, `authenticate` and `auth/required` rows of `AHP.md` without the spellings.
4. Rewrite the naming paragraph of `SESSIONS.md` and the token paragraph of `AUTHENTICATION.md`.
5. Search the docs for "spelling" and "alias" again, and read each hit against the code.

## Validation

- Each changed sentence matches the code of task 01.
- `node .agents/skills/do-spec/scripts/lint-prose.mjs` is clean on this plan.

## Resume

Not started.
