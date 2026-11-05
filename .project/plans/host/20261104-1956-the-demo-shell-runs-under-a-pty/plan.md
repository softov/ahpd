---
title: The demo host's shells run under a pseudoterminal
domain: host
status: built
priority: medium
created: 2026-11-04
revalidated: 2026-11-04
refs:
  - git://5e9ca055 - the commit of ahpd the facts were checked at
  - "[code://examples/demo/main.ts](../../../../examples/demo/main.ts) - the host, whose `shellTerminals()` gets no pseudoterminal"
  - "[code://packages/server/src/pty.ts#L192](../../../../packages/server/src/pty.ts#L192) - `pty()`, the daemon's binding: `node-pty` on Node, Bun's own terminal on Bun, nothing where neither loads"
  - "[code://packages/server/src/commands/run.ts#L1123](../../../../packages/server/src/commands/run.ts#L1123) - where the daemon asks for it, and passes it to `shellTerminals` at L1206"
---

## Goal

A terminal on the demo host shows a prompt and the command that was typed, as a terminal on the daemon does.
Softov, 2026-11-04, on ahpc's `terminals.svg`: "Terminals ui show like the files broken".
The demo runs its shells without a pseudoterminal.
So a shell prints no prompt and does not echo what it was sent, and its output reads as a bare list.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Runtime path

```
pnpm demo -> examples/demo/main.ts -> pty() -> shellTerminals({ pty }) -> a shell under a pseudoterminal
```

## Answers

| What | Source | Task |
| --- | --- | --- |
| The demo's shells run under a pseudoterminal, as the daemon's do | Softov, 2026-11-04: "Demo shell under a pty" | 01 |
| The demo asks the daemon's own `pty()`, and gets pipes where it answers nothing | (defaulted: one binding, which already handles Node, Bun and a `node-pty` that does not load) | 01 |
| `examples/notes` keeps its shells on pipes | (defaulted: it is the small teaching example, and the ask was about the demo) | - |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The demo's shells get the daemon's pseudoterminal](task-01-the-demo-shells-get-a-pty.md) | done | - |

## Risks and tradeoffs

- The demo imports `packages/server/src/pty.ts` by path, because `@ahpd/server` exports only its command. An example that runs from source can do that; a published one could not.

## Resume state

- **Done so far:** planned and built 2026-11-04; see [implemented.md](implemented.md).
- **Next action:** none.
- **Open questions:** none.
- **Watch out for:** `pty()` probes `node-pty` in a child process first, so the demo starts a moment later.

## Final verification checklist

- [x] `pnpm demo` on a scratch port, and `ahpc terminal new` then `terminal send`: `terminal watch` shows a prompt and the echoed command.
- [x] The repository's typecheck and tests pass.
