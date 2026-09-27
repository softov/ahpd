---
title: A cofold session's agent has the four capabilities
status: done
depends: []
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/session.ts#L406-L450](../../../../packages/agent-cofold/src/session.ts#L406-L450) - `agentOf`"
  - "[code://packages/agent-cofold/src/plugin.ts#L105-L107](../../../../packages/agent-cofold/src/plugin.ts#L105-L107) - `apply`, the options"
  - file:///github/cofold/packages/papo/src/agent.ts - `capabilitiesOf`, the pattern
---

## Objective

`agentOf` passes `capabilities` built from `@cofold/tools` per the plugin's `tools` option, all four on by default, so a turn offers the model the nine tools cofold ships without a search provider.

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

- `packages/agent-cofold/test/agent-cofold-tools.test.ts`: the default offers the nine tool names `edit_file`, `list_files`, `memory_read`, `memory_write`, `read_file`, `search_files`, `shell_exec`, `web_fetch` and `write_file` to a scripted model; `tools: { shell: false }` drops `shell_exec`; `web_search` appears only with a provider.
- A scripted turn calling `read_file` on a fixture returns its lines.

## Resume

Done.
`packages/agent-cofold/src/capabilities.ts` builds the four `@cofold/tools` capabilities from `CofoldOptions.tools`.
`plugin.ts` reads the option out of a configuration with `toolsOf`, and `agent.ts` carries it as `tools?: ToolsConfig`, all four on when it is absent.
`agentOf` passes the capabilities, in papo's order, with memory under `<store root>/memory/<workspace slug>/` and `web_search` only when `tools.web.search` names a provider.
What the plan did not know: with no provider the default is nine tools, because `web_search` needs one and `web_fetch` is the ninth.
The host's offered tool names go into `capabilitiesOf`, so a host tool that shares a capability tool's name keeps it, since cofold fails a run whose capabilities contribute a duplicate name.
A session whose store is in memory gets no memory capability, because there is no directory to keep memory files in.
`capabilitiesOf` and the `ToolsConfig`/`SearchConfig` types are exported from `index.ts`.
