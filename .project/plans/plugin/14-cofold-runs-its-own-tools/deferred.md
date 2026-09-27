---
title: A cofold session has files, shell, web and memory, run by cofold itself - deferred
date: 2026-09-26
---

No editor is driven in these sessions, and cofold's own suite belongs to the repository that holds the tasks that landed there.

| What | Why it waits | Where it goes |
| --- | --- | --- |
| VS Code: a cofold session reads a file, edits it so the edit shows as a change, and runs `ls` drawn as a terminal | no editor is driven here; the tools cases pin the calls, the changeset and the terminal drawing | the next time a person drives a cofold session in VS Code |
| VS Code: in the default mode the edit and the command ask first, and in `acceptEdits` the edit does not | the same; the mode table covers every mode and every class of call | the next time a person drives a cofold session in VS Code |
| VS Code: in the default mode a read of a file outside the workspace asks first | the same; the mode table has a read outside the workspace | the next time a person drives a cofold session in VS Code |
| VS Code: a `shell_exec` row shows the bare command, not JSON | the same; the case in `agent-cofold-tools.test.ts` pins the `toolInput` the row is drawn from, and the row itself was not seen | the next time a person drives a cofold session in VS Code |
| `pnpm test` in `/github/cofold` | tasks 05, 06 and 17 landed there and were released as `@cofold/agents` 0.1.1, `@cofold/tools` 0.1.0 and `@cofold/tools` 0.1.1 (cofold `d9d229e`); the run belongs to that repository | cofold's own suite, run in `/github/cofold` |
| The write lands on the file the check allowed: a symlink swapped between `resolveWithin` and cofold's write, and a write to a file that changed since it was read | Softov chose a plan of its own on 2026-09-27, so this plan closes as planned; the approach is still to be chosen | [plugin/22](../22-a-cofold-write-lands-where-it-was-allowed/plan.md) |
