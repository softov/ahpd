---
title: A copied plugin's parts are read
status: todo
depends: []
layer: sdk
refs:
  - https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentPlugins/common/pluginParsers.ts#L1402-L1467 - `parsePlugin`, the manifest and the default folders
  - https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentPlugins/common/pluginParsers.ts#L1020-L1047 - a skill is `<dir>/*/SKILL.md`, or a `SKILL.md` at the plugin root
  - https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentPlugins/common/pluginParsers.ts#L336-L414 - the id of a part and of an MCP server
---

## Objective

A function reads a plugin folder and returns its parts, as VS Code's `parsePlugin` does for the Claude format and `.plugin/plugin.json`.

## Files

- `CREATE: packages/sdk/src/pluginparts.ts` - `partsOf(dir, uri)`: the manifest, the folders it names or the defaults, and one part per file or server.
- `CREATE: packages/sdk/test/pluginparts.test.ts` - a plugin folder with each kind of part, and one with a manifest that moves the folders.

## Steps

1. Read `.claude-plugin/plugin.json`, else `.plugin/plugin.json`; with neither, return `undefined`.
2. Take the folders from the manifest, else `.mcp.json`, `skills`, `agents`, `rules` and the format's hooks file.
3. Read MCP servers and hooks given inline in the manifest as well.
4. Give each part VS Code's id and URI, and keep VS Code's order: agents, skills, rules, hooks, MCP servers.
5. Return an empty list for a plugin with a manifest and no parts.

## Validation

- `pluginparts.test.ts` covers each kind of part, a moved folder, inline servers, and no manifest.
- `npx vitest run packages/sdk/test/pluginparts.test.ts` passes.

## Resume
