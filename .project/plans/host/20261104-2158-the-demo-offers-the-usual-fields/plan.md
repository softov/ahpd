---
title: The demo host offers the fields a real host offers a new session
domain: host
status: planned
priority: medium
created: 2026-11-04
revalidated: 2026-11-04
refs:
  - git://5313f7ed - the commit of ahpd the facts were checked at
  - "[code://examples/demo/agent.ts#L202](../../../../examples/demo/agent.ts#L202) - the agent's `displayName`, `Demo`"
  - "[code://examples/notes/agent.ts#L139-L171](../../../../examples/notes/agent.ts#L139-L171) - the schema the demo passes on: `Ask before` and `Tone`"
  - "[code://examples/demo/main.ts](../../../../examples/demo/main.ts) - the host, with no `worktrees`"
  - "[code://packages/sdk/src/host/sessionconfig.ts#L76-L107](../../../../packages/sdk/src/host/sessionconfig.ts#L76-L107) - `Isolation` and `Branch`, which the host adds for a git workspace when it has `worktrees`"
  - "[code://packages/sdk/src/repo/worktrees.ts#L93](../../../../packages/sdk/src/repo/worktrees.ts#L93) - `gitWorktrees()`, the port to pass"
  - "https://github.com/microsoft/vscode/blob/171e90619c7/src/vs/platform/agentHost/common/agentHostSchema.ts - VS Code's `mode` key: `Agent Mode`, with Interactive, Plan and Autopilot"
---

## Goal

A new session on the demo host shows the fields a real host offers.
These are the agent, its mode, its permissions, the folder, its isolation and its branch.
Softov, 2026-11-04: "the normal filters are Mode, Folder/Branch, repo, Permissions".
ahpc's `compose.svg` is drawn from this host, and today it shows only the agent, the model, `Ask before` and `Tone`.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Runtime path

```
ahpc new session -> host.resolveSessionConfig -> agent schema (demo + notes) + host isolation schema (worktrees) -> chips
```

## Answers

| What | Source | Task |
| --- | --- | --- |
| The demo agent is named `Agent Demo` | Softov, 2026-11-04: "the agent could be called 'Agent Demo'" | 01 |
| The demo offers the usual new-session fields | Softov, 2026-11-04: "Demo offers them" | 01, 02 |
| The demo adds VS Code's `mode` key, with its title, values and labels | (defaulted: the platform's own key, so a client that knows it draws it as VS Code does) | 01 |
| `Ask before` stays the permissions field | (defaulted: it already decides which tools wait, and the demo's turns use it) | - |
| The host gets `worktrees: gitWorktrees()`, so a git workspace offers `Isolation` and `Branch` | (defaulted: the daemon's own port, and the only source of those two fields) | 02 |
| `examples/notes` does not change | (defaulted: it is the small teaching example) | - |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The demo agent is Agent Demo and has a mode](task-01-the-demo-agent-has-a-mode.md) | todo | - |
| [02 - The demo host offers isolation and branch](task-02-the-host-offers-isolation.md) | todo | - |

## Risks and tradeoffs

- A worktree session makes a folder beside the repository. ahpc's picture script makes its repositories in a scratch folder, so the worktree goes there too.

## Resume state

- **Done so far:** planned 2026-11-04.
- **Next action:** [task-01-the-demo-agent-has-a-mode.md](task-01-the-demo-agent-has-a-mode.md).
- **Open questions:** none.
- **Watch out for:** the mode does nothing in a demo turn, as `Tone` does nothing much. The README says so.

## Final verification checklist

- [ ] `pnpm demo` on a scratch port with a git folder: `ahpc session config` on a new session lists `mode`, `ask`, `tone`, `isolation` and `branch`.
- [ ] `ahpc agent list` names the agent `Agent Demo`.
- [ ] The repository's typecheck and tests pass.
