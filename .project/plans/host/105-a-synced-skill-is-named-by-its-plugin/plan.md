---
title: A synced skill is named by its plugin
domain: host
status: built
priority: medium
created: 2026-10-16
revalidated: 2026-10-16
changes: []
creates: []
refs:
  - "[code://packages/sdk/src/plugins/clientplugins.ts#L61](../../../../packages/sdk/src/plugins/clientplugins.ts#L61) - `keyOf`: a URI or a nonce as a file name"
  - "[code://packages/sdk/src/plugins/clientplugins.ts#L88](../../../../packages/sdk/src/plugins/clientplugins.ts#L88) - `placeOf`: a copy's directory is named by its nonce"
  - "[code://packages/sdk/src/plugins/clientplugins.ts#L153-L199](../../../../packages/sdk/src/plugins/clientplugins.ts#L153-L199) - `sync` copies a plugin and moves it into place"
  - "[code://packages/sdk/src/plugins/pluginparts.ts#L44-L52](../../../../packages/sdk/src/plugins/pluginparts.ts#L44-L52) - the host reads a Claude manifest and an Open Plugins manifest"
  - "[code://packages/agent-claude/src/session/servers.ts#L229-L231](../../../../packages/agent-claude/src/session/servers.ts#L229-L231) - `handed`, the plugin paths the host gave the CLI"
  - "[code://packages/agent-claude/src/session/customizations.ts#L79-L89](../../../../packages/agent-claude/src/session/customizations.ts#L79-L89) - a handed plugin is left out, and `pluginOf` matches a skill by its prefix"
  - "[code://packages/agent-claude/src/session/customizations.ts#L147-L170](../../../../packages/agent-claude/src/session/customizations.ts#L147-L170) - a skill with no plugin lands in the `skills` container under its full name"
  - "file:///github/externals/vscode/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/syncedCustomizationBundler.ts#L30-L38 - the bundle's manifest: `VS Code Synced Data`"
  - "file:///github/externals/vscode/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/syncedCustomizationBundler.ts#L198-L205 - the bundle's layout, with `.plugin/plugin.json`"
  - "file:///github/externals/vscode/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/syncedCustomizationBundler.ts#L386-L388 - the manifest is written to `.plugin/plugin.json` only"
  - "file:///github/externals/vscode/src/vs/platform/agentHost/node/agentPluginManager.ts#L191-L194 - VS Code's host copies a revision to `<uri key>/<nonce key>` too"
  - "file:///github/externals/vscode/src/vs/platform/agentHost/node/claude/claudeSdkOptions.ts#L195-L197 - VS Code's Claude agent hands the CLI that path"
---

## Goal

The window's slash list names a skill of the "VS Code Synced Data" plugin by a readable name, not by the revision nonce.
The skill is listed once.

## Reconnaissance

### Searches performed

- `git grep -n "placeOf\|keyOf" packages/sdk/src/plugins/clientplugins.ts` - a copy lives at `<uri key>/<nonce key>`.
- `grep -o '".claude-plugin"' claude` in the CLI binary of `@anthropic-ai/claude-agent-sdk-linux-x64@0.3.278` - the CLI reads `.claude-plugin/plugin.json` and no other manifest.
- `rg -n "plugin.json|_dirFor" /github/externals/vscode/src/vs` - VS Code writes `.plugin/plugin.json` and copies to a nonce directory.

### Runtime path

1. The window announces the bundle with its URI, the name `VS Code Synced Data`, and a content nonce.
2. `sync` copies it to `<uri key>/<nonce key>`, so the copy's directory is named `1683262406`.
3. agent-claude hands the CLI that path as a local plugin.
4. The copy has `.plugin/plugin.json` and no `.claude-plugin/plugin.json`, so the CLI names the plugin by its directory: `1683262406`.
5. The CLI names the skill `1683262406:advisor`.
6. agent-claude leaves the handed plugin out of its list, so `pluginOf` finds no plugin for the skill. The skill lands in the `skills` container as `1683262406:advisor`.
7. The host's own entry for the bundle lists the same skill again, read by `pluginparts`.

### What is true now

- The cause is shared. VS Code writes only an Open Plugins manifest, and both hosts name a copy's directory by its nonce.
- VS Code's own Claude agent hands the CLI the same kind of path, so it likely shows the same name.

### Gaps

- Step 4 is read from the CLI binary, not from a run. Task 01 step 1 checks it in a session.
- Which name the window sends when a person picks the skill, and whether the CLI runs it. Task 02 step 1 reads it.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The Claude name is the Open Plugins name in kebab case, `vs-code-synced-data` | (defaulted: a Claude plugin name is kebab case) | 01 |
| The written manifest holds every field of the Open Plugins manifest, with only `name` in kebab case | Softov, 2026-10-16, chose "Every field, name in kebab" for "What does the written manifest hold?" | 01 |
| A copy that has its own `.claude-plugin/plugin.json` is left as it is | (defaulted: the client's manifest wins) | 01 |
| The sdk copy writes `.claude-plugin/plugin.json` from the Open Plugins manifest, when the copy has none | Softov, 2026-10-16, chose "The sdk copy writes `.claude-plugin/plugin.json` from the Open Plugins manifest, when it has none" for "Where does the CLI get the plugin's name?" | 01 |
| agent-claude drops a skill of a handed plugin, and the host's entry keeps it | Softov, 2026-10-16, chose "agent-claude drops a skill of a handed plugin, and the host's entry keeps it" for "What happens to the skill that agent-claude lists in its `skills` container?" | 02 |
| The upstream text is a proposal in `.project/proposals/`, not a check in `.project/pending/` | Softov, 2026-10-16, wrote "proposal not a submission in pending as mandatory" for "Is there an upstream write-up for VS Code?" | 03 |
| Task 03 is optional, and nothing waits on Softov to file it | Softov, 2026-10-16, the same answer | 03 |

## Proposed architecture

- **Data flow:** an announced plugin -> `sync` copies it -> the copy gets `.claude-plugin/plugin.json` -> the CLI names the skill `vs-code-synced-data:advisor` -> agent-claude leaves it to the host's entry.
- **Layer responsibilities:** sdk gives the copy a Claude manifest. agent-claude drops a skill that a handed plugin brings.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The copy gets a Claude manifest](task-01-the-copy-gets-a-claude-manifest.md) | done | - |
| [02 - A handed plugin's skill is listed once](task-02-a-handed-plugins-skill-is-listed-once.md) | done | 01 |
| [03 - A proposal for VS Code](task-03-a-proposal-for-vscode.md) | done | 01 |

## Risks and tradeoffs

- The host writes a file the client did not send. `pluginparts` reads the Claude manifest first, so its name must match the Open Plugins one.
- A new name changes the CLI's skill names. A session that used `/1683262406:advisor` gets `/vs-code-synced-data:advisor` on its next start.

## Resume state

- **Done so far:** drafted 2026-10-16 from the Windows run in `pending/vscode-checks.md`. Planned 2026-10-16 with Softov's answers. Task 01 built 2026-10-16: `claudeManifestIn` in `packages/sdk/src/plugins/clientplugins.ts` writes `.claude-plugin/plugin.json` into a copy that brought only `.plugin/plugin.json`. The file has every field of that manifest, with its `name` in kebab case. A copy with its own Claude manifest, or with no manifest, stays as it is. Task 02 built 2026-10-16: `customizationsOf` in `packages/agent-claude/src/session/customizations.ts` keeps the handed plugins as a second list. It skips a skill and a command whose prefix names one, so only the host's own entry for the copy lists them. Task 03 built 2026-10-16: `.project/proposals/vscode-synced-plugin-has-no-claude-name.md`, with a row in the proposals index and `Filed` set to `no`. Reviewed and merged in `bd49a20d`.
- **Next action:** none. The plan is built, and `implemented.md` says what exists.
- **Open questions:** none.
- **Watch out for:** One thing the tasks do not decide: an agent of a handed plugin is still listed twice. The written manifest carries every field, so a component that the manifest moves stays where it said.

## Final verification checklist

- [x] A test in the sdk: a copy with only `.plugin/plugin.json` gets `.claude-plugin/plugin.json` named `vs-code-synced-data`.
- [x] A test in the sdk: a copy with its own Claude manifest keeps it.
- [x] A test in agent-claude: a skill of a handed plugin is not in the `skills` container.
- [x] The gates pass: build, typecheck, boundary, schema and vitest.
- [ ] By hand: the window's slash list shows the skill once, with no nonce in its name, and the skill runs.
- [x] Optional: the proposal is in `.project/proposals/`, with a row in its index.
- [x] `plans/index.md` updated.
