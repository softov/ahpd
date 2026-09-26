---
title: Input from a client is tagged as not the terminal's
domain: pi
status: planned
priority: low
created: 2026-09-26
revalidated: 2026-09-26
requires: []
changes: []
creates: []
decisions: []
refs:
  - "[code://packages/agent-pi/src/backend.ts#L120-L121](../../../../packages/agent-pi/src/backend.ts#L120-L121) - `prompt` and `steer` are called with no options"
  - "[code://packages/agent-pi/src/backend.ts#L35-L38](../../../../packages/agent-pi/src/backend.ts#L35-L38) - the `PiBackend` signatures"
  - npm://@earendil-works/pi-coding-agent@^0.87.1 - `PromptOptions.source` and `steer(text, images, { source })` in `dist/core/agent-session.d.ts`; `InputSource = "interactive" | "rpc" | "extension"` and the extension `input` event in `dist/core/extensions/types.d.ts`; pi's own RPC mode passes `"rpc"` in `dist/modes/rpc/rpc-mode.js`
---

## Goal

A pi extension that handles input can tell a message sent from an AHP client from one typed at pi's own terminal.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `grep -n "InputSource" dist/core/extensions/types.d.ts` in pi 0.87.1 - the type is `"interactive" | "rpc" | "extension"`, with no room for another value.
- `grep -rn 'source: "rpc"' dist` - pi's RPC mode, its own way to be driven by another program, tags input `rpc`.
- Today both calls leave `source` out, which pi defaults to `interactive`: an extension is told a person typed it at the terminal.

### Runtime path

```
begin() / steer() -> backend.prompt(text) / backend.steer(text) -> [new] { source } -> pi extension input event
```

### Gaps

- Every message from a client reaches pi's extensions as `interactive`.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| Pass `source` to `prompt` and `steer` | Softov, 2026-09-26: "Pass `source: 'ahp'` to `prompt` and `steer` so pi extensions can tell remote input from the terminal" | 01 |
| The value is `'rpc'`, pi's own for input from a program driving it, since pi 0.87.1's `InputSource` has no `'ahp'` | Softov, 2026-09-26, answering which value to pass: "`'rpc'`" | 01 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - prompt and steer name their source](task-01-prompt-and-steer-name-their-source.md) | todo | - |

## Risks and tradeoffs

- An extension cannot tell this host's input from pi's own RPC mode; both are `rpc`, which is what they are to pi.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-prompt-and-steer-name-their-source.md](task-01-prompt-and-steer-name-their-source.md).
- **Open questions:** none.
- **Watch out for:** `ran` (the `!command`) does not go through pi and is not tagged.

## Final verification checklist

- [ ] `prompt` and `steer` both pass `source: 'rpc'`.
- [ ] `pnpm test`, `pnpm typecheck` green.
- [ ] `plans/index.md` updated.
