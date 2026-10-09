---
title: A tool row is titled by the subject cofold sends
status: todo
depends: [task-01-ahpd-takes-the-cofold-release.md]
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/tools.ts#L165-L224](../../../../packages/agent-cofold/src/tools.ts#L165-L224) - `toolMetaOf` stays; `intentionOf`, `toolInputOf` and `describe` hold the per-name subject table"
  - "[code://packages/agent-cofold/src/tools.ts#L286-L297](../../../../packages/agent-cofold/src/tools.ts#L286-L297) - `toolReadyAction`, which calls `describe` and `toolInputOf`"
  - "[code://packages/agent-cofold/src/mapping.ts#L149-L168](../../../../packages/agent-cofold/src/mapping.ts#L149-L168) - `OpenCall`, which gets the subject"
  - "[code://packages/agent-cofold/src/mapping.ts#L434-L515](../../../../packages/agent-cofold/src/mapping.ts#L434-L515) - `tool.proposed` and `approval.requested`"
  - "[code://packages/agent-cofold/src/mapping.ts#L579-L660](../../../../packages/agent-cofold/src/mapping.ts#L579-L660) - `tool.started` and the later `describe` calls"
  - "[code://packages/agent-cofold/src/transcript.ts#L80-L87](../../../../packages/agent-cofold/src/transcript.ts#L80-L87) - `invocationOf`"
  - "[code://packages/agent-cofold/src/transcript.ts#L231-L240](../../../../packages/agent-cofold/src/transcript.ts#L231-L240) - `turnsOf` reads each run's stored events"
  - "[code://packages/agent-cofold/src/transcript.ts#L349](../../../../packages/agent-cofold/src/transcript.ts#L349) - the live title of a call"
  - "[code://packages/agent-cofold/src/turnagent.ts#L198-L212](../../../../packages/agent-cofold/src/turnagent.ts#L198-L212) - a client tool's row, titled by `describe`"
  - file:///github/cofold/.project/plans/tools/02-tools-declare-what-they-touch/deferred.md - the ahpd row this task closes
---

## Objective

The title, the intention and the shell input of a tool row come from `tool.proposed.subject`.
ahpd no longer keeps a table of cofold tool names for them; `toolMetaOf` keeps the terminal kind, which cofold does not send.

## Files

- `UPDATE: packages/agent-cofold/src/mapping.ts:149-168` - `OpenCall` holds `subject?: string`.
- `UPDATE: packages/agent-cofold/src/mapping.ts:434-515` - `tool.proposed` stores `event.subject` on the call, and both events title it from the subject.
- `UPDATE: packages/agent-cofold/src/mapping.ts:579-660` - each `describe` call passes the stored subject.
- `UPDATE: packages/agent-cofold/src/tools.ts:165-224` - `describe(name, subject)` returns the subject, else the name; `intentionOf` and `toolInputOf` read the subject for `shell_exec`.
- `UPDATE: packages/agent-cofold/src/tools.ts:286-297` - `toolReadyAction` takes the subject.
- `UPDATE: packages/agent-cofold/src/transcript.ts:80-87` - `invocationOf` takes the subject.
- `UPDATE: packages/agent-cofold/src/transcript.ts:231-240` - `turnsOf` collects each call's subject from its stored `tool.proposed`.
- `UPDATE: packages/agent-cofold/src/transcript.ts:349` - the live title uses the collected subject.
- `UPDATE: packages/agent-cofold/src/turnagent.ts:198-212` - a client tool has no subject, so its row is titled by its name.
- `UPDATE: packages/agent-cofold/test/agent-cofold-tools.test.ts:113` - the title cases expect cofold's subject per tool.
- `UPDATE: packages/agent-cofold/test/agent-cofold-tools.test.ts:174` - the shell input reads the subject.

## Steps

1. Read cofold tools 0.3.0 `subject` for each tool, and list the title each one now gives.
2. Add `subject` to `OpenCall`, and set it from `tool.proposed`.
3. Change `describe`, `intentionOf` and `toolInputOf` to take the subject.
4. Delete the per-name branches that the subject replaces.
5. Pass the subject at every `describe`, `intentionOf` and `toolInputOf` call site.
6. Collect each call's subject in `turnsOf` from the stored `tool.proposed` events.
7. Title a call without a subject by its tool name, as for a run stored before 0.2.
8. Add a case: the row of a host tool with a cofold tool's name shows that name.
9. Add a case: a `memory_read` row shows its file, or `index` when the input has no path.
10. Add a case: a reopened session shows the same titles as the live one.

## Validation

- `rg "'read_file'|'write_file'|'edit_file'|'web_fetch'|'web_search'|'list_files'|'search_files'" packages/agent-cofold/src/tools.ts` finds only `toolMetaOf`.
- `npx vitest run packages/agent-cofold/test/agent-cofold-tools.test.ts packages/agent-cofold/test/agent-cofold-store.test.ts` passes.

## Resume

- A path tool's subject is relative to the workspace, and absolute outside it; a test that expected the model's spelling changes.
