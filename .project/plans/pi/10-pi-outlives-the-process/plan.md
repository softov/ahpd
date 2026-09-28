---
title: pi's models and history outlive the process, and pi loads without holding the daemon
domain: pi
status: active
priority: high
created: 2026-09-28
revalidated: 2026-09-28
requires:
  - plans/pi/01-a-turn-ends-as-it-ended/plan.md
changes: []
creates: []
decisions:
  - decisions/pi-models-are-probed-from-pis-model-runtime.md
  - decisions/a-pi-session-from-disk-is-replayed-through-the-live-mapping.md
refs:
  - "[code://packages/agent-pi/src/backend.ts#L16-L30](../../../../packages/agent-pi/src/backend.ts#L16-L30) - the runtime imports of pi, taken when the plugin module loads"
  - "[code://packages/agent-pi/src/catalog.ts#L15](../../../../packages/agent-pi/src/catalog.ts#L15) - `SessionManager`, imported at module load"
  - "[code://packages/agent-pi/src/tools.ts#L14-L16](../../../../packages/agent-pi/src/tools.ts#L14-L16) - `defineTool` and `Type`, imported at module load"
  - "[code://packages/agent-pi/src/agent.ts#L95-L105](../../../../packages/agent-pi/src/agent.ts#L95-L105) - `probe`, which answers no models"
  - "[code://packages/agent-pi/src/agent.ts#L111-L114](../../../../packages/agent-pi/src/agent.ts#L111-L114) - `transcript`, which answers only a watched session"
  - "[code://packages/agent-pi/src/transcript.ts](../../../../packages/agent-pi/src/transcript.ts) - `turnsOf` over the watched record"
  - "[code://packages/agent-pi/src/mapping.ts#L88-L242](../../../../packages/agent-pi/src/mapping.ts#L88-L242) - `mapEvent`, which the replay feeds"
  - "[code://packages/agent-pi/src/session.ts#L170](../../../../packages/agent-pi/src/session.ts#L170) - `ends`, which `endPoint` answers from"
  - "[code://packages/agent-pi/README.md#L62-L66](../../../../packages/agent-pi/README.md#L62-L66) - the README states both gaps"
  - "[code://packages/sdk/src/host.ts#L2135-L2150](../../../../packages/sdk/src/host.ts#L2135-L2150) - the boot probe"
  - "[code://packages/agent-claude/src/transcript.ts#L54](../../../../packages/agent-claude/src/transcript.ts#L54) - the sibling rebuilds from its own store"
  - "[code://packages/agent-cofold/src/transcript.ts#L171](../../../../packages/agent-cofold/src/transcript.ts#L171) - the other sibling does the same"
  - npm://@earendil-works/pi-coding-agent@^0.87.1 - `ModelRuntime.create`, `getAgentDir`, `SessionManager.findById`, `SessionManager.open`, `getBranch()`
---

## Goal

A pi session shows its models in a client's picker before any turn runs and after a restart, a pi session opened after a restart shows its whole conversation, and the daemon starts without waiting for pi's SDK to load.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- Timed on 2026-09-28: importing `@earendil-works/pi-coding-agent` takes 4.8 s, the rest of agent-pi 0.56 s, agent-cofold 0.22 s; the daemon's log showed the 5 s between the two plugin lines.
- `dist/core/agent-session-services.js` - a session's `ModelRuntime` is `ModelRuntime.create({ authPath: <agentDir>/auth.json, modelsPath: <agentDir>/models.json })`; only project extensions register providers per directory.
- Softov's session files on 2026-09-28 hold a leading `system` message with empty `content` and `sections`, `model_change`, `thinking_level_change`, `context_edit`, and assistant messages with `stopReason` `stop` or `error`.

### Runtime path

```
daemon boot -> plugin apply (no pi import) -> host probe -> [new] pi ModelRuntime -> models in root/agentsChanged
client opens a listed pi session -> Agent.transcript(id) -> watched? live record : [new] SessionManager.open(file).getBranch()
  -> [new] entries replayed as pi events -> mapEvent -> sealed turns, each with its end entry id
resumed session -> [new] ends seeded from the same replay -> endPoint answers
```

### Gaps

- The probe answers no models, so the picker is empty until a turn has run.
- A session this process did not watch has no transcript.
- Every runtime import of pi is taken when the plugin module loads.

## Decisions locked in

| Decision | Tasks |
| --- | --- |
| [pi's models are probed from pi's model runtime, before any session opens](../../../decisions/pi-models-are-probed-from-pis-model-runtime.md) | 02 |
| [A pi session from disk is replayed through the live mapping, and its turns keep their entry ids](../../../decisions/a-pi-session-from-disk-is-replayed-through-the-live-mapping.md) | 03 |

| What | Source | Task |
| --- | --- | --- |
| agent-pi imports pi's SDK on first use, not when the plugin loads. | Softov, 2026-09-28, asked what should change in plugin loading: "Logs + agent-pi imports pi lazily". | 01 |
| The plugin starts pi's import in the background at apply, and `stateFile` answers `undefined` until it has resolved. | (defaulted: `Agent.stateFile` is synchronous, [`code://packages/sdk/src/types/agent.ts#L392`](../../../../packages/sdk/src/types/agent.ts#L392); Softov may prefer an async contract instead) | 01 |
| The empty-transcript problem becomes this plan's task 03, and its file is deleted. | Softov, 2026-09-28, answering where a listed pi session's turns come from: "Rebuild from pi's file". | 03 |
| The dev loader registers its resolver in-thread with `registerHooks`, falling back to `register`. | Softov, 2026-09-28, asked whether to switch `scripts/dev.mjs` so pi's import blocks about a second instead of four: "Yes, as a task". | 05 |
| Subagents build the tasks, and each is reviewed before Softov's review. | Softov, 2026-09-28, asked who builds it: "Subagents, I review". | - |
| A resumed session's watched record starts with the replayed turns, and a replayed turn whose last answer was aborted is `cancelled`. | Softov, 2026-09-28, asked whether to fix the resumed record and the aborted state: "Fix both now". | 04 |
| A replayed failed turn keeps the error part `chat/error` carries. | Softov, 2026-09-28, asked whether a replayed failed turn keeps its error part: "Keep it in the replay". | 04 |
| A new pi session is saved under the client's session id, a fork under a fresh one, as claude and cofold do. | Softov, 2026-09-28, asked how to fix "No agent for session" after a restart: "Plan and build now". | 06 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - agent-pi loads without importing pi](task-01-agent-pi-loads-without-importing-pi.md) | implemented | - |
| [02 - The probe answers pi's models](task-02-the-probe-answers-pis-models.md) | implemented | 01 |
| [03 - A session from disk is replayed into turns](task-03-a-session-from-disk-is-replayed.md) | implemented | 01 |
| [04 - A resumed session keeps its history](task-04-a-resumed-session-keeps-its-history.md) | implemented | 03 |
| [05 - The dev loader resolves on the main thread](task-05-the-dev-loader-resolves-in-thread.md) | implemented | 01 |
| [06 - A new pi session is saved under the id the client named](task-06-a-new-session-is-saved-under-the-clients-id.md) | implemented | 01 |

## Risks and tradeoffs

- The first pi call after boot pays the 4.8 s import; the boot probe starts it in the background, so it is usually paid before a person asks.
- The replay must raise events in pi's live order (start before the hook's ready, end after), or `mapEvent` readies and completes rows differently from a live turn.
- A session file pi cannot open answers `undefined`, which the host already treats as a failed read and not as an empty session.

## Resume state

- **Done so far:** tasks 01 to 06 are implemented and await review.
- **Next action:** review of tasks 01 to 06, then Softov's checks by hand in the final checklist.
- **Open questions:** none.
- **Watch out for:** a type-only import of pi stays static; only runtime values move behind the lazy import.

## Final verification checklist

- [ ] The daemon logs agent-pi loaded well under a second after agent-cofold.
- [ ] After a restart, a new pi session's picker lists pi's models before the first turn.
- [ ] After a restart, a pi session from the list opens with its turns, and a truncation on it is accepted.
- [ ] `pnpm typecheck`, `pnpm boundary`, `pnpm test` green.
- [ ] `plans/index.md` updated.
