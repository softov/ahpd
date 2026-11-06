---
title: The docs name a person's tokens
status: done
depends: [task-04-the-token-commands.md, task-05-the-token-methods-over-ahp.md]
layer: docs
refs:
  - "[code://docs/server/USERS.md#L13-L32](../../../../docs/server/USERS.md#L13-L32) - \"Add a person\" and the table of `ahpd user` commands"
  - "[code://docs/server/REMOTE.md#L79-L95](../../../../docs/server/REMOTE.md#L79-L95) - \"Who may run what\", one row per command"
  - "[code://docs/server/PROXY.md#L42](../../../../docs/server/PROXY.md#L42) - the proxy grants, where a proxy-only token is the use case"
  - "[code://docs/sdk/AUTHENTICATION.md#L53-L70](../../../../docs/sdk/AUTHENTICATION.md#L53-L70) - \"A person's token\""
  - "[code://docs/sdk/AUTHENTICATION.md#L271-L302](../../../../docs/sdk/AUTHENTICATION.md#L271-L302) - the configuration keys and the grants table"
  - "[code://docs/sdk/USERS.md#L279-L321](../../../../docs/sdk/USERS.md#L279-L321) - \"People as channels and commands\", the methods a client sends"
  - "[code://docs/sdk/HOST.md#L91](../../../../docs/sdk/HOST.md#L91) - the keys about who may connect"
---

## Objective

The docs say how a person mints, lists and revokes tokens of their own, what a token may hold, and how the operator manages them.
The docs name the `tokensPerPerson` key and the three AHP methods.

## Files

- `UPDATE: docs/server/USERS.md:13-32` - add a section "Tokens of their own" after "Add a person", and three rows to the commands table.
- `UPDATE: docs/server/REMOTE.md:79-95` - add a row for `token mint`, `token list` and `token rm`: their own, and `user:write` for another's.
- `UPDATE: docs/server/PROXY.md:42` - add an example of a `proxy:write` token for another computer.
- `UPDATE: docs/sdk/AUTHENTICATION.md:53-70` - say that a minted token signs in as its person, with only the grants that both hold.
- `UPDATE: docs/sdk/AUTHENTICATION.md:271-302` - add the `tokensPerPerson` key, and a row for the token commands in the grants table.
- `UPDATE: docs/sdk/USERS.md:279-321` - add a section on the three `x-ahpd/tokens/*` methods, their params and their answers.
- `UPDATE: docs/sdk/HOST.md:91` - add `tokensPerPerson` to the keys about who may connect, and change "Seven" to "Eight".

## Steps

1. Keep the style of each file: `docs/sdk/USERS.md` wraps at 80 columns, and the other files do not wrap.
2. In `docs/server/USERS.md`, show `ahpd token mint --grant proxy:write --label laptop` and its output.
3. Say that the command shows the secret once, and that the host keeps only its hash.
4. Say that a token without `--grant` holds every grant of its person.
5. Say that a token never holds a grant its person does not hold, now or later.
6. Say that `--expires` is optional, and that a token has no expiry by default.
7. Say that a revoked or expired token fails on the next call, with no reconnection.
8. Say that `ahpd user token` still mints the full token, and that the minted tokens stay when it does.
9. Say that a minted token cannot mint, list or revoke tokens.
10. Say that `ahpd user rm` also removes the person's tokens.
11. Name the tokens file and its default place beside the users file.
12. Run `pnpm -s docs:build` and fix each dead link it reports.
13. Set this task and the plan's Tasks table to `implemented`.

## Validation

- `pnpm -s docs:build` passes with no dead link.
- Each command in the docs runs as written against a daemon with a users file, checked by hand.

## Resume

- **Done so far:** every step. `docs/server/USERS.md` has a "Tokens of their own" section and three rows in the commands table. `docs/server/REMOTE.md` has the row for the three commands. `docs/server/PROXY.md` shows a `proxy:write` token for another computer. `docs/sdk/AUTHENTICATION.md` says what a minted token is and adds the key and the grants row. `docs/sdk/USERS.md` documents the three `x-ahpd/tokens/*` methods, their params and their answers. `docs/sdk/HOST.md` says Eight keys and names `tokensPerPerson`. `pnpm -s docs:build` passes with no dead link.
- **Next action:** none; the plan's tasks are all implemented.
- **Open questions:** none.
- **Watch out for:**
  - The server docs do not wrap; `docs/sdk/USERS.md` still wraps at 80, and the new paragraph there is wrapped to match.
  - The prose lint reports pre-existing long sentences in `docs/server/REMOTE.md`, `docs/server/PROXY.md`, `docs/sdk/AUTHENTICATION.md`, `docs/sdk/USERS.md` and `docs/sdk/HOST.md`; every sentence this task added passes. Reformatting the rest was left alone, as the writing rules say.
  - The commands in the docs are the ones `token-command.test.ts` runs at the terminal and over `/api`, output included.
