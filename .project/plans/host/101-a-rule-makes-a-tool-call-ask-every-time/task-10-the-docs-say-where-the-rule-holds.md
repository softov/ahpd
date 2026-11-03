---
title: The docs say where the rule holds
status: todo
depends: [task-07-cofold-asks-in-every-mode.md, task-08-the-mcp-door-refuses-a-matched-tool.md, task-09-claude-names-the-server-and-subagent.md]
layer: docs
refs:
  - "[code://docs/sdk/AHP.md#L195-L205](../../../../docs/sdk/AHP.md#L195-L205) - the rule's paragraph, which says it asks in every backend and that the host cannot revoke cofold's memory"
---

## Objective

`docs/sdk/AHP.md` says where the rule holds and where it does not, and the plan's refs point at the current lines.

## Files

- `UPDATE: docs/sdk/AHP.md:195-205` - the rule's reach and its limits.
- `UPDATE: .project/plans/host/101-a-rule-makes-a-tool-call-ask-every-time/plan.md` - the out-of-date refs.
- `UPDATE: .project/plans/host/101-a-rule-makes-a-tool-call-ask-every-time/task-01-the-rule-is-read-in-the-approval-check.md` - Step 2 names `PER_CONNECTION`, which is gone.

## Steps

1. Say that the rule does not reach a session inside a machine yet, and link [deferred.md](deferred.md) of this plan.
2. Say that the host keeps the rule in memory, and that a client must push it again after a restart.
3. Say that `/mcp` refuses a matched tool, because it has no session to ask in.
4. Replace the sentence on cofold's memory with what task 07 does.
5. Say that a rule key is the tool name of each backend, with case, such as `Bash` or `bash`.
6. Correct the plan refs, with the lines the review of 2026-11-02 found.
7. Correct Step 2 of task 01 to the host-wide key that fork commit `8e6cbbc5` made.

## Validation

- Read the paragraph against the code by hand, and write the result in *Resume*.
- Run `node <do-spec>/scripts/lint-prose.mjs` on the plan folder. Expect no findings.

## Resume

- **Done so far:** nothing. Stopped on 2026-11-03 before the first edit: its dependency on task 08 is unmet. Step 3 says in the docs that `/mcp` refuses a matched tool, which task 08 would implement. Task 08 stopped on the open question in the plan's Resume state. The other steps wait too, so the paragraph is written once rather than twice.
- **Next action:** once task 08 is answered and built, write every step and check the paragraph against the code by hand.
- **Open questions:** none of its own; it waits on task 08's.

