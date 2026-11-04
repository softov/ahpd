---
title: A demo host shows every subject
domain: host
status: planned
priority: medium
created: 2026-11-04
revalidated: 2026-11-04
refs:
  - git://f6d9fc53 - the commit of ahpd the facts were checked at
  - https://github.com/ahpio/ahpc/blob/e8c5a80/.project/briefs/doc-pictures-come-from-a-seeded-test-host.md - the ahpc brief this plan comes from, with Softov's answers
  - "[code://examples/notes/main.ts](../../../../examples/notes/main.ts) - the host this example copies: `createHost` with files, terminals, git branches and git changes"
  - "[code://examples/notes/agent.ts#L124](../../../../examples/notes/agent.ts#L124) - `notes`, the agent this example wraps"
  - "[code://examples/notes/agent.ts#L775-L782](../../../../examples/notes/agent.ts#L775-L782) - its `probe`, with no models and no customizations"
  - "[code://packages/sdk/src/types/host.ts#L440](../../../../packages/sdk/src/types/host.ts#L440) - `createHost` takes `automations`"
  - "[code://packages/sdk/src/automations/automations.ts#L519](../../../../packages/sdk/src/automations/automations.ts#L519) - `memoryAutomations`"
  - "[code://packages/sdk/src/types/probe.ts#L33](../../../../packages/sdk/src/types/probe.ts#L33) - `Offered`: the models, commands and customizations a backend offers"
  - "[code://packages/sdk/test/notes.test.ts](../../../../packages/sdk/test/notes.test.ts) - the test of an example, through `createHost` and the protocol's reducers"
  - "[code://docs/sdk/AGENT.md#L311-L324](../../../../docs/sdk/AGENT.md#L311-L324) - *The two examples*, which gains a third"
  - "[code://package.json#L22-L23](../../../../package.json#L22-L23) - the `notes` and `notes:bun` scripts to copy"
---

## Goal

`pnpm demo -- --port <n> --path <dir>` starts a host that serves every subject a client draws, with no model behind it.
It has sessions in every state, models and customizations to pick from, automations, files, terminals and git changes.
ahpc draws its docs pictures from it, so every screen has something to show and every name is neutral.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `ls examples` - `echo` and `notes`; neither has automations, models or customizations.
- `rg "memoryAutomations" packages/sdk/src/index.ts` - exported.
- `notes` was run on 2026-11-04 on a scratch port and folder, and ahpc drew its session list, with a session waiting on a question.

### Runtime path

```
pnpm demo -> examples/demo/main.ts -> createHost(demo agent, files, terminals, branches, changes, memoryAutomations) -> listen
```

## Answers

| What | Source | Task |
| --- | --- | --- |
| The demo host lives next to `examples/notes` | Softov, 2026-11-04: "It can live next to ahpd notes" | 01 |
| A new `examples/demo` that imports the `notes` agent and wraps it, so `notes` stays the small teaching example | Softov, 2026-11-04: "New examples/demo, reusing notes" | 01 |
| The wrapped `probe` offers two or three models, the `notes` commands, and two customizations, all with neutral names | (defaulted: the agents and customizations pictures need them, and no Claude is run) | 01 |
| The host takes `memoryAutomations` | (defaulted: automations are seeded by a client, and the pictures need no store on disk) | 01 |
| `slow` streams one line every second for 60 seconds | Softov, 2026-11-04: "Add slow and fail" | 02 |
| `fail` ends its turn with an error | Softov, 2026-11-04: "Add slow and fail" | 02 |
| Every other message goes to `notes` as it is | (defaulted: the wrap adds two commands and changes nothing else) | 02 |
| `pnpm demo` and `pnpm demo:bun`, as `notes` has | (defaulted: copies the sibling's scripts) | 01 |

## Proposed architecture

- **Data flow** - `examples/demo/agent.ts` returns the `notes` agent with its `probe` replaced and its sessions' `begin` wrapped.
- **Layer responsibilities** - `examples/demo/`: the host and the wrap · `examples/notes/`: unchanged.
- **Source-of-truth files** - [`code://examples/notes/agent.ts`](../../../../examples/notes/agent.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The demo host serves every subject](task-01-the-demo-host-serves-every-subject.md) | todo | - |
| [02 - slow runs and fail ends in an error](task-02-slow-runs-and-fail-ends-in-error.md) | todo | 01 |

## Risks and tradeoffs

- A change to `notes` changes the demo too. The demo imports it, so the two never drift.
- `slow` holds a turn for a minute. A client that watches it waits for the minute, or cancels it.

## Resume state

- **Done so far:** planned 2026-11-04.
- **Next action:** [task-01-the-demo-host-serves-every-subject.md](task-01-the-demo-host-serves-every-subject.md).
- **Open questions:** none.
- **Watch out for:** `notes` writes its notes into its folder, which is the folder the host serves, so a `write` is a git change there.

## Final verification checklist

- [ ] `pnpm demo -- --port 9210 --path <scratch>` starts, and `ahpc --host ws://127.0.0.1:9210 session list` answers.
- [ ] The tests in `packages/sdk/test/demo.test.ts` pass.
- [ ] The repository's typecheck and tests pass.
