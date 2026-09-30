---
title: The way cofold's tools close the window between the check and the write is chosen
status: done
depends: []
layer: "tools"
refs:
  - file:///github/cofold/packages/tools/src/files.ts - `write_file`, `edit_file` and `readText`
  - file:///github/cofold/packages/tools/src/paths.ts - `resolveWithin`
  - "[code://packages/agent-cofold/src/session.ts#L37-L51](../../../../packages/agent-cofold/src/session.ts#L37-L51) - ahpd's check"
---

## Objective

The plan's *Decisions locked in* names how cofold's file tools make the written file the checked one, each choice a decision file with Softov's answer, and the plan has the tasks that build it.

## Files

- `UPDATE: .project/plans/plugin/22-a-cofold-write-lands-where-it-was-allowed/plan.md` - the decisions and the tasks.
- `CREATE:` a decision file in `.project/decisions/` for each approach Softov chooses, named after the choice.

## Steps

1. For each candidate, write down in this task's Resume what it closes, what it leaves open and what it costs in Node's `fs`:
   - **Re-check after open:** open the file, then compare the descriptor's `fstat` (device and inode) with the checked real path's `stat`, and refuse on a mismatch before writing through the descriptor.
   - **Open by descriptor:** open with `O_NOFOLLOW`, which refuses a link at the last name only, since `fs` has no `openat`.
   - **Refuse a stale write:** `read_file` records the file's `mtime` and size (or a hash) per session, and `write_file` and `edit_file` refuse a file that changed since, or that exists and was never read, with a sentence that says to read it first.
2. Ask Softov with AskUserQuestion, one decision per question, the recommended option first.
3. Write each answer as a decision file and link it from the plan; add the tasks that build it in cofold and take the release in ahpd; set the plan `planned`.

## Validation

- Every row of the plan's *Decisions locked in* links a decision file that quotes Softov's answer.
- The plan's *Tasks* table has a task per change, each with a Validation that fails first.

## Resume

Done 2026-09-30: Softov chose re-check after open and refusing a stale write, not `O_NOFOLLOW`; the two decision files and tasks 02 to 04 are written.
