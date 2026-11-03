---
title: The persona is never dropped
status: todo
depends: [task-02-the-persona-is-read-from-agents-md.md]
layer: "packages/bot"
refs:
  - "[code://packages/bot/src/store.ts#L230-L260](../../../../packages/bot/src/store.ts#L230-L260) - the persona move, which puts the record back without a check on the file"
  - "[code://packages/bot/src/folder.ts#L85-L120](../../../../packages/bot/src/folder.ts#L85-L120) - `makeFolder` keeps an existing file, and `readAgentsFile` answers nothing for a file it cannot read"
  - "[code://packages/bot/src/provider.ts#L835-L845](../../../../packages/bot/src/provider.ts#L835-L845) - a make calls `makeFolder`"
---

## Objective

A load moves a persona out of a record only after the file holds it.
A make over a folder that already has an `AGENTS.md` writes the UI's parts into that file.

## Files

- `UPDATE: packages/bot/src/folder.ts:85-120` - tell a missing file from a file this host cannot read.
- `UPDATE: packages/bot/src/store.ts:230-260` - put the record back only after the file reads back with the parts.
- `UPDATE: packages/bot/src/provider.ts:835-845` - write the parts into an existing file on a make.
- `UPDATE: packages/bot/test/bot-store.test.ts` - an unreadable file during the move.
- `UPDATE: packages/bot/test/bot-provider.test.ts` - a make over an existing `AGENTS.md`.

## Steps

1. Make `readAgentsFile` return a missing result for `ENOENT` and an error result for every other failure.
2. In the move, keep the record for a file that the host cannot read.
3. Report the slug and the error.
4. After the move writes the file, read it again, and put the record back only when the parts match.
5. In a make, call `writeAgentsFile` when the folder already has an `AGENTS.md`.
6. Keep the bot's other sections and keys in that file, as an edit does.
7. Correct the comment at `store.ts:234-237` to say what the code checks.
8. Add the tests named in *Files*, with a mode-000 file and a folder in place of the file.

## Validation

- `packages/bot/test/bot-store.test.ts`: a load with an unreadable `AGENTS.md` keeps the persona in the record and gives a problem line.
- `packages/bot/test/bot-provider.test.ts`: a make over an old `AGENTS.md` reads back the UI's parts.
- `packages/bot/test/bot-provider.test.ts`: the old file's other sections stay.
- Run `pnpm --filter @ahpd/bot test` alone. Expect a pass.

## Resume

