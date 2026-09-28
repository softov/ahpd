---
title: An ACP spec says what its machine needs
domain: container
status: planned
priority: high
created: 2026-09-26
revalidated: 2026-09-26
requires:
  - plans/container/05-an-agent-in-a-machine-p1-a-secret-reaches-a-machine-by-name/plan.md
changes: []
creates: []
decisions:
  - decisions/an-agent-declares-its-machine-needs-with-a-method.md
refs:
  - "[code://packages/agent-acp/src/plugin.ts#L61-L92](../../../../packages/agent-acp/src/plugin.ts#L61-L92) - `optionsOf` and `apply`: one spec is one backend"
  - "[code://packages/agent-acp/src/types.ts#L42-L60](../../../../packages/agent-acp/src/types.ts#L42-L60) - `AcpOptions`"
  - "[code://packages/agent-acp/src/session.ts#L457-L481](../../../../packages/agent-acp/src/session.ts#L457-L481) - `placed()`, the spawn in a machine"
  - "[code://packages/sdk/src/types/agent.ts#L326](../../../../packages/sdk/src/types/agent.ts#L326) - `machine()` on the agent contract"
  - "[code://packages/agent-cofold/src/agent.ts#L542-L560](../../../../packages/agent-cofold/src/agent.ts#L542-L560) - cofold's `machine()`, the pattern to mirror"
  - "[code://docs/PLUGINS.md#L600-L603](../../../../docs/PLUGINS.md#L600-L603) - the ACP section, which still says `--experimental-acp`"
---

## Goal

An ACP spec can say what a machine needs to run it: its config dir variable, the files seeded into it, and the names of its secrets.
Sign-in is [acp 04](../../acp/04-the-bridge-signs-in/plan.md) and presets are [acp 05](../../acp/05-presets/plan.md); container p5 adds each preset's machine block.

## Reconnaissance

### Searches performed

- `rg "machine" packages/agent-acp/src` - no `machine()`.

### Runtime path

```
spec { machine } -> acpAgent().machine() -> profile / disposable machine made with env, copy and secret needs
```

### Gaps

- agent-acp declares no needs, so a machine for Codex or Gemini is hand-written mounts.
- Resume by `session/resume` is not here: plugin 18 does it.

## Decisions locked in

| Decision | Task |
| --- | --- |
| [An agent declares what a machine needs through a machine() method](../../../decisions/an-agent-declares-its-machine-needs-with-a-method.md) | 01 |

| What | Source | Task |
| --- | --- | --- |
| Each agent's state goes to a per-machine dir named by its own variable, never the host's home | the proposal Softov asked to plan, 2026-09-26 | 01, 03 |
| A secret is an env need whose default is the daemon's own variable of that name | (defaulted: the value a person already exported for the host-side agent) | 01 |
| Sign-in and presets move to the acp domain | Softov, 2026-09-26, asked "Container 05 p2 already has ACP sign-in and the presets. Where do they live?", answered "Sign-in moves to acp" | 02, 03 |

## Proposed architecture

- **Data flow** - `optionsOf` reads `machine`; `acpAgent` answers `machine()` from `options.machine`.
- **Layer responsibilities** - `@ahpd/agent-acp` only.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A spec declares what its machine needs](task-01-a-spec-declares-what-its-machine-needs.md) | todo | - |
| [02 - A spec may sign in after initialize](task-02-a-spec-may-sign-in.md) | dropped | - |
| [03 - Presets for the ACP agents](task-03-presets.md) | dropped | - |
| [04 - Docs](task-04-docs.md) | todo | 01 |

## Risks and tradeoffs

- A machine env value like `CODEX_HOME=/ahpd/codex` must never reach a host spawn - `machine.env` is delivered only to a machine.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-a-spec-declares-what-its-machine-needs.md](task-01-a-spec-declares-what-its-machine-needs.md).
- **Open questions:** none.
- **Watch out for:** `machine()` is read at create with the live agent list, so a spec added later is seen by the next machine only.

## Final verification checklist

- [ ] A disposable machine for a spec with `machine: { env: { COPILOT_HOME: "/ahpd/copilot" }, secrets: ["COPILOT_GITHUB_TOKEN"] }` gets both by name, and a session answers a turn.
- [ ] `pnpm test`, `pnpm typecheck` green.
- [ ] `docs/PLUGINS.md`, `plans/index.md` updated.
