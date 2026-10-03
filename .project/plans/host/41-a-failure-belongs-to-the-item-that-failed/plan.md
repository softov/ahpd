---
title: A failure belongs to the item that failed, and a start says what it skipped
domain: host
status: built
priority: high
created: 2026-10-03
requires:
  - plans/claude/15-one-load-and-each-preset-is-a-variant/plan.md
refs:
  - "[code://packages/sdk/src/plugins.ts#L124-L135](../../../../packages/sdk/src/plugins.ts#L124-L135) - the fold: a clashing agent is reported with `AGENT_CLASH` and still added"
  - "[code://packages/server/src/commands/run.ts#L607-L623](../../../../packages/server/src/commands/run.ts#L607-L623) - load problems are stamped to the log, and a clash exits the daemon"
  - "[code://packages/sdk/src/host.ts#L4134-L4148](../../../../packages/sdk/src/host.ts#L4134-L4148) - the listing: a session recorded for an agent not served goes to the first agent that listed it"
  - "[code://packages/sdk/src/host.ts#L3586-L3594](../../../../packages/sdk/src/host.ts#L3586-L3594) - `keepProvider`, which rewrites the record on open"
  - "[code://packages/server/src/commands/restart.ts#L61-L63](../../../../packages/server/src/commands/restart.ts#L61-L63) - the restart's `STARTING` and `restarted` lines, the only ones the terminal shows"
  - "[code://packages/server/src/commands/start.ts](../../../../packages/server/src/commands/start.ts) - the detached start, which waits for the daemon to be ready"
---

## Goal

One bad item fails alone, and the person starting the daemon is told.
An agent whose provider id another plugin already registered is dropped with a problem line, and the rest of both plugins load.
A session recorded for an agent that did not load stays listed under that agent, refuses to open with a sentence naming it, and keeps its record, so it comes back as it was when the agent loads again.
`ahpd start` and `ahpd restart` print every skipped plugin and preset before their success line, and still exit 0 while any agent loaded.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "AGENT_CLASH" packages` - the fold that reports it and `run.ts`, which exits on it.
- `rg -n "kept.provider|setProvider" packages/sdk/src/host.ts` - the listing's fallback and `keepProvider`.

### Runtime path

```
loadPlugins -> fold (clash) -> run.ts (stamp, exit) -> host listing (recorded provider or first lister) -> open (keepProvider rewrites)
```

### Gaps

- On 2026-10-03 a daemon started without `OPENROUTER_API_KEY` lost every Claude agent, and the terminal said nothing; claude/16 makes that one preset's loss, this plan makes it visible and keeps its sessions where they were.
- A `claude-openrouter` session listed while its agent is missing opens on `claude`, and the open rewrites its record, so it stays on `claude` and on another endpoint after the agent is back.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| A provider clash drops only the clashing agent | Softov, 2026-10-03, asked "when one plugin's agent has the same provider id as another plugin's, what fails?": "Only that agent" | 01 |
| A session whose recorded agent did not load is listed under it, not openable, and its record is never rewritten | Softov, 2026-10-03, asked "what happens to a session whose recorded agent didn't load?": "Listed, not openable" | 02 |
| `start` and `restart` print skipped plugins and presets, and exit 0 while any agent loaded | Softov, 2026-10-03, asked "how does ahpd start / ahpd restart report plugins that were skipped?": "Print, exit 0" | 03 |
| The agent registered first keeps the id; base agents before plugins, plugins in `plugins` order | (defaulted: the order the fold already reads them in) | 01 |
| A plugin reports a skipped item through a new `PluginHost.problem(line)`, collected with the loader's problems | (defaulted: `host.log` reaches only daemon.log, and the start must print it) | 03 |
| A session never recorded keeps today's fallback to the first agent that lists it | (defaulted: it has no recorded agent to wait for) | 02 |

## Proposed architecture

- **Data flow** - the fold skips a clashing agent instead of adding it; `run.ts` no longer exits on `AGENT_CLASH`. The listing answers a recorded-but-missing provider's session under that provider; an open of it refuses. Load problems, and the preset lines claude/16 logs, reach the starting terminal.
- **Layer responsibilities** - sdk: the fold and the session listing and open · server: the start and restart output.
- **Source-of-truth files** - [`code://packages/sdk/src/plugins.ts`](../../../../packages/sdk/src/plugins.ts), [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts), [`code://packages/server/src/commands/restart.ts`](../../../../packages/server/src/commands/restart.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A clashing agent is dropped alone](task-01-a-clashing-agent-is-dropped-alone.md) | done | - |
| [02 - A session waits for its own agent](task-02-a-session-waits-for-its-own-agent.md) | done | - |
| [03 - Start and restart say what was skipped](task-03-start-and-restart-say-what-was-skipped.md) | done | - |

## Risks and tradeoffs

- A client may hide a session whose provider is not in the root `agents` list; it is still not moved or rewritten, which is the point.
- A clash no longer stops the daemon; task 03 is what makes it seen.

## Resume state

- **Done so far:** built 2026-10-03, see [implemented.md](implemented.md).

## Final verification checklist

- [x] A plugin registering `pi` beside agent-pi loads its other agents, agent-pi keeps `pi`, and the daemon runs.
- [x] With `claude-openrouter` not loaded, its session is listed as `claude-openrouter:/<id>`, opening it answers a sentence naming the missing agent, and once the agent loads it opens there with its record unchanged.
- [x] `ahpd start` and `ahpd restart` print each skipped plugin and preset before the success line and exit 0.
- [x] `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass.
- [x] `plans/index.md` updated.
