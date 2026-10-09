---
title: A copied plugin's parts are read
status: done
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

- **Status:** done.
- **Done:** [`code://packages/sdk/src/pluginparts.ts`](../../../../packages/sdk/src/pluginparts.ts) exports `partsOf(dir, uri)`. It reads `.claude-plugin/plugin.json` or `.plugin/plugin.json`, and takes each component's places from the manifest or from the usual ones. One part is answered per file or server. A plugin with neither manifest answers nothing, and one that holds nothing answers an empty list. The order is VS Code's: agents, skills, rules, hooks, then servers.
- **Ids:** a part's id and uri are the same string, the URI of the file it was read from in this host's copy. That is the copy's own URI with the file's path under it, escaped one segment at a time. A folder called `two words` is named `two%20words`. A server's id is the declaring file's with `#mcp=<encoded name>` on it. Its `state` is `{ kind: 'stopped' }`, which is the state a declared server is in before a backend starts it. The entries carry no `enabled`, which the protocol reads as on. A part other than a server loads with its plugin, and a server's decision is task 02's.
- **Not read:** a part's frontmatter. The task's refs name `parsePlugin`, `readSkills` and `buildChildId`, and those answer what the parts are, what they are called and what they are named by. A description or a model would come off the file's own frontmatter, which no step asks for.
- **Files:** only the two the task names. `partsOf` is reached from `packages/sdk/src/host/tooling.ts` in task 02 by its own path, so `packages/sdk/src/index.ts` is left alone.
- **Named by the copy:** `partsOf` takes the directory and that directory's URI. A part hangs under the copy's URI, as VS Code's host names one under *its* copy. It does not hang under the client's announced URI with the path appended. That earlier reading came from the protocol round-trip fixture, and Softov settled it on 2026-10-09 for the file URI in this host's copy.
- **Tests:** `packages/sdk/test/pluginparts.test.ts` holds eight cases. They cover every kind of part in order, a manifest that moves a component, and a path out of the plugin. The others are the servers and hooks held in the manifest, a skill at the plugin root, and a name that needs escaping. The last two are a manifest with no parts, and a directory with no manifest this host reads.
- **Gates:** pass. `pnpm install`, `node tools/schema.mjs`, `pnpm build`, `pnpm typecheck` and `pnpm boundary` are clean, and the full `vitest` run reports 264 files and 4630 tests passed.
