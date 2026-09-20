---
title: Host tools load when the instruction says so, and a customization keeps its source
domain: claude
status: planned
priority: high
created: 2026-09-19
revalidated: 2026-09-19
requires:
  - research/claude-customization-attribution.md
changes: []
creates: []
decisions: []
refs:
  - code://packages/agent-claude/src/session.ts#L432-L482 - `contributed()`, which builds the `ahp` SDK MCP server and passes no per-tool load policy, so every `mcp__ahp__*` tool takes the SDK default
  - code://packages/agent-claude/src/session.ts#L157-L345 - `customizationsOf()`, which synthesises three `directory` containers with invented `~/.claude/<kind>/<name>` URIs and folds plugin and builtin entries into them
  - code://packages/agent-claude/src/session.ts#L1797-L1837 - `describe()`, where `initializationResult()`, `reloadSkills()` and `customizationsOf()` are called at the handshake
  - code://packages/agent-claude/src/probe.ts#L59-L71 - the second caller of `customizationsOf()`, which must be given the same lists or a probe and a session will disagree
  - code://packages/sdk/src/artifacttools.ts#L150-L230 - the artifact tools, their one instruction and the three definitions
  - code://packages/sdk/src/types/host.ts#L270-L284 - `HostTool`, where `instruction` sits and a per-tool load policy would sit beside it
  - code://packages/sdk/src/types/agent.ts#L18-L36 - `BoundTool`, the shape a backend is handed, which carries no load policy today
  - code://packages/sdk/src/host.ts#L3330-L3335 - `boundTools()` and `instructions()`, where a host tool becomes a backend tool and its instruction is collected
  - code://.project/plans/host/01-artifact-tools/plan.md - the sibling plan that edits the same three definitions for promotion and the answer shape
  - code://.project/review/2026-09-19-upstream-pass-4.md#L32 - the eager-tools and customization findings this plan takes
  - npm://@anthropic-ai/claude-agent-sdk@^0.3.250 - a raw `SdkMcpToolDefinition` becomes eager through `_meta['anthropic/alwaysLoad']`, because `createSdkMcpServer` is handed object literals and not the SDK's `tool()` helper
  - file:///github/externals/vscode/src/vs/platform/agentHost/node/shared/artifactServerTools.ts#L67-L92 - the three definitions with `deferLoading` false on add and true on remove and list
  - file:///github/externals/vscode/src/vs/platform/agentHost/node/shared/artifactServerTools.ts#L251-L259 - the "List/remove (discover if needed)" sentence appended to both wordings
  - file:///github/externals/vscode/src/vs/platform/agentHost/node/claude/claudeServerToolMcpServer.ts#L63-L78 - the `alwaysLoad` option is set to `!def.deferLoading`, and passed only when `deferLoading` is defined
  - file:///github/externals/vscode/src/vs/platform/agentHost/node/claude/claudeAgentSdkService.ts#L241-L250 - the SDK `tool()` pass-through that carries the option
  - file:///github/externals/vscode/src/vs/platform/agentHost/node/codex/codexAgent.ts#L2828-L2835 - the rule's direction, keeping dynamic tools eager where tool search cannot be reported
  - file:///github/externals/vscode/src/vs/platform/agentHost/node/claude/customizations/claudeSessionCustomizationDiscovery.ts#L55-L88 - `makePlugin()`, a plugin projected as a top-level container with its real root URI and its id as the name
  - file:///github/externals/vscode/src/vs/platform/agentHost/node/claude/customizations/claudeSessionCustomizationDiscovery.ts#L280-L335 - matching SDK plugins by `source` and suppressing their components from the per-scope directory lists
  - file:///github/externals/vscode/src/vs/platform/agentHost/node/claude/customizations/claudeBuiltinCommands.ts#L114-L126 - the read-only `builtin` container with a real URI
  - file:///github/externals/vscode/src/vs/platform/agentHost/node/claude/customizations/claudeBuiltinCommands.ts#L150-L176 - the post-materialize builtin container derived from the live command set minus disk skills
---

## Goal

A model is told on its first turn to record artifacts and references, and the tool that instruction names is in front of it rather than behind the harness's tool search.
A window lists what a Claude session loaded, and an entry a plugin or the CLI itself contributed is not drawn as if the person had written it under `~/.claude`.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `grep -rn "alwaysLoad\|deferLoading" packages/ --include=*.ts` - nothing; the per-tool load policy does not exist here in any form.
- `grep -rn "plugins\|reloadPlugins" packages/agent-claude/src packages/sdk/src --include=*.ts` - one comment, at `session.ts:166`; the SDK reports plugins and this host reads neither source.
- `grep -rn "customizationsOf" packages/ test/ --include=*.ts` - two callers, `session.ts:1831` and `probe.ts:71`, and both feed it the control protocol's `initializationResult()`.
- `grep -rn "artifactTools\|ARTIFACT_TOOLS_INSTRUCTION" packages/ --include=*.ts` - the three tools in `artifacttools.ts` and their one instruction, offered by `tools.ts:26`.
- `grep -rn "directory:\|container(" packages/agent-claude/src/session.ts` - the three invented directory containers at lines 262 to 264.

### Runtime path

```
first turn -> host.instructions() -> ARTIFACT_TOOLS_INSTRUCTION names add_artifact_or_reference
  -> the tool was declared to the Claude SDK with no alwaysLoad, so tool search may defer it
  -> the model cannot call the tool its own instruction names

session handshake -> initializationResult() + reloadSkills() + mcpServerStatus()
  -> customizationsOf() invents file://<home>/.claude/<kind> containers
  -> session/customizationsChanged -> the window lists a plugin skill as a user skill
```

### Gaps

- No `alwaysLoad`: the add tool the instruction names can be deferred behind tool search, which is the one case the instruction exists to prevent.
- `initializationResult()` has no `plugins` field; the SDK reports `plugins: { name, path, source?, version? }` from `reloadPlugins()` and from the message stream's own init, and this host calls neither.
- The SDK's flat `commands`, `agents` and `skills` lists carry no source, so which entry came from a plugin is not attributable from those lists alone.
- `Not found: a builtin URI scheme in this repository - searched "builtin" and "AGENT_BUILTIN" in packages/ and docs/; the reference invents `AGENT_BUILTIN_CUSTOMIZATION_SCHEME` and this host has no equivalent.`
- No test covers the load policy, and no test asserts the container type of a customization.

## Decisions locked in

No decision file: neither item forks on a choice where both options work.

| What | Source | Task |
| --- | --- | --- |
| The load policy is a host-side `deferLoading` and never reaches the published `ToolDefinition` | the reference strips it before publishing, recorded in `.project/review/2026-09-19-upstream-pass-4.md` | 01 |
| `deferLoading: false` on add and `true` on remove and list, and nothing is passed when it is undefined so every other host and client tool keeps the SDK default | `file:///github/externals/vscode/src/vs/platform/agentHost/node/shared/artifactServerTools.ts#L74` and `#L82` and `#L90`, and `claudeServerToolMcpServer.ts#L76` | 01 |
| The first-turn instruction keeps naming only the add tool, as it does today | `code://packages/sdk/src/artifacttools.ts#L150-L155` | 01 |
| A customization is projected only as far as the SDK attributes it, and what it cannot attribute stays a `directory` container rather than an invented `~/.claude/<kind>/<name>` URI | `.project/research/claude-customization-attribution.md`, fallback | 02 |
| A plugin container uses the `path` the SDK reports as its URI and the plugin's own name and version as its name and version | `claudeSessionCustomizationDiscovery.ts#L55-L88` | 02 |
| A builtin container is read-only and uses a non-editable absolute URI rather than a `file://` path under the person's home | `claudeBuiltinCommands.ts#L114-L126` | 02 |

## Proposed architecture

- **Data flow** - `artifactTools()` marks `deferLoading`; `createHost` keeps it on `HostTool`; `boundTools()` copies it to `BoundTool`; `contributed()` turns a defined `deferLoading` into `_meta['anthropic/alwaysLoad'] = !deferLoading` on the raw SDK tool. The published `ToolDefinition` never carries it.
- **Event flow** - none for the load policy, which is settled when the session is built. For customizations, `describe()` reads the SDK's answered lists once at the handshake and emits `session/customizationsChanged`.
- **State flow** - none; both are declarations rebuilt for each session from what the SDK answers.
- **Layer responsibilities** - packages/sdk: the field and its pass-through, and which artifact tool is eager · packages/agent-claude: the SDK translation in `contributed()` and the customization projection in `customizationsOf()` · docs/AGENT.md: what a customization container promises if the projection changes.
- **Source-of-truth files** - `code://packages/sdk/src/artifacttools.ts`, `code://packages/agent-claude/src/session.ts`.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The artifact tools carry a load policy](task-01-eager-artifact-tools.md) | todo | - |
| [02 - A customization keeps its source](task-02-customization-containers.md) | todo | - |

## Risks and tradeoffs

- `host/01-artifact-tools` edits the same three definitions for promotion and the answer shape; the `deferLoading` lines are separate, so either order merges, but the two tasks must not overwrite each other's edit to `artifacttools.ts`.
- Forcing every host tool eager would change the tool-search economy; the reference passes the option only when `deferLoading` is defined, so undefined must keep passing nothing.
- The raw `_meta['anthropic/alwaysLoad']` key is the only route because `createSdkMcpServer` is handed object literals and not the SDK's `tool()` helper, so a test asserts the key and a rename in the SDK fails the test rather than silently deferring the tool.
- Reading plugins needs a fourth control call, `reloadPlugins()`, beside `initializationResult()` and `reloadSkills()`; it re-reads commands and agents too, so the task uses its plugin list and does not replace the existing lists with it.
- `customizationsOf` has a second caller in `probe.ts`, so a projection changed in one place and not the other makes a session offer different customizations than the pre-create probe.
- The SDK may attribute a plugin but not its children, which is why task 02 opens by running the research investigation and the fallback is stated before any code is written.

## Resume state

- **Done so far:** nothing; the plan and its two task files were written 2026-09-19.
- **Next action:** [task-01-eager-artifact-tools.md](task-01-eager-artifact-tools.md).
- **Open questions:**
  1. Does the SDK attribute a plugin-contributed skill or agent, or only the plugin itself? - proposed: only the plugin, so children stay in the directory containers.
- **Watch out for:** `initializationResult()` carries no plugins; the plugin list comes from `reloadPlugins()` or the message stream's init, and `probe.ts` needs the same source as a session.

## Final verification checklist

- [ ] `pnpm test` green, with the load-policy cases and the customization-projection cases in it.
- [ ] `pnpm typecheck` and `pnpm boundary` green.
- [ ] By hand: the `ahp` MCP server's tool list carries `anthropic/alwaysLoad` true on add and false on remove and list.
- [ ] By hand: a session with a plugin installed lists it under a `plugin` container whose URI is the plugin's real path.
- [ ] `plans/index.md` updated.
