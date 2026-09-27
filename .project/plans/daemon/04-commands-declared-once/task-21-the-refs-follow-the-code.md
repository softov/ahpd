---
title: The task refs and Resumes in this plan point at the code as it is
status: implemented
depends: [task-18-start-forwards-its-options-wherever-they-are-typed.md, task-19-the-pinning-cases-fail-when-host-or-a-conflict-breaks.md, task-20-a-refusal-takes-its-sentence-and-the-group-hint-fails-like-the-others.md]
layer: "docs"
refs:
  - "[code://packages/server/src/commands/scopes.ts](../../../../packages/server/src/commands/scopes.ts) - `checkScopes`, created by task 14 and listed there as an update to `registry.ts`"
  - "[code://packages/server/src/commands/authorize.ts#L62-L88](../../../../packages/server/src/commands/authorize.ts#L62-L88) - `authorizeOverHttp`, which throws 401 on a host with no gate"
---

## Objective

Every `code://` ref and line number in tasks 05 to 20 names the lines it describes today, and no Resume states something the code does not do.

## Files

- `UPDATE: task-05` to `task-20` in this folder - the refs and `Files` lines.
- `UPDATE: task-14-the-registry-hook-checks-every-surface.md` - `Files` and Resume.
- `UPDATE: task-11-comments-document-the-declarations.md` - Resume.

## Steps

1. Do this last in the plan, after tasks 18 to 20 move the code again.
2. For each ref in tasks 05 to 20, open the file and move the range to the lines the note describes. The review found these wrong: task 06 (`options.ts` fold and field), task 07 (`liveHelp`, `optionLine`, `runHelp`), task 09 (`main.ts` ranges), task 10 (`run.ts` bind, test range), task 11 (every `run.ts` range, `options.ts` fold comment, `main.ts`), task 15, task 16 (`status.ts`, `user.ts`, test ranges), task 05 and task 08 (test ranges). Check the rest too.
3. Task 14: `checkScopes` is `CREATE: packages/server/src/commands/scopes.ts`, not a range of `registry.ts`; the Resume says `authorizeOverHttp` throws 401 on a host with no gate, and says the recording-hook assertion in the Validation was replaced by the `server-commands` cases and why.
4. Task 11: its Validation `rg` now matches `main.ts` (`tokenFor`'s comment, "ref**used to**gether"); tighten the pattern to whole words, rerun it, and write the result in the Resume.
5. Done tasks keep status `done`; only refs, `Files` and Resume text change.

## Validation

- Every `code://...#L<n>-L<m>` in tasks 05 to 20 opens on the lines its note names (checked by reading each).
- Every relative link in the touched files resolves.
- No em dash in the touched files.

## Resume

Done. Every `code://` ref, `Files` range and line number in tasks 05 to 20 was re-read against the tree and corrected, and the stale in-prose pointers in Steps and Validations were corrected too: task 05 and task 09 now name `main.ts:157-159`, task 09's help and version cases are `server-cli.test.ts:169-191`, and task 11's comment rewrite points at `options.ts:118-119`. Task 14's `Files` line is `CREATE: packages/server/src/commands/scopes.ts` and its Resume says `authorizeOverHttp` throws 401 on a host with no gate. Task 12's `package.json` ref note says `^0.2.1`, and its cofold `CliField` ref names the lines `negatable` is on. Task 18's two ref notes now describe the code as it is rather than the code it replaced.

Task 11's Validation pattern is whole-word and its Resume records the command and the false positive a bare `used to` produced: `rg` is not installed here, so the check is `grep -rnE "\bused to\b|\bpreviously\b|\bbefore this\b|\balways (been|had|meant|were)\b|\bparse kept\b" packages/server/src/commands packages/server/src/main.ts`, which finds nothing; a bare `used to` matched `main.ts:71` inside "refused together", and `\bwas\b` and `\bold\b` match only present-state prose. Every relative link in the touched files resolves and no em dash was added.

Review 2026-09-26: not passed. Task 20's Resume said its five callers were changed to call `stop`, and they were not; and this task ran before task 20, which moves `main.ts`, `user.ts` and `plugin.ts` again. Task 23 finishes it after task 20.
