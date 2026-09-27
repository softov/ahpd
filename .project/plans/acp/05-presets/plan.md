---
title: A spec can name a preset for a known ACP agent
domain: acp
status: planned
priority: medium
created: 2026-09-26
revalidated: 2026-09-26
requires:
  - plans/acp/04-the-bridge-signs-in/plan.md
changes: []
creates: []
decisions:
  - decisions/agent-package-only-when-it-brings-a-runtime.md
refs:
  - "[code://packages/agent-acp/src/plugin.ts#L61-L92](../../../../packages/agent-acp/src/plugin.ts#L61-L92) - `optionsOf` and `apply`: one spec is one backend, written out by hand"
  - "[code://packages/agent-acp/src/types.ts#L42-L60](../../../../packages/agent-acp/src/types.ts#L42-L60) - `AcpOptions`"
  - "[code://docs/PLUGINS.md#L594-L605](../../../../docs/PLUGINS.md#L594-L605) - the four configuration lines the docs show, one still `--experimental-acp`"
  - "[code://.project/plans/container/05-an-agent-in-a-machine-p3-parts-are-built-from-one-versions-file/plan.md](../../../../.project/plans/container/05-an-agent-in-a-machine-p3-parts-are-built-from-one-versions-file/plan.md) - where each agent's version is pinned"
  - https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json - the launch commands the table was checked against
---

## Goal

`{ "preset": "gemini" }` is a whole spec for a known ACP agent: its command, its arguments, its provider id and name, the switch that stops it updating itself, and the sign-in it needs; any field the spec sets wins.
A preset says how to run an agent on this host; what a machine needs to run it is added by container 05 p5.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Gaps

- Every spec is written out, and the docs' own example uses a deprecated Gemini flag.

## Decisions locked in

| Decision | Task |
| --- | --- |
| [A new `@ahpd/agent-*` package exists only when the target brings its own agent runtime](../../../decisions/agent-package-only-when-it-brings-a-runtime.md) | 01 |

| What | Source | Task |
| --- | --- | --- |
| Presets live in the acp domain; container 05 p2 keeps only machine needs | Softov, 2026-09-26, moving sign-in to acp, and the presets with it because they carry the sign-in | 01 |
| A hand-kept table for flags and switches; versions come from container 05 p3's `versions.json`, never from the preset | (defaulted: the registry has no config-dir or update-switch fields, and one place pins versions) | 01 |
| A preset field the spec also sets is the spec's | (defaulted: the spec is the person's words) | 01 |
| Only agents with an ACP server; Crush has none | the container research, 2026-09-26 | 01 |

## Proposed architecture

- **Layer responsibilities** - `presets.ts`: the table · `plugin.ts`: the merge.
- **Source-of-truth files** - `packages/agent-acp/src/presets.ts` once task 01 makes it.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The preset table, merged under a spec](task-01-the-preset-table.md) | todo | - |
| [02 - Docs](task-02-docs.md) | todo | 01 |

## Risks and tradeoffs

- A preset goes stale when an agent renames a flag - each row carries its check date, and container 05 p3's bump job is where a version move is noticed.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-the-preset-table.md](task-01-the-preset-table.md).
- **Open questions:**
  1. May one spec name a list of presets, registering one backend each? - proposed: no, one spec is one backend as today, so a preset's options stay per agent.
- **Watch out for:** container 05 p5 adds each preset's machine (part, config dir, secrets, seeds); keep the table's shape open to that block.

## Final verification checklist

- [ ] `{ "preset": "copilot" }` alone starts a Copilot session.
- [ ] `pnpm test`, `pnpm typecheck` green.
- [ ] `plans/index.md` updated.
