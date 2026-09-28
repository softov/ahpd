---
title: The host's instructions reach pi's system prompt
domain: pi
status: built
priority: medium
created: 2026-09-26
revalidated: 2026-09-26
requires:
  - plans/pi/02-host-and-client-tools-reach-pi/plan.md
changes: []
creates: []
decisions: []
refs:
  - "[code://packages/sdk/src/types/agent.ts#L120-L127](../../../../packages/sdk/src/types/agent.ts#L120-L127) - `Start.instructions`: one entry per host tool that carries an instruction"
  - "[code://packages/agent-pi/src/backend.ts#L93](../../../../packages/agent-pi/src/backend.ts#L93) - `createAgentSessionServices` is called with no `resourceLoaderOptions`"
  - "[code://packages/agent-claude/src/session.ts#L1908-L1918](../../../../packages/agent-claude/src/session.ts#L1908-L1918) - the sibling appends the instructions after the CLI's own prompt, joined by a blank line"
  - "[code://packages/agent-cofold/src/session.ts#L385-L390](../../../../packages/agent-cofold/src/session.ts#L385-L390) - the other sibling drops empty entries before adding them"
  - npm://@earendil-works/pi-coding-agent@^0.87.1 - `resourceLoaderOptions` on `CreateAgentSessionServicesOptions`; `appendSystemPrompt` and `appendSystemPromptOverride` on `DefaultResourceLoaderOptions`, in `dist/core/resource-loader.d.ts`
---

## Goal

What the host wants the model told reaches pi's system prompt, after pi's own and after the project's own additions.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "instructions" packages/agent-pi/src` - nothing.
- `sed -n 380,400p dist/core/resource-loader.js` in pi 0.87.1 - when `appendSystemPrompt` is given it replaces the discovered `APPEND_SYSTEM.md` rather than adding to it, and each entry that names an existing file is read as that file; `appendSystemPromptOverride(base)` receives the discovered text and returns the list to use.

### Runtime path

```
host Start.instructions -> piSession opened() -> [new] BackendOptions.instructions
  -> createAgentSessionServices({ resourceLoaderOptions: { appendSystemPromptOverride } }) -> pi's system prompt
```

### Gaps

- `Start.instructions` is never read.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| The instructions go into pi's system prompt through `resourceLoaderOptions` on `createAgentSessionServices` | Softov, 2026-09-26: "Pass it into pi's system prompt through `resourceLoaderOptions.appendSystemPrompt`" | 01 |
| Through `appendSystemPromptOverride`, adding to what pi discovered, and not `appendSystemPrompt`, which would drop the project's or the user's `APPEND_SYSTEM.md` | Softov, 2026-09-26, answering `appendSystemPromptOverride` against the literal `appendSystemPrompt`: "`appendSystemPromptOverride`, as written in plan 03"; pi 0.87.1 `dist/core/resource-loader.js`, lines 386-396 | 01 |
| Empty entries are dropped and the rest are joined as the siblings join them | [`code://packages/agent-claude/src/session.ts#L1916-L1918`](../../../../packages/agent-claude/src/session.ts#L1916-L1918), [`code://packages/agent-cofold/src/session.ts#L387`](../../../../packages/agent-cofold/src/session.ts#L387) | 01 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The instructions are appended](task-01-the-instructions-are-appended.md) | done | - |

## Risks and tradeoffs

- The instructions are fixed when pi opens. Host instructions come with host tools, which are fixed at creation too, so nothing is lost; if plan 02's rebuild on `setTools` lands, the rebuild passes them again.

## Resume state

- **Done so far:** every task is `done`, reviewed by Softov on 2026-09-28; the plan is built, see [implemented.md](implemented.md).
- **Next action:** none.
- **Open questions:** none.
- **Watch out for:** an instruction string that happens to be an existing path is read as a file by `appendSystemPrompt`; the override is not, which is one more reason for it.

## Final verification checklist

- [ ] A session started with instructions hands them to pi's resource loader, after any discovered append text.
- [ ] `pnpm test`, `pnpm typecheck` green.
- [ ] `plans/index.md` updated.
