---
title: The facio backend declares tool effects, forks a conversation, and runs a client's tool
domain: plugin
status: active
priority: medium
created: 2026-09-20
revalidated: 2026-09-20
requires:
  - plans/plugin/03-agent-facio/plan.md
changes: []
creates: []
decisions:
  - decisions/host-tool-declares-what-it-does.md
  - decisions/facio-fork-and-rewind-needs-a-cut.md
refs:
  - code://.project/plans/plugin/03-agent-facio/plan.md - the plan this follows, and its implemented record
  - code://packages/sdk/src/types/host.ts#L279-L332 - `HostTool`, which task 01 gives an `effects`
  - code://packages/sdk/src/types/session.ts#L189-L203 - `forkPoint` and `endPoint`, which task 02 implements
  - code://packages/sdk/src/types/session.ts#L348-L367 - `completeToolCall` and `clientGone`, which task 03 implements
  - code://packages/agent-facio/src/tools.ts - where a bound tool is wrapped and a call's actions are built
  - code://packages/agent-facio/src/session.ts - the session task 02 and 03 extend
  - file:///github/facio/packages/agents/src/types/tool.ts - `ToolEffects`, the four flags task 01 carries
  - file:///github/facio/packages/agents/src/policy/rules.ts - the default that asks when a tool is destructive
  - file:///github/facio/packages/agents/src/types/store.ts - `RunRecord.inputMessageId` and `lastMessageId`, the slots a fork and a rewind cut at
  - code://packages/agent-claude/src/session.ts - a backend that already answers `forkPoint`, `endPoint` and `completeToolCall`
---

## Goal

Three things `@ahpd/agent-facio` left open are closed: a host tool can say that running it writes or is destructive, so a daemon configured only from a file can have one gated; a conversation can be forked at a turn and rewound to one; and a tool a connected client runs is offered, called, and waited for rather than left out.
A fourth arrived while testing: the backend reads the harness's own configuration, so a provider key already written for facio does not have to be lent or repeated.
Each is a capability a client already has for another backend, so a facio session stops being the one that cannot do what the window offers.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg "effects" /github/facio/packages/agents/src` - `ToolEffects` is `reads`, `writes`, `network`, `destructive`, `createTool` takes them, and the default policy asks when `destructive` is true, so a host tool that carries them is gated with no policy function.
- `rg "forkPoint|endPoint|completeToolCall|clientGone" packages/agent-claude/src` - one backend already answers all four, and the shapes are there to copy.
- `rg "forkAt|rewindAt|forkPoint" packages/sdk/src packages/agent-facio/src` - the SDK declares them and agent-facio leaves them unmapped with a comment, which task 02 replaces.
- `rg "owner" packages/agent-facio/src/tools.ts` - `facioTools` now leaves an owner-bound tool out, so the model is not offered a tool nothing can answer; task 03 is the round trip that puts it back.
- `Not found: a test that drives a client-run tool through any backend - searched "completeToolCall" in test/; the protocol path exists and is unexercised.`

### Gaps

- A `HostTool` has no `effects`, so a destructive host tool cannot be asked about by facio's default policy and a JSON-configured daemon can raise no approval for one.
- `Start.forkAt` and `Start.rewindAt` are unmapped, so the window's fork and rewind controls do nothing on a facio session.
- A `BoundTool` with an `owner` is dropped rather than offered, because the round trip that reports the call against its client and waits for the result is not built.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [A host tool says what running it does, and a destructive one is asked about by the policy that already exists](../../decisions/host-tool-declares-what-it-does.md) | Softov, 2026-09-20: "ok on the fix.. its better than my approach" |

| What | Source | Task |
| --- | --- | --- |
| Fork and rewind are bundled with this plan rather than with the ACP one | Softov, 2026-09-20: "bundle with extra plans" | 02 |
| A client's tool call is run by the client and waited for | Softov, 2026-09-20: "ok" | 03 |

## Proposed architecture

- **Data flow** - a tool's `effects` travel from its definition into facio's policy; a fork or a rewind turns an AHP turn id into a facio message id and starts a run at it; a client-owned call travels out as an action and its result comes back into the waiting run.
- **Event flow** - none of AHP's own; all three are behaviours of a backend.
- **State flow** - a fork opens a new facio session under a new id; a rewind keeps the id and drops what followed; a client call is held open in `session.ts` until the client answers or goes.
- **Layer responsibilities** - `packages/sdk`: the `HostTool.effects` field only. `packages/agent-facio`: `tools.ts` for the effects and the owner round trip, `session.ts` for the fork, the rewind and the waiting call.
- **Source-of-truth files** - `code://packages/sdk/src/types/host.ts`, `code://packages/agent-facio/src/tools.ts`, `code://packages/agent-facio/src/session.ts`.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A host tool says what it does](task-01-a-host-tool-says-what-it-does.md) | done | - |
| [02 - Fork and rewind a facio conversation](task-02-fork-and-rewind.md) | todo | - |
| [03 - A client runs its own tool](task-03-a-client-runs-its-own-tool.md) | done | - |
| [04 - The harness's own configuration is the default](task-04-the-harness-config-is-the-default.md) | done | - |

## Risks and tradeoffs

- `HostTool.effects` is a new field on a public type - it is optional and unset everywhere, so nothing existing changes, and the decision records why it is four flags and not one boolean.
- A fork is a second facio session under a new id, so a client that forks and then lists sees two rows - which is what a fork means, and the transcript of each is separate from the point it was cut.
- A client that announces a tool and then disappears leaves a call the model is waiting on - task 03 fails it through the same `clientGone` path the SDK already calls rather than letting a turn hang.
- The owner round trip depends on the host calling `completeToolCall`, which no test exercises today - task 03 writes that test, so the protocol path stops being unexercised.

## Resume state

- **Done so far:** task 01, a host tool's effects, task 03, a client's own tool, and task 04, the harness configuration, done 2026-09-20.
- **Next action:** [task-02-fork-and-rewind.md](task-02-fork-and-rewind.md), which is waiting on [facio-fork-and-rewind-needs-a-cut](../../decisions/facio-fork-and-rewind-needs-a-cut.md): fork only and refuse a rewind, a facio cut first and then both, or refuse both.
- **Open questions:**
  1. That decision, which is the only thing task 02 waits on; the reconnaissance is done and recorded in the task's Resume.
  2. Whether a rewind needs the run it drops to be cancelled first, since facio keeps one live run per session - proposed: yes, cancel through the existing path, and the test asserts one live run.
- **Watch out for:** a fork or a rewind on a session whose agent is still running is refused by the host rather than by the backend, so the bridge may assume it is starting fresh; and `RunRecord.inputMessageId` is absent for a run the store has only partly written, which must be a refusal and not a fork at the wrong place.

## Final verification checklist

- [ ] `pnpm test` green, with a destructive host tool gated by the default policy, a fork, a rewind, and a client-run tool.
- [ ] `pnpm typecheck` and `pnpm boundary` green.
- [ ] By hand: a window's fork and rewind work on a facio session, and a client tool offered to the model runs on the client.
- [ ] `docs/PLUGINS.md` names `effects` and what a destructive tool does.
- [ ] `plans/index.md` updated.
