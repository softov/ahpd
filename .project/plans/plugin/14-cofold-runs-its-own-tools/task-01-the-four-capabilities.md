---
title: A cofold session's agent has the four capabilities
status: todo
depends: []
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/session.ts#L353-L365](../../../../packages/agent-cofold/src/session.ts#L353-L365) - `agentOf`"
  - "[code://packages/agent-cofold/src/plugin.ts#L98](../../../../packages/agent-cofold/src/plugin.ts#L98) - `apply`, the options"
  - file:///github/cofold/packages/papo/src/agent.ts - `capabilitiesOf`, the pattern
---

## Objective

`agentOf` passes `capabilities` built from `@cofold/tools` per the plugin's `tools` option, all four on by default, so a turn offers the model the ten tools.

## Files

- `UPDATE: packages/agent-cofold/package.json` - `@cofold/tools` as a dependency.
- `CREATE: packages/agent-cofold/src/capabilities.ts` - `capabilitiesOf(tools, { storeRoot, workspace })`.
- `UPDATE: packages/agent-cofold/src/agent.ts` - `CofoldOptions.tools`, read and defaulted.
- `UPDATE: packages/agent-cofold/src/session.ts` - `capabilities:` in `agentOf`.

## Steps

1. Read `tools` from the plugin options: each of `files`, `shell`, `memory` a boolean defaulting to true; `web` true, false, or `{ search: { brave?, tavily?, duckduckgo? } }`.
2. Build the capabilities in papo's order, memory's directory from the store root and the session's workspace slug.
3. Pass them in `agentOf`; leave the host's tools in `tools`.

## Validation

- `test/agent-cofold-tools.test.ts`: the default offers the ten tool names to a scripted model; `tools: { shell: false }` drops `shell_exec`; `web_search` appears only with a provider.
- A scripted turn calling `read_file` on a fixture returns its lines.

## Resume
