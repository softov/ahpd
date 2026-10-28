---
title: The host says a command's terminal as it opens
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/terminals.ts](../../../../packages/sdk/src/host/terminals.ts) - `commanded` and `heldTerminals`, which this task changes"
  - "[code://packages/sdk/test/host-terminals.test.ts](../../../../packages/sdk/test/host-terminals.test.ts) - the cases for a command typed into a conversation"
---

## Objective

`run` tells a backend a `!` command's terminal as soon as it opens, with its name and whether it is a pseudoterminal.
`Ran` and the handle of a terminal a backend opens say whether it is a pseudoterminal.

## Files

- `UPDATE: packages/sdk/src/types/session.ts:337-348` - `CommandTerminal`, and `isPty` on `Ran`.
- `UPDATE: packages/sdk/src/types/session.ts:522` - `run` takes the terminal's callback as a second argument.
- `UPDATE: packages/sdk/src/types/index.ts:19` - exports `CommandTerminal`.
- `UPDATE: packages/sdk/src/types/terminals.ts:216-250` - `isPty` on `OpenedTerminal`.
- `UPDATE: packages/sdk/src/host/terminals.ts:22` - `commanded` takes the callback.
- `UPDATE: packages/sdk/src/host/terminals.ts:95-145` - `commanded` calls it when the terminal opens, and `Ran` says `isPty`.
- `UPDATE: packages/sdk/src/host/terminals.ts:186-255` - the handle says `isPty`.
- `UPDATE: packages/sdk/src/host/lifecycle.ts:1381-1387` - the host hands the callback through.
- `CREATE: packages/sdk/test/support/pty.ts` - the fake pseudoterminal, which can also exit.
- `UPDATE: packages/sdk/test/pty.test.ts` - the store's suite uses the shared fake.
- `UPDATE: packages/sdk/test/host-terminals.test.ts` - a command under a pseudoterminal, and a terminal a backend opens.
- `UPDATE: docs/sdk/TERMINALS.md:41` - the call names its terminal as it opens, and says whether it is a pseudoterminal.
- `UPDATE: docs/sdk/AHP.md:272` - this host sends `chat/toolCallContentChanged` with a `!` command's terminal.
- `UPDATE: CHANGELOG.md` - the entries for this plan.

## Steps

1. Add `CommandTerminal` with `uri` and an optional `isPty`, and export it.
2. Add an optional `isPty` to `Ran` and to `OpenedTerminal`.
3. Give `run` an optional second argument that takes a `CommandTerminal`.
4. In `commanded`, call it once the terminal is in the host's map.
5. In `commanded`, put the terminal's `isPty` on `Ran`.
6. In `heldTerminals`, put the terminal's `isPty` on the handle.
7. Pass the callback from the host's `run` to `commanded`.
8. Move the fake pseudoterminal to `test/support/pty.ts`, with an `exit`, and use it in the store's suite.
9. Add the cases, and correct the docs and the changelog.

## Validation

- Test that a `!` command under a pseudoterminal tells the backend its terminal before `Ran`, with `isPty: true`.
- Test that `Ran` says `isPty: true` under a pseudoterminal and `isPty: false` on pipes.
- Test that the handle of a terminal a backend opens says `isPty`.
- Run the cases on the host before this change, and see them fail.

## Resume

Done 2026-10-27.
`commanded` calls `opened` once the terminal is a channel, and `Ran` and the handle say `isPty`.
`RunCommand` names the type of `run`, and the fake pseudoterminal is in `test/support/pty.ts`.
The three cases fail before this change, and pass after it.
