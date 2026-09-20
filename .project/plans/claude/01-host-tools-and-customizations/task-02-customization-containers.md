---
title: A customization keeps the plugin or builtin it came from, as far as the SDK attributes it
status: todo
depends: []
layer: packages/agent-claude
refs:
  - code://packages/agent-claude/src/session.ts#L157-L345 - `customizationsOf()`, the projection this task changes
  - code://packages/agent-claude/src/session.ts#L1797-L1837 - `describe()`, which must hand the projection the SDK's plugin answer
  - code://packages/agent-claude/src/probe.ts#L59-L71 - the second caller, which must be given the same answer
  - code://.project/research/claude-customization-attribution.md - the investigation this task opens with
  - file:///github/externals/vscode/src/vs/platform/agentHost/node/claude/customizations/claudeSessionCustomizationDiscovery.ts#L55-L88 - `makePlugin()`, the container shape to reproduce
  - file:///github/externals/vscode/src/vs/platform/agentHost/node/claude/customizations/claudeSessionCustomizationDiscovery.ts#L280-L335 - the match on `source` and the suppression of plugin components from the directory lists
  - file:///github/externals/vscode/src/vs/platform/agentHost/node/claude/customizations/claudeBuiltinCommands.ts#L114-L126 - the read-only builtin container
  - npm://@anthropic-ai/claude-agent-sdk@^0.3.250 - `reloadPlugins()` returns a `plugins` array of name, path, optional source and optional version, and `initializationResult()` returns none
---

## Objective

`customizationsOf` projects a plugin as a top-level `plugin` container with the real path the SDK reports, and a builtin as a read-only container with a non-editable URI, to exactly the depth the SDK attributes them; what it cannot attribute stays in the existing `directory` containers and is never given an invented plugin URI.

## Files

- `CREATE: test/customizations.test.ts` - the projection cases, driven through the exported `customizationsOf`.
- `UPDATE: packages/agent-claude/src/session.ts:157-345` - the projection, its plugin containers and the builtin container.
- `UPDATE: packages/agent-claude/src/session.ts:1797-1837` - call `reloadPlugins()` beside `reloadSkills()` and pass the reported plugins to `customizationsOf()`.
- `UPDATE: packages/agent-claude/src/probe.ts:61-71` - the same plugin list for the pre-create probe.

## Steps

1. Run the investigation `.project/research/claude-customization-attribution.md` describes: read what the installed SDK reports for `plugins`, `skills`, `agents` and `slash_commands`, probe one project with a plugin installed beside a user skill and a builtin command, compare the entries with the reference's three containers, and write the Answer in that file.
2. If the SDK attributes no child to a plugin, project each reported plugin as a top-level `plugin` container with `uri` its reported `path`, `name` its `name` and `version` when reported, and no children; leave every skill, agent, command and builtin in the directory containers as they are today, whose URIs are the conventional `~/.claude/<kind>` directory, and do not invent a plugin container for anything the SDK did not report.
3. If the SDK attributes children to a plugin, including the `<plugin>:<name>` agent form, move each attributed child under its plugin container and keep it out of the directory lists, matching `makePlugin()`.
4. Either way, add `reloadPlugins()` beside `reloadSkills()` in `describe()` and in `probe()`, pass `list(bag(answer).plugins)` into `customizationsOf()`, and keep a session with no reported plugins answering exactly what it answers today.
5. Either way, a command the SDK reports with no disk skill behind it stays a `prompt` in the commands container, unless the investigation finds an attributable builtin source, in which case it becomes a read-only `directory` container named `builtin` with a non-editable absolute URI and `writable: false`.
6. Update the research file's Answer with what was found and what the projection does with it, so a later pass can deepen the projection when the SDK reports more.

## Validation

- `test/customizations.test.ts`: an `init` with `plugins: [{ name: 'acme', path: '/plugins/acme', version: '1.0.0' }]` yields one `plugin` container with that URI, name and version; an `init` with no plugins yields exactly the three directory containers the function yields today; an attributed skill is a child of the plugin container and absent from the directory container; an unattributed skill is still a child of the skills directory container.
- `test/toolauth.test.ts`'s SDK mock gains `reloadPlugins`, and a case asserts `describe()` reads it, so a session asks the control protocol for plugins.
- `pnpm test` green; `pnpm typecheck` and `pnpm boundary` green.
- By hand: a session with a plugin installed emits `session/customizationsChanged` carrying a `plugin` container whose URI is the plugin's real path.

## Resume

Empty until started.
