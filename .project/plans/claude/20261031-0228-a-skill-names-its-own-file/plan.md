---
title: A skill names its own file
domain: claude
status: built
priority: medium
created: 2026-10-31
revalidated: 2026-10-31
changes: []
creates: []
refs:
  - git://ea86d32c - the commit of ahpd this plan was checked at; `customizations.ts` is the same as at 9e87c164, where the brief was checked
  - "[code://packages/agent-claude/src/session/customizations.ts#L188-L218](../../../../packages/agent-claude/src/session/customizations.ts#L188-L218) - a skill's `uri`, made from its name as `~/.claude/skills/<name>`, a folder"
  - "[code://packages/agent-claude/src/session/customizations.ts#L220-L236](../../../../packages/agent-claude/src/session/customizations.ts#L220-L236) - a command's `uri`, made from its name with no check"
  - "[code://packages/agent-claude/src/session/customizations.ts#L238-L276](../../../../packages/agent-claude/src/session/customizations.ts#L238-L276) - an agent's `uri`, checked with `existsSync`, with `INTERNAL_AGENT` as the fallback to copy"
  - "[code://packages/agent-claude/src/session/customizations.ts#L72-L86](../../../../packages/agent-claude/src/session/customizations.ts#L72-L86) - one writable directory per kind, sent only with children"
  - "[code://packages/agent-claude/src/session/customizations.ts#L370-L417](../../../../packages/agent-claude/src/session/customizations.ts#L370-L417) - `agentNameOf`, which reads an agent file's frontmatter under a size limit, the read to copy"
  - "[code://packages/agent-claude/src/session/servers.ts#L86-L95](../../../../packages/agent-claude/src/session/servers.ts#L86-L95) - `laid`, the session's caller of `customizationsOf`"
  - "[code://packages/agent-claude/src/probe.ts#L105-L108](../../../../packages/agent-claude/src/probe.ts#L105-L108) - the probe's caller, which has no working directory"
  - "[code://packages/agent-claude/src/catalog.ts#L81-L82](../../../../packages/agent-claude/src/catalog.ts#L81-L82) - `CLAUDE_CONFIG_DIR` in place of `~/.claude` where it is set"
  - "[code://packages/agent-claude/src/session/context.ts#L76-L81](../../../../packages/agent-claude/src/session/context.ts#L76-L81) - `spawn`, set for a session in a machine"
  - "[code://packages/agent-claude/test/customizations.test.ts#L186-L233](../../../../packages/agent-claude/test/customizations.test.ts#L186-L233) - the tests of where an agent lives, with `withHome`"
  - "[code://packages/agent-claude/README.md#L165-L194](../../../../packages/agent-claude/README.md#L165-L194) - *What it does* and *Supported*, where the docs go"
  - npm://@anthropic-ai/claude-agent-sdk@0.3.301 - `SlashCommand` has no path; its CLI reads `~/.claude/skills/synced` and names a synced skill `anthropic-skills:<name>`, or by its bare name when no other skill takes it
  - https://github.com/microsoft/vscode/blob/171e90619c7/src/vs/platform/agentHost/node/claude/customizations/claudeSessionCustomizationDiscovery.ts#L273-L438 - `buildDiscoveredCustomizations`, which keeps a disk skill only when the SDK reports it
  - https://github.com/microsoft/vscode/blob/171e90619c7/src/vs/platform/agentHost/node/claude/customizations/claudeSessionCustomizationDiscovery.ts#L124-L180 - `mapDiscoveredCustomizations`, one writable directory per kind and scope, sent with no children too
  - https://github.com/microsoft/vscode/blob/171e90619c7/src/vs/platform/agentHost/node/claude/customizations/claudeBuiltinCommands.ts#L162-L180 - the read-only `builtin` directory for an SDK skill with no file
  - https://github.com/microsoft/vscode/blob/171e90619c7/src/vs/platform/agentHost/node/claude/customizations/scan/claudeRuleScan.ts - the `CLAUDE.md` files and `.claude/rules/**/*.md` as rules
  - https://code.claude.com/docs/en/skills - the four places for a skill, and which one wins on the same name
---

## Goal

A client's Agent Customizations list opens each skill, command, agent and rule of a Claude session in the file the CLI read it from.
A skill names its `SKILL.md` file, not a folder or a path that does not exist.
The project's own files show beside the personal ones, and the `CLAUDE.md` files and `.claude/rules` show as rules.
A skill with no file shows its name and opens nothing.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "customizationsOf\(" packages/agent-claude/src` - the session in `servers.ts`, the probe in `probe.ts`, and one MCP server in `servers.ts:133`.
- `rg -n "CLAUDE_CONFIG_DIR" packages/agent-claude/src` - `catalog.ts`, `transcript.ts` and `query.ts` read it from the session's environment.
- `ls ~/.claude/skills/synced/*/` - one folder per skill beside `manifest.json`, whose `skills` entries carry `name`, `skillId`, `description`, `source` and `updatedAt`.
- `grep -a "skills/synced" <SDK binary>` - the CLI of the SDK 0.3.301 reads the synced skills itself.
- `grep -a "/etc/claude-code" <SDK binary>` - the managed directory is `/etc/claude-code`, `/Library/Application Support/ClaudeCode` or `C:\Program Files\ClaudeCode`.

### Runtime path

```
the CLI's handshake -> initializationResult, reloadSkills, reloadPlugins -> laid in servers.ts
  -> customizationsOf -> session/customizationsChanged -> a client's customization list
```

### Gaps

- A skill's `uri` is a folder made from its name, and nothing checks it.
- A command's `uri` is made from its name, and nothing checks it.
- A skill the CLI ships, or a synced skill, gets a `file:` URI that names no file.
- No project directory is sent, and no directory is sent with no children.
- No rule is sent.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The backend reads the skill, command, agent and rule files from disk, and matches them by name with what the SDK reports | the brief, *The change* | 01, 02 |
| A skill's `uri` is its `SKILL.md` file, and a command's and an agent's `uri` is its `.md` file | the brief, *The change* | 02 |
| The project scope, `<working directory>/.claude/<kind>`, is read in this change | Softov, 2026-10-30: "this I think" | 01, 02 |
| A writable directory is sent with no children too | Softov, 2026-10-30: "yes, send them" | 02 |
| On the same name, the one the CLI runs is listed: managed over personal over project, and a skill over a command | Softov, 2026-10-30: "preference for the one that the harness will use" | 02 |
| The managed skills in `<managed directory>/.claude/skills/` are read, because the CLI runs them over a personal skill | follows from the row above; the SDK 0.3.301 names the managed directory | 01 |
| The managed skills go in a directory with `writable: false` | (defaulted: a person cannot write there without root) | 02 |
| SDK skills with no file go in one `builtin` directory with `writable: false`, with the name and the description the SDK gives | Softov, 2026-10-30: "yes" | 02 |
| The synced skills go in a `synced` directory with `writable: false`, each with its real `SKILL.md` as its `uri` | Softov, 2026-10-31, chose "Read-only synced folder" | 01, 02 |
| A synced skill matches the SDK's `anthropic-skills:<name>` and its bare `<name>` | the SDK 0.3.301 | 02 |
| A skill or command the SDK reports and the disk read does not find gets `claude-internal:/skill/<name>` or `claude-internal:/command/<name>`, as an agent gets `INTERNAL_AGENT` | the brief; [code://packages/agent-claude/src/session/customizations.ts#L260-L271](../../../../packages/agent-claude/src/session/customizations.ts#L260-L271) | 02 |
| A file the disk read finds and the SDK does not report is not listed | (defaulted: VS Code's `buildDiscoveredCustomizations` does the same) | 02 |
| A plugin skill's `uri` is `<plugin>/skills/<name>/SKILL.md` when that file is there | (defaulted: the same rule as a personal skill) | 02 |
| The personal scope is the session's `CLAUDE_CONFIG_DIR`, or `~/.claude` when it is not set | [code://packages/agent-claude/src/catalog.ts#L81-L82](../../../../packages/agent-claude/src/catalog.ts#L81-L82) | 01 |
| A session in a machine reads nothing from disk, and every entry gets an internal URI | (defaulted: its CLI reads its own config volume, not this host's files) | 02 |
| A command is read from `<scope>/commands/*.md` only, not from a subfolder | (defaulted: a subfolder command gets an internal URI until a later plan reads it) | 01 |
| The rules are a `rules` directory per scope, with `globs` from a `paths` frontmatter and `alwaysApply: true` otherwise | the brief; VS Code's `scanClaudeRules` | 01, 03 |
| ahpw keeps its `/SKILL.md` suffix; dropping it is ahpw's own change | the brief, *Who writes* | - |

## Proposed architecture

- **Data flow** - `disk.ts` reads the scopes and returns the files it found, each with its kind, name, scope and path. `customizationsOf` matches that list with the SDK's lists, and lays out the directories and their children.
- **Event flow** - unchanged: `laid` emits `session/customizationsChanged` with the whole list.
- **State flow** - nothing is kept; the disk read runs each time `laid` runs.
- **Layer responsibilities** - agent-claude: `disk.ts` reads, `customizations.ts` matches and lays out, `servers.ts` and `probe.ts` pass the read. docs: the README says where each entry comes from.
- **Source-of-truth files** - [`code://packages/agent-claude/src/session/customizations.ts`](../../../../packages/agent-claude/src/session/customizations.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The disk read finds each file](task-01-the-disk-read-finds-each-file.md) | done | - |
| [02 - Each entry names its file](task-02-each-entry-names-its-file.md) | done | 01 |
| [03 - The rules are listed](task-03-the-rules-are-listed.md) | done | 02 |

## Risks and tradeoffs

- The directory ids change from `directory:<kind>` to `directory:<scope>:<kind>`. A client that kept a decision under the old id loses it; no client switches a directory today.
- The disk read runs on each `laid`, so a large `.claude/rules` tree costs a walk per switch. The walk reads only frontmatter, under the size limit `agentNameOf` uses.
- A skill folder can be a symbolic link. The read follows it, as the CLI does, and reads only a regular file at the end.

## Resume state

- **Done so far:** planned 2026-10-31, and tasks 01 to 03 implemented on 2026-10-31. See [implemented.md](implemented.md).
- **Next action:** none. Softov passed the checks in VS Code on 2026-11-03.
- **Open questions:** none.
- **Watch out for:** the reload plan [claude/20261031-0258-a-written-agent-shows-at-once](../20261031-0258-a-written-agent-shows-at-once/plan.md) edits `customizations.ts` and `servers.ts` too, so it starts after this plan is merged.

## Final verification checklist

- [x] `advisor` names `~/.claude/skills/advisor/SKILL.md`, and a client opens it.
- [x] A synced skill names its `SKILL.md` under `~/.claude/skills/synced/`, in a directory a client is not offered to write.
- [x] `code-review` is in the `builtin` directory, with an internal URI.
- [x] A session whose working directory has `.claude/skills` lists those skills in a project directory.
- [x] A personal skill and a project skill with the same name list the personal one only.
- [x] Each scope sends its `agents`, `skills`, `commands` and `rules` directories with no children too.
- [x] `CLAUDE.md` and a file in `.claude/rules` show as rules.
- [x] `pnpm typecheck` and the agent-claude suite pass, and Windows CI is green.
