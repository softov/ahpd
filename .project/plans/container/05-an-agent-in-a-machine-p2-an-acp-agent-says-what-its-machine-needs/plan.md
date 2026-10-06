---
title: An ACP preset says what its machine needs
domain: container
status: built
priority: high
created: 2026-09-26
revalidated: 2026-10-04
requires:
  - plans/container/05-an-agent-in-a-machine-p1-a-secret-reaches-a-machine-by-name/plan.md
  - plans/acp/05-presets/plan.md
changes: []
creates: []
decisions:
  - decisions/an-agent-declares-its-machine-needs-with-a-method.md
  - decisions/a-plugin-loads-once-and-each-preset-is-a-variant.md
refs:
  - "[code://packages/agent-acp/src/plugin.ts#L35-L48](../../../../packages/agent-acp/src/plugin.ts#L35-L48) - `optionsSchema`: one spec, no presets, no machine"
  - "[code://packages/agent-acp/src/plugin.ts#L59-L61](../../../../packages/agent-acp/src/plugin.ts#L59-L61) - `apply` registers one agent"
  - "[code://packages/agent-acp/src/types.ts#L43-L60](../../../../packages/agent-acp/src/types.ts#L43-L60) - `AcpOptions`"
  - "[code://packages/agent-acp/src/session.ts#L615-L638](../../../../packages/agent-acp/src/session.ts#L615-L638) - `placed()`, the spawn in a machine"
  - "[code://packages/sdk/src/types/agent.ts#L353](../../../../packages/sdk/src/types/agent.ts#L353) - `machine()` on the agent contract"
  - "[code://packages/sdk/src/host/machines.ts#L201-L209](../../../../packages/sdk/src/host/machines.ts#L201-L209) - the host asks the session's own provider for `machine()`, so each registered variant answers for itself"
  - "[code://packages/agent-cofold/src/agent.ts#L561-L572](../../../../packages/agent-cofold/src/agent.ts#L561-L572) - cofold's `machine()`, the pattern to mirror"
  - "[code://packages/agent-claude/src/options.ts#L96-L105](../../../../packages/agent-claude/src/options.ts#L96-L105) - claude/12's `{ fromEnv }` env value, the shape a secret takes here"
  - "[code://packages/agent-claude/src/options.ts#L225-L229](../../../../packages/agent-claude/src/options.ts#L225-L229) - `fromEnvOf`, the reader to mirror"
  - "[code://docs/PLUGINS.md#L662-L712](../../../../docs/PLUGINS.md#L662-L712) - the ACP section"
---

## Goal

Each ACP preset can say what a machine needs to run it: its config dir variable, the files copied into it, and its secrets as `{ "fromEnv": "NAME" }` or `{ "$secret": "<scope:name>" }` values.
A preset is a variant registered as an agent of its own, so the machine block belongs to the preset, and the host asks each variant's `machine()` for itself.
Presets for agent-acp are the ACP presets plan's, [acp/05](../../acp/05-presets/plan.md) once it is rewritten to agent-claude's shape; sign-in is [acp 04](../../acp/04-the-bridge-signs-in/plan.md), built 2026-10-02; p5 adds each known agent's part.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg "machine" packages/agent-acp/src` - no `machine()`.
- `rg "presets" packages/agent-acp/src` - none; one load is one spec is one agent.
- `rg "fromEnv" packages/*/src` - only agent-claude reads it, at load.

### Runtime path

```
presets.<key>.machine -> the variant's acpAgent().machine() -> host.placedIn(provider = <key>) -> machine made with env and copy needs
```

### Gaps

- agent-acp declares no needs, so a machine for Codex or Gemini is hand-written mounts.
- agent-acp has no presets, and a machine block per load would be the wrong shape once it does.
- An ACP agent in a machine may not reach the host's MCP endpoint that acp/11 serves on the daemon's listener.
- Resume by `session/resume` is not here: plugin 18 does it.

## Decisions locked in

| Decision | Task |
| --- | --- |
| [An agent declares what a machine needs through a machine() method](../../../decisions/an-agent-declares-its-machine-needs-with-a-method.md) | 01 |
| [A plugin is loaded once, and each of its presets is a variant registered as an agent of its own](../../../decisions/a-plugin-loads-once-and-each-preset-is-a-variant.md) | 01 |

| What | Source | Task |
| --- | --- | --- |
| Each agent's state goes to a per-machine dir named by its own variable, never the host's home | the proposal Softov asked to plan, 2026-09-26 | 01 |
| A secret is a `machine.env` value written `{ "fromEnv": "NAME" }` or `{ "$secret": "<scope:name>" }`, never a bare name the daemon's environment fills in | Softov, 2026-10-02, asked "What does the vault unlock first?": "Options and machines" (a `$secret` in any plugin option or computer need; claude/12's `fromEnv` stays the cheaper route) | 01 |
| A `fromEnv` naming a variable the daemon does not have, or a malformed `machine`, skips only that preset with a line naming it, and the others register | Softov, 2026-10-03, asked "when a `$secret` in a plugin's options can't be read at load, what fails?": "Only its item"; mirrors [claude/16](../../claude/16-a-preset-that-fails-skips-only-itself/plan.md) ("Any preset failure") | 01 |
| A preset's `machine.env` values are `secretAtUse`; a `$secret` is read by the computer plugin's `revealed` when the machine is made, and a failed read fails that create only | Softov, 2026-10-03, asked "when a `$secret` in a plugin's options can't be read at load, what fails?": "Only its item" | 01 |
| A shipped row's `authenticate.fromEnv` also counts a variable the preset gives to its machine, for a session placed in that machine only; a session on this host still looks only at the daemon's environment | Softov, 2026-10-05, asked "an ACP preset can give a key only to its machine through `machine.env`, and `authenticate.fromEnv` checks only the daemon's environment, so such a session asks the user to sign in: should that check also count a variable the preset gives to its machine?": count it, in a machine only | 01 |
| A wildcard bind (`0.0.0.0`, `::`) counts as unreachable from a machine | (defaulted: inside a container that address is the container itself) | 05 |
| agent-acp takes presets in a later plan | Softov, 2026-10-02, asked "Does agent-acp take the same presets shape in this plan?": "Claude now, ACP after" | 01 |
| Sign-in moves to the acp domain | Softov, 2026-09-26, asked "Container 05 p2 already has ACP sign-in and the presets. Where do they live?", answered "Sign-in moves to acp" | 02, 03 |
| For now the host's tools endpoint is offered to a session in a machine only where the machine can reach the daemon, and is otherwise left out and logged; one function, `toolsReachable`, makes the call, so the rule can change | Softov, 2026-10-03, asked "what does an ACP session in a machine get for the host's MCP endpoint?": "offered only where the machine can reach the daemon, otherwise left out and logged" | 05 |

## Proposed architecture

- **Data flow** - the ACP presets plan registers one agent per preset; this plan adds `machine` to a preset's options, and that variant's `acpAgent` answers `machine()` from it.
- **Layer responsibilities** - `@ahpd/agent-acp`, with `Need.default` widened in `@ahpd/sdk` and read in `@ahpd/computer`; a `$secret` value is passed through at load and resolved by the computer plugin when the machine is made; `toolsReachable` in the session decides whether a session in a machine is handed the host's tools endpoint.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A preset declares what its machine needs](task-01-a-spec-declares-what-its-machine-needs.md) | implemented | acp 05, rewritten as the ACP presets plan |
| [02 - A spec may sign in after initialize](task-02-a-spec-may-sign-in.md) | dropped | - |
| [03 - Presets for the ACP agents](task-03-presets.md) | dropped | - |
| [04 - Docs](task-04-docs.md) | implemented | 01, 05 |
| [05 - The host's tools are offered to a session in a machine only where it can reach the daemon](task-05-the-hosts-tools-reach-a-machine-only-where-it-can-reach-the-daemon.md) | implemented | - |

## Risks and tradeoffs

- A machine env value like `CODEX_HOME=/ahpd/codex` must never reach a host spawn - `machine.env` is delivered only to a machine.

## Resume state

- **Done so far:** built 2026-10-05 on a43c077, tasks 01, 04 and 05 `implemented`, see [implemented.md](implemented.md); 02 and 03 stay dropped. The answered sign-in row is in task 01: a row's `fromEnv` counts `machine.env` for a session placed in a machine.
- **Next action:** Softov reviews; the first two checklist items want a real Docker and a real Codex or Copilot by hand.
- **Open questions:** none; the sign-in question is answered in the table above (Softov, 2026-10-05).
- **Watch out for:**
  - `machine()` is read at create with the live agent list, so a preset added later is seen by the next machine only.
  - `toolsReachable` guesses from the address; a machine on a network that reaches a loopback daemon (`--network host`) is still left without the tools until the port can say.

## Final verification checklist

- [ ] A disposable machine for a preset with `machine: { env: { COPILOT_HOME: "/ahpd/copilot", COPILOT_GITHUB_TOKEN: { fromEnv: "COPILOT_GITHUB_TOKEN" } } }` gets both by name, and a session answers a turn.
- [x] Two presets of one load make two machines with their own env (against the fake Docker, `agent-acp-machine.test.ts`).
- [x] An ACP session in a machine that cannot reach the daemon gets no host tools server and the log says why; one on this host gets it.
- [x] `pnpm test`, `pnpm typecheck` green.
- [x] `docs/PLUGINS.md`, `plans/index.md` updated.
