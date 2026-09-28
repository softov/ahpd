---
title: A plugin's agent sees every path the daemon serves
domain: plugin
status: built
priority: high
created: 2026-09-28
revalidated: 2026-09-28
requires:
  - plans/plugin/01-plugins-load-from-configuration/plan.md
changes: []
creates: []
decisions: []
refs:
  - "[code://packages/server/src/commands/run.ts#L382-L395](../../../../packages/server/src/commands/run.ts#L382-L395) - `loadPlugins` is called without `paths`"
  - "[code://packages/server/src/plugins.ts#L497](../../../../packages/server/src/plugins.ts#L497) - without `paths`, a plugin gets only `base.path`, the first served path"
  - "[code://packages/server/src/commands/run.ts#L215](../../../../packages/server/src/commands/run.ts#L215) - the same file passes `options.paths` elsewhere"
  - "[code://packages/agent-pi/src/plugin.ts#L80](../../../../packages/agent-pi/src/plugin.ts#L80) - agent-pi lists sessions in `host.paths`"
---

## Goal

An agent a plugin registers lists and opens sessions in every path the daemon serves, as the built-in agents do, and not only in the first.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- Reproduced on 2026-09-28 with a scratch daemon serving `/github/ahpapp`, `/github/ahpd` and `/github/ahpc`: agent-pi's `list()` answered 6 sessions when given the three paths, and the daemon's `listSessions` answered only the 2 in `/github/ahpapp`.

### Runtime path

```
run.ts -> loadPlugins(specs, { base, ... }) -> paths = options.paths ?? [base.path] -> pluginHost(paths) -> host.paths -> piAgent(..., host.paths)
```

### Gaps

- `run.ts` never passes `paths`, so `host.paths` is the first served path alone.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| `run.ts` passes every served path to `loadPlugins`. | Softov, 2026-09-28, asked how to handle plugins seeing only the first path: "Plan and build now". | 01 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The daemon hands plugins every served path](task-01-the-daemon-hands-plugins-every-path.md) | done | - |

## Risks and tradeoffs

- A plugin that assumed one path now sees several; `host.path` stays the first, so a plugin that reads only `path` is unchanged.

## Resume state

- **Done so far:** every task is `done`, reviewed by Softov on 2026-09-28; the plan is built, see [implemented.md](implemented.md).
- **Next action:** none.
- **Open questions:** none.
- **Watch out for:** nothing; `run.ts` is the only caller of `loadPlugins` in `packages/server/src`.

## Final verification checklist

- [ ] A daemon serving three paths lists a pi session from each.
- [ ] `pnpm typecheck`, `pnpm boundary`, `pnpm test` green.
- [ ] `plans/index.md` updated.
