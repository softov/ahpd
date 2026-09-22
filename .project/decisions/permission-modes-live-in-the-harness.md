---
title: A permission mode is a harness policy, and the thinking level is a model request
status: accepted
date: 2026-09-20
refs:
  - code://packages/agent-cofold/src/agent.ts - the schema that declares no mode and no effort today
  - code://packages/agent-claude/src/claude.ts#L126-L196 - the `permissionMode` and `effortLevel` properties a client draws controls from
  - file:///github/cofold/packages/papo/src/agent.ts#L33-L62 - `policyOf`, `byEffects` and `EDITS`, the mode mapping that lives in a surface
  - file:///github/cofold/packages/agents/src/types/agent.ts - `Policy.decide`, what a mode becomes
  - file:///github/cofold/packages/agents/src/types/model.ts#L14-L23 - `ReasoningEffort` and `ModelParams.reasoning`, what a thinking level becomes
  - file:///github/cofold/packages/model-openai-compat/src/index.ts#L12 - `features.reasoning` false by default, so a level is ignored until it is on
---

## Context

A client draws a mode picker and a thinking control only when the backend advertises them: the config schema is generic and the property names are what the pickers key off.
`@ahpd/agent-claude` advertises `permissionMode` (six values, `scope: 'session'`) and either a per-model `thinkingLevel` or a chat-scope `effortLevel`; `@ahpd/agent-cofold` advertises neither, which is why a facio session shows no mode and no effort.

Both mappings exist in the harness, but in the wrong places for a second host to use.
`policyOf` and its `byEffects`/`EDITS` helpers live in `@facio/papo`, a surface, and resolve an edit against the CLI's workspace through `@facio/tools`.
A facio model takes `ModelParams.reasoning.effort`, but `openaiCompat` sends it only when `features.reasoning` is true, which is off by default, so a host that never sets it has no effort at all.

## Decision

`@facio/agents` owns the permission modes, and a host supplies the two facts only it knows:

1. `PermissionMode` and `policyOf(mode, rules)` move into `@facio/agents`, with `rules` carrying `inside(path)` and `isEdit(tool)`. What an edit is and where the workspace boundary lies are host facts: papo passes `write_file`/`edit_file` and `resolveWithin`, and the bridge passes a tool that declares `writes` and a path check under the session's working directory.
2. The union has six values, the same six the window already draws for Claude. The four papo has keep their exact meaning (`default` asks on writes, destruction or the network; `acceptEdits` lets an in-workspace edit through; `bypassPermissions` allows everything; `dontAsk` turns the mode's own ask into a denial). `plan` refuses anything that writes or destroys, which is a facio reading of a mode that must not change anything, and `auto` is facio's own `DEFAULT_DECIDE`, asking only about a destructive tool.
3. papo keeps its four-value config type and re-exports the core's `policyOf`, so its behaviour and its public surface do not move.
4. `@ahpd/agent-cofold` advertises `permissionMode` only when the plugin was given no `policy`. An embedder's policy is the authority, and a control whose value the backend would ignore is not drawn.
5. Thinking is a chat-scope `effortLevel` with the harness's own four levels, `off`, `low`, `medium` and `high`, mapped to `params.reasoning.effort` with `features.reasoning: true`; `off` sends no reasoning field at all. Per-model `thinkingLevel` is not offered, because an OpenAI-compatible catalogue publishes no effort enum and claiming every level for every model would be a guess.
Source: Softov, 2026-09-20: "ok do it" (defaulted: six modes, the injected `inside`/`isEdit` seam, and `off` as the effort default).

## Consequences

The window shows a facio session the same two controls it shows for Claude, and the six mode labels read the same across backends.
The mode mapping has one definition, in the harness both hosts already depend on, and a host that works in several directories supplies the boundary rather than inheriting one.
papo's behaviour is unchanged: its four modes are the same functions and its edit set is still its own two file tools.
Any host whose tools declare `effects` gets a meaningful `acceptEdits` without naming its tools in the core, which is what lets the bridge, whose tools are the host's and a client's, honour it.
`plan` and `auto` are offered to papo's type but not its configuration; adopting them there is a later change in that program.
A session that never sets `effortLevel` sends no reasoning field, so nothing about an existing conversation's requests changes.

## Options

- **Copy the four modes into `@ahpd/agent-cofold`.**
  Rejected: two definitions of what a mode means, in two repositories, which is how the window and the CLI would drift apart.
- **Move `policyOf` unchanged into the core with a workspace string.**
  Rejected: it needs `resolveWithin` from `@facio/tools`, which the zero-dependency core must not take, and the bridge's workspace is the AHP working directory rather than a CLI one.
- **Offer every level per model as `thinkingLevel`.**
  Rejected: OpenRouter publishes no effort enum, so each row would claim `minimal` to `max` for models that take none, and a client would draw a control that silently does nothing.
- **Advertise `permissionMode` even when the plugin passed a `policy`.**
  Rejected: the plugin's policy is the run-level authority, so the picker would change nothing, which is the kind of control the Claude host omits on purpose.
