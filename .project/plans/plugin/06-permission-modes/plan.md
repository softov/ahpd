---
title: The facio backend offers a permission mode and a thinking level
domain: plugin
status: built
priority: medium
created: 2026-09-20
revalidated: 2026-09-20
requires:
  - plans/plugin/05-endpoint-models/plan.md
changes: []
creates: []
decisions:
  - decisions/permission-modes-live-in-the-harness.md
refs:
  - code://.project/plans/plugin/05-endpoint-models/implemented.md - the plan this follows, whose model list the two controls sit beside
  - code://packages/agent-cofold/src/agent.ts - the mode and effort properties, and the effort in `modelOf`
  - code://packages/agent-cofold/src/session.ts - `agentOf`, which builds the run's policy from the mode
  - code://packages/agent-claude/src/claude.ts#L126-L196 - the `permissionMode` and `effortLevel` properties to mirror, labels included
  - file:///github/cofold/packages/agents/src/policy/modes.ts - `policyOf`, the mapping that moved into the core
  - file:///github/cofold/packages/agents/src/policy/rules.ts - `DEFAULT_DECIDE`, which becomes the `auto` mode
  - file:///github/cofold/packages/agents/src/types/model.ts#L14-L23 - `ReasoningEffort` and `ModelParams.reasoning`
  - file:///github/cofold/packages/model-openai-compat/src/index.ts#L12 - `features.reasoning`, false until a host asks for it
---

## Goal

A facio session shows the two controls a Claude session shows: an approvals mode, so a person can ask before edits, plan without changing anything, or stop being asked; and a thinking level, so a turn can be told how hard to think before it answers.
Both have to mean something: the mode becomes the run's policy and the level becomes the model request, rather than a control the window draws and the backend ignores.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg "thinkingLevel|enumLabels|permissionMode" packages/sdk/src packages/agent-claude/src` - a mode is the config property `permissionMode` and a thinking level is a per-model `thinkingLevel` or a chat-scope `effortLevel`; nothing about either is protocol-level.
- `rg "policyOf|byEffects|EDITS" packages/papo/src` - the mode mapping lives in the papo surface and resolves edits with `resolveWithin` from `@facio/tools`; `packages/papo/src/index.ts` exports it, so its home moving must keep that surface.
- `rg "ReasoningEffort|ModelParams" packages/agents/src/types/model.ts packages/model-openai-compat/src` - `reasoning.effort` exists and `features.reasoning` gates it; the adapter's default is false.
- `rg "policy" packages/agent-cofold/src` - the bridge passes `options.policy` straight into `createAgent`, so a mode setting has to compose with that or stand aside.

### Runtime path

```
a client's mode choice -> session/configChanged -> settings.permissionMode
  -> agentOf -> createAgent({ policy }) -> the run's tool decisions -> an approval, a run, or a refusal
a client's effort choice -> settings.effortLevel -> modelOf -> openaiCompat({ params.reasoning, features.reasoning })
  -> the wire body's reasoning_effort
```

### Gaps

- `@facio/agents` has no `PermissionMode` and no `policyOf`; the only mapping is papo's, in a surface the bridge must not import.
- `@ahpd/agent-cofold`'s schema declares no `permissionMode` and no `effortLevel`, so the window draws neither control.
- `modelOf` builds the adapter with no `params` and no `features`, so a level has nowhere to go even if one were chosen.
- `Not found: a mode beyond papo's four anywhere in the harness - searched "permissionMode|plan|auto" in /github/cofold/packages; the harness CLI's configuration is the only place the four are named.`

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [A permission mode is a harness policy, and the thinking level is a model request](../../../decisions/permission-modes-live-in-the-harness.md) | Softov, 2026-09-20: "ok do it" |

## Proposed architecture

- **Data flow** - a session setting becomes the run's policy through `policyOf`, and the model request's reasoning through `params.reasoning`; both are rebuilt per turn, because `agentOf` is.
- **Event flow** - none of its own: a mode that asks shows the approval entry the harness already sends, and one that refuses shows the denial the model already reads.
- **State flow** - `permissionMode` is a session-scope setting and `effortLevel` a chat-scope one, both merged into `settings` by `setConfig` and carried into the next turn.
- **Layer responsibilities** - `/github/cofold` (`@facio/agents`): `PermissionMode`, `policyOf` and the `inside`/`isEdit` seam · `@facio/papo`: unchanged behaviour, importing the mapping · `packages/agent-cofold`: the two schema properties, the policy per turn, the model params · `docs/PLUGINS.md`: the two settings and what each value means.
- **Source-of-truth files** - `file:///github/cofold/packages/agents/src/policy/modes.ts`, `code://packages/agent-cofold/src/agent.ts`, `code://packages/agent-cofold/src/session.ts`.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A mode and an effort control](task-01-a-mode-and-an-effort-control.md) | done | - |

## Risks and tradeoffs

- `plan` is a facio reading of a Claude mode and not a planner: it refuses writes rather than producing a plan, and the description says so.
- A client can pick `bypassPermissions`, which runs every tool without asking - that is a mode the protocol already offers Claude, and the host's own `policy` still wins where an embedder set one.
- The core gains a policy function whose meaning is shared across repositories; the seam is the two host facts, so a new mode is one function in one file.
- `effortLevel` is offered only where the model factory builds the request; a caller-passed adapter keeps its own list and shows no effort control.

## Resume state

- **Done so far:** task 01, 2026-09-20.
- **Next action:** none; the plan is built and [implemented.md](implemented.md) records it.
- **Open questions:** none. The six modes are the decision's, the default is `auto` so an existing session's policy does not move, and the two controls are offered only where the backend would honour them.
- **Watch out for:** the policy is built in `agentOf`, so a mode change takes effect on the next turn; and the facio-side move is uncommitted in `/github/cofold`, so the bridge does not build without that working tree.

## Final verification checklist

- [x] `pnpm test` green in both repositories, with each of the six modes asserted and the effort reaching the wire body: facio's `packages/agents` 214 passed, ahpd's nine facio files 67 passed and the full suite 798 passed.
- [x] `pnpm typecheck` and `pnpm boundary` green: boundary green, typecheck clean apart from another session's in-progress `test/agent-cofold-turn.test.ts`.
- [x] The window would draw both controls: the keys, labels and scopes present in the schema.
- [x] `docs/PLUGINS.md` names the mode and the effort setting.
- [x] `plans/index.md` updated.
