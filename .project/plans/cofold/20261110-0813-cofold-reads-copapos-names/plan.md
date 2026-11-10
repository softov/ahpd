---
title: cofold reads copapo's names
domain: cofold
status: planned
priority: medium
created: 2026-11-10
revalidated: 2026-11-10
requires: []
changes:
  - specs/cofold-backend.md
creates: []
refs:
  - git://7d76d5895 - the commit of ahpd this plan was checked at
  - git://962cdc23e:.project/briefs/ahpd-runs-copapo-and-names-itself.md - the brief this plan covers, with the copapo preset and the app name in the other two plans
  - "[code://packages/agent-cofold/src/config.ts#L41-L54](../../../../packages/agent-cofold/src/config.ts#L41-L54) - `harnessConfigPath`, which reads `PAPO_CONFIG` and `papo/config.json`"
  - "[code://packages/agent-cofold/src/config.ts#L59-L82](../../../../packages/agent-cofold/src/config.ts#L59-L82) - `harnessConfig`, which calls `resolveConfig` with the name `papo` and the project file `.papo.json`"
  - "[code://packages/agent-cofold/src/config.ts#L106-L107](../../../../packages/agent-cofold/src/config.ts#L106-L107) - the variables `PAPO_*` over `COFOLD_*`"
  - "[code://packages/agent-cofold/src/agent.ts#L934-L998](../../../../packages/agent-cofold/src/agent.ts#L934-L998) - a machine's harness file at `papo/config.json`, named by `PAPO_CONFIG`"
  - "[code://packages/agent-cofold/src/plugin.ts#L222](../../../../packages/agent-cofold/src/plugin.ts#L222) - the template description, which names papo's files"
  - "[code://tools/test-tmpdir.ts#L46](../../../../tools/test-tmpdir.ts#L46) - the test setup, which keeps a test from reading the person's papo file"
  - npm://@cofold/config@^0.3.1 - `resolveConfig({ name })` reads `$<NAME>_CONFIG`, `<XDG>/<name>/config.json` and the project file it is given
  - https://github.com/softov/cofold/blob/3551a23/packages/copapo/src/config.ts - copapo's own names: `COPAPO_CONFIG`, `copapo/config.json`, `.copapo.json`, `COPAPO_*` over `COFOLD_*`
---

## Goal

agent-cofold reads the harness configuration under copapo's names, as cofold's app copapo reads it.
A person keeps one file, `~/.config/copapo/config.json`, for copapo and for ahpd's cofold agents.
papo's names are no longer read.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `git grep -n -i papo -- ':!.project'` - the source in `config.ts`, `agent.ts` and `plugin.ts`, and comments in `mapping.ts` and `turnagent.ts`. Also the README, `package.json`, `PLUGINS.md`, `COMPUTERS.md`, `tools/test-tmpdir.ts`, and tests in agent-cofold, sdk and server.
- `grep -n _CONFIG node_modules/@cofold/config/dist/index.js` - the resolver names the variable from the name: `copapo` gives `COPAPO_CONFIG`.

### Runtime path

```
harnessConfig() -> resolveConfig({ name, project }) -> user file, project file, $<NAME>_CONFIG
  -> <NAME>_BASE_URL, _API_KEY, _MODEL over COFOLD_* -> providers and model -> a turn's endpoint
machine needs -> cofoldState seed and cofoldConfig mount at <configDir>/<name>/config.json -> <NAME>_CONFIG
```

### Gaps

- Comments that link papo's source at cofold `ee48196` keep working, because they name a commit. They change only where they name a file this plan renames.

## Answers

| What | Source | Task |
| --- | --- | --- |
| agent-cofold reads copapo's names only, with no papo fallback | Softov, 2026-11-10, chose "copapo names only, at once" | 01 |
| A machine made before the change is remade by the person; there is no migration | Softov, 2026-11-10, chose "The person remakes it" | 01 |
| `COPAPO_*` win over `COFOLD_*`, as copapo reads them | https://github.com/softov/cofold/blob/3551a23/packages/copapo/src/config.ts | 01 |
| The release notes say that the file moves and that a cofold machine is remade | (defaulted: a host with the old file finds no providers until the person moves it) | 02 |

## Proposed architecture

- **Data flow** - `harnessConfig` reads `copapo` in place of `papo`; nothing else in a turn changes.
- **Event flow** - none.
- **State flow** - a machine's state volume holds `copapo/config.json`; an old volume holds `papo/config.json`, which nothing reads.
- **Layer responsibilities** - agent-cofold: the names. docs: the README, `PLUGINS.md`, `COMPUTERS.md`, the release notes and the spec.
- **Source-of-truth files** - [`code://packages/agent-cofold/src/config.ts`](../../../../packages/agent-cofold/src/config.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The harness reads copapo's names](task-01-the-harness-reads-copapos-names.md) | implemented | - |
| [02 - The docs say copapo](task-02-the-docs-say-copapo.md) | implemented | 01 |

## Risks and tradeoffs

- A host whose file is at `~/.config/papo/config.json` lists no cofold models after the update. The release notes say to move it.
- A cofold machine made before the update finds no providers. The release notes say to remake it.

## Resume state

- **Done so far:** tasks 01 and 02 implemented 2026-11-10.
- **Next action:** Softov's review, then `done` on each task. No task is left.
- **Open questions:** none.
- **Watch out for:** `tools/test-tmpdir.ts` keeps a test from reading the person's own file. Point it at copapo's file, or a test reads `~/.config/copapo/config.json` on Softov's box.

## Final verification checklist

- [ ] A cofold agent on a host with `~/.config/copapo/config.json` lists that file's models.
- [ ] `COPAPO_BASE_URL`, `COPAPO_API_KEY` and `COPAPO_MODEL` win over `COFOLD_*`.
- [ ] A new cofold machine has `COPAPO_CONFIG` pointing at `<configDir>/copapo/config.json`.
- [ ] `git grep -n -i papo -- ':!.project'` finds only links to cofold commits.
- [ ] `pnpm typecheck` and the agent-cofold, sdk and server suites pass, and Windows CI is green.
