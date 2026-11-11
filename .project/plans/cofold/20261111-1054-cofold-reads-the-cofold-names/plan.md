---
title: cofold reads the cofold names
domain: cofold
status: planned
priority: medium
created: 2026-11-11
revalidated: 2026-11-11
requires:
  - file:///github/cofold/.project/plans/cli/20261111-0517-copapo-uses-the-cofold-names
changes:
  - specs/cofold-backend.md
creates: []
refs:
  - git://ea240db71 - the commit of ahpd this plan was checked at
  - file:///github/cofold/.project/plans/cli/20261111-0517-copapo-uses-the-cofold-names/deferred.md - the four rows of ahpd's side, which this plan covers
  - file:///github/cofold/.project/plans/cli/20261111-0517-copapo-uses-the-cofold-names/plan.md - copapo's new names, and its answer to drop the old ones at once
  - "[code://.project/plans/cofold/20261110-0813-cofold-reads-copapos-names/plan.md](../20261110-0813-cofold-reads-copapos-names/plan.md) - the papo to copapo move, whose shape this plan copies"
  - "[code://packages/agent-cofold/src/config.ts#L41-L107](../../../../packages/agent-cofold/src/config.ts#L41-L107) - `harnessConfigPath`, `harnessConfig` and `variable`, which read `COPAPO_CONFIG`, `copapo/config.json`, `.copapo.json` and `COPAPO_*` over `COFOLD_*`"
  - "[code://packages/agent-cofold/src/agent.ts#L947-L1004](../../../../packages/agent-cofold/src/agent.ts#L947-L1004) - a machine's harness file, seeded and mounted at `copapo/config.json` and named by `COPAPO_CONFIG`"
  - "[code://packages/agent-cofold/src/plugin.ts#L222](../../../../packages/agent-cofold/src/plugin.ts#L222) - the template description, which names copapo's files"
  - "[code://packages/sdk/src/machines/agents.ts#L210-L223](../../../../packages/sdk/src/machines/agents.ts#L210-L223) - the copapo machine profile, which names `COPAPO_BASE_URL`, `COPAPO_API_KEY`, `COPAPO_MODEL` and `COPAPO_CONFIG`"
  - "[code://packages/agent-acp/src/presets.ts#L107-L111](../../../../packages/agent-acp/src/presets.ts#L107-L111) - `xdgOf`, which seeds `~/.config/<id>/` by the preset's id"
  - "[code://packages/agent-acp/src/presets.ts#L211-L217](../../../../packages/agent-acp/src/presets.ts#L211-L217) - the copapo ACP preset, which seeds `~/.config/copapo/config.json`"
  - "[code://packages/computer/images/versions.json#L133-L141](../../../../packages/computer/images/versions.json#L133-L141) - the copapo part, pinned to `@cofold/copapo` 0.1.0"
  - "[code://packages/computer/images/parts/copapo/package.json](../../../../packages/computer/images/parts/copapo/package.json) - the part's own pin, 0.1.0"
  - "[code://tools/test-tmpdir.ts#L44-L51](../../../../tools/test-tmpdir.ts#L44-L51) - the test setup, whose comment names copapo's file"
  - npm://@cofold/config@^0.3.1 - `resolveConfig({ name })` reads `$<NAME>_CONFIG`, `<XDG>/<name>/config.json` and the project file it is given
  - npm://@cofold/copapo - 0.1.0 is the last version on npm at this plan; it reads the copapo names
---

## Goal

agent-cofold reads the harness configuration under the cofold names, as copapo reads it after its rename.
A person keeps one file, `~/.config/cofold/config.json`, for copapo and for ahpd's cofold agents.
The copapo names are no longer read, and a copapo machine runs a copapo that reads the same names.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `git grep -n -E "COPAPO_(CONFIG|BASE_URL|API_KEY|MODEL|BACKEND|WORKSPACE)|\.copapo\.json|config/copapo|copapo/config\.json|name: 'copapo'"` - the source in `agent-cofold`, the sdk machine profile, the docs, the spec, and tests in agent-cofold, agent-acp, sdk and server.
- `git grep -n -i copapo -- packages/agent-acp/src packages/computer/images` - the ACP preset, the part and its pin.
- `git tag --contains 7a59a9bd1` - no tag, so no release read the copapo names; `v0.15.0-rc.1` reads papo's.
- `npm view @cofold/copapo versions` - `0.0.1` and `0.1.0`; neither reads the cofold names.

### Runtime path

```
harnessConfig() -> resolveConfig({ name: 'cofold', project: '.cofold.json' }) -> user file, project file, $COFOLD_CONFIG
  -> COFOLD_BASE_URL, _API_KEY, _MODEL -> providers and model -> a turn's endpoint
machine needs -> cofoldState seed and cofoldConfig mount at <configDir>/cofold/config.json -> COFOLD_CONFIG
copapo ACP preset -> seed ~/.config/cofold/config.json -> copapo part at the release with the cofold names
```

### Gaps

- The names of the program stay `copapo`, because they are not a setting.
- They are the part id, the preset key, the binary, the profile id and the state folders under `/ahpd/copapo`.
- Comments that name copapo the program, in `mapping.ts` and `turnagent.ts`, stay as they are.

## Answers

| What | Source | Task |
| --- | --- | --- |
| agent-cofold reads the cofold names only, with no copapo fallback | (defaulted: copapo drops the old names at once, Softov 2026-11-11 "Drop them at once", and the papo move was "copapo names only, at once", Softov 2026-11-10) | 01 |
| `COFOLD_BASE_URL`, `COFOLD_API_KEY` and `COFOLD_MODEL` are the only variables, with no second prefix | (defaulted: copapo reads `COFOLD_*` alone after its plan) | 01 |
| The copapo profile, the ACP preset and the part move with agent-cofold, in this plan | the cofold plan's `deferred.md`, which lists all four rows for ahpd | 01 |
| The part pins the first `@cofold/copapo` release that reads the cofold names | the cofold plan's `deferred.md`: the image pins copapo 0.1.0 | 01 |
| This plan is built after that release is on npm | (defaulted: a copapo machine would read the old names until the part moves) | 01 |
| A machine made before the change is remade by the person; there is no migration | (defaulted: as the papo move answered, Softov 2026-11-10 "The person remakes it") | 02 |
| The 0.15 release notes go from papo's names to the cofold names in one line | `git tag --contains 7a59a9bd1`: no release read the copapo names | 02 |

## Proposed architecture

- **Data flow** - `harnessConfig` reads `cofold` in place of `copapo`; nothing else in a turn changes.
- **Event flow** - none.
- **State flow** - a machine's state volume holds `cofold/config.json`; an old volume holds `copapo/config.json`, which nothing reads.
- **Layer responsibilities** - agent-cofold: the names. sdk: the profile's variables. agent-acp: the preset's seed. computer: the part's pin. docs: the rest.
- **Source-of-truth files** - [`code://packages/agent-cofold/src/config.ts`](../../../../packages/agent-cofold/src/config.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The harness reads the cofold names](task-01-the-harness-reads-the-cofold-names.md) | todo | - |
| [02 - The docs say the cofold names](task-02-the-docs-say-the-cofold-names.md) | todo | 01 |

## Risks and tradeoffs

- A host whose file is at `~/.config/copapo/config.json` lists no cofold models after the update. The release notes say to move it.
- A cofold or copapo machine made before the update finds no providers. The release notes say to remake it.
- The plan waits on a cofold release. Built before it, a copapo machine reads names its copapo does not know.

## Resume state

- **Done so far:** the plan, 2026-11-11.
- **Next action:** wait for the `@cofold/copapo` release with the cofold names, then [task-01-the-harness-reads-the-cofold-names.md](task-01-the-harness-reads-the-cofold-names.md).
- **Open questions:** none.
- **Watch out for:** `COFOLD_HOME` and `COFOLD_TRACE` are already cofold's names and stay. A blind `COPAPO_` to `COFOLD_` replace is safe, but a blind `copapo` replace renames the program.

## Final verification checklist

- [ ] A cofold agent on a host with `~/.config/cofold/config.json` lists that file's models.
- [ ] `COPAPO_BASE_URL` alone adds no provider; `COFOLD_BASE_URL` does.
- [ ] A new cofold machine has `COFOLD_CONFIG` pointing at `<configDir>/cofold/config.json`.
- [ ] A new copapo ACP machine is seeded from `~/.config/cofold/config.json` and runs the new copapo.
- [ ] `git grep -n -E "COPAPO_|\.copapo\.json|config/copapo|copapo/config\.json" -- packages tools docs .project/specs` finds only the release-note line that names the old names.
- [ ] `pnpm typecheck` and the agent-cofold, agent-acp, sdk, computer and server suites pass, and Windows CI is green.
