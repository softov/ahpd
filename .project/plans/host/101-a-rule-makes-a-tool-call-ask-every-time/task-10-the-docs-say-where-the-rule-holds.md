---
title: The docs say where the rule holds
status: done
depends: [task-07-cofold-asks-in-every-mode.md, task-08-the-mcp-door-refuses-a-matched-tool.md, task-09-claude-names-the-server-and-subagent.md]
layer: docs
refs:
  - "[code://docs/sdk/AHP.md#L196-L209](../../../../docs/sdk/AHP.md#L196-L209) - the rule's paragraph, which says where the rule holds and where it does not"
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

- **Done so far:** 2026-11-03. `docs/sdk/AHP.md:196-209` now says where the rule holds. It is one value for the whole host and needs `config:change`. The host keeps it in memory only, so a restart holds no rule until a window pushes it again. A key is the backend's own tool name, matched with its case. A matched call asks in every backend and every mode. `dontAsk` refuses it, and the question offers no "always". cofold asks and deletes the remembered approval for that tool first. `/mcp` refuses a matched host tool, because that door has no session to ask in. A session inside a machine reads no rule yet, and the paragraph links [deferred.md](deferred.md) for it. The ACP limit stays. The plan's refs point at the current lines, and task 01 Step 2 says the host-wide key rather than `PER_CONNECTION`. `deferred.md` now says `nested.ts` line 1204.
- **Read against the code:** `packages/sdk/src/host/root.ts:302` creates the config empty, so nothing survives a restart. `gate.ts:297-306` requires `config:change`. `spawn.ts:143-151` matches an exact key and reads its case. `tooling.ts:2109-2110` throws for a matched tool at `/mcp`. `packages/agent-cofold/src/turnagent.ts:389-406` asks, deletes the remembered approval, and denies in `dontAsk`. `packages/sdk/src/sessions/nested.ts:1204` pushes only `workspaceTrust` inside a machine. The prose linter on the plan folder reports nothing.
- **Next action:** run the by-hand checks in the plan's *Final verification checklist* on a test daemon.
- **Open questions:** none.
- **Watch out for:** the paragraph is one sentence per line, hard-wrapped with the file; keep that when editing it.

