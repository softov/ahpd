---
title: A cofold session in a computer runs in an ahpd started inside it
domain: container
status: planned
priority: medium
created: 2026-09-26
revalidated: 2026-09-26
requires:
  - plans/plugin/14-cofold-runs-its-own-tools/plan.md
  - plans/plugin/15-an-agent-says-what-a-machine-needs/plan.md
changes: []
creates: []
decisions:
  - decisions/a-cofold-session-in-a-computer-runs-in-a-nested-host.md
  - decisions/a-session-reaches-a-nested-host-through-a-generic-proxy.md
refs:
  - "[code://packages/agent-cofold/src/agent.ts#L605](../../../../packages/agent-cofold/src/agent.ts#L605) - `refuseComputer`, the answer today"
  - "[code://packages/sdk/src/computers.ts](../../../../packages/sdk/src/computers.ts) - `refuseComputer` and how a backend opens its computer"
  - "[code://packages/sdk/src/types/computers.ts#L16-L49](../../../../packages/sdk/src/types/computers.ts#L16-L49) - `ComputerPort.how` and `Spawn`, a process in a machine"
  - "[code://packages/sdk/src/rpc.ts#L74-L100](../../../../packages/sdk/src/rpc.ts#L74-L100) - `createPeer`, a `Wire` over stdio"
  - "[code://packages/agent-acp/src/session.ts#L447-L479](../../../../packages/agent-acp/src/session.ts#L447-L479) - `placed()`, a backend that starts its process through the port"
  - "[code://packages/computer/src/devcontainer.ts](../../../../packages/computer/src/devcontainer.ts) - the nested host started with `--stdio`"
  - npm://@microsoft/agent-host-protocol@0.9.0 - `AhpClient`, the client the proxy uses
---

## Goal

A cofold session created with `computer://<id>` runs inside that machine: an ahpd with the cofold plugin runs there, and the session looks to a client exactly like one on this host.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Runtime path

```
createSession { provider: cofold, computer: X } -> [new] cofold runs nested -> proxy backend
  -> nested(X, plugins) = profile.host ?? ahpd, with --stdio --plugin @ahpd/agent-cofold -> a process with stdio
  -> AhpClient over it: initialize, createSession (no computer), subscribe
turn, confirm, cancel, config    -> [new] dispatched to the inner session
inner session actions            -> [new] emitted as the outer session's
process exits                    -> [new] the session ends with the stderr tail as its sentence
```

### Gaps

- Nothing in the SDK speaks AHP as a client.
- A backend that cannot move refuses a computer; nothing chooses a proxy instead.
- A nested host is started only by the dev container launcher.

## Decisions locked in

| Decision | Task |
| --- | --- |
| [A cofold session in a computer runs in an ahpd started inside it](../../../decisions/a-cofold-session-in-a-computer-runs-in-a-nested-host.md) | 01, 04 |
| [A session reaches a nested host through a generic proxy backend in the SDK](../../../decisions/a-session-reaches-a-nested-host-through-a-generic-proxy.md) | 02, 03, 04 |

| What | Source | Task |
| --- | --- | --- |
| The profile provides ahpd: its image or mounts carry it, and an optional `host` command says how to start it, default `ahpd` | Softov, 2026-09-26: "profile serves it.. command if desired and will be needed for kvm" | 01 |
| No install step; a machine without ahpd is refused with a sentence | follows from the profile providing it | 01, 05 |
| A backend opts in to the proxy by declaring `runsNested`; cofold does | the proxy is generic | 04 |
| cofold's config reaches the machine as its declared need | `plugin/15` task 06 | - |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A computer can start a nested host](task-01-a-computer-starts-a-nested-host.md) | todo | - |
| [02 - The proxy opens an inner session and forwards turns](task-02-the-proxy-forwards-turns.md) | todo | 01 |
| [03 - The proxy forwards asks, config, cancel and the end](task-03-the-proxy-forwards-the-rest.md) | todo | 02 |
| [04 - A backend that runs nested is proxied instead of refused](task-04-nested-instead-of-refused.md) | todo | 03 |
| [05 - A nested start that fails says why](task-05-a-failed-start-says-why.md) | todo | 04 |
| [06 - Docs](task-06-docs.md) | todo | 05 |

## Risks and tradeoffs

- The inner host's protocol version must be the outer's; the proxy refuses a mismatch at `initialize`.
- Every frame takes one more hop.

## Resume state

- **Done so far:** the decisions, 2026-09-26.
- **Next action:** [task-01-a-computer-starts-a-nested-host.md](task-01-a-computer-starts-a-nested-host.md).
- **Open questions:** none.
- **Watch out for:** a failure must end the session with a sentence, never hang; cofold hung in a dev container for want of its config.

## Final verification checklist

- [ ] A cofold session on `computer://lulu` runs `hostname` and answers with the machine's name.
- [ ] An edit made there shows as a change in VS Code, and a permission ask is answered from VS Code.
- [ ] A machine without ahpd, or without cofold's config, refuses with a sentence.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm boundary` green; `docs/COMPUTER.md`, `plans/index.md` updated.
