---
title: A client's approval key moves the advertised mode
domain: host
status: built
priority: medium
created: 2026-11-02
revalidated: 2026-11-02
refs:
  - git://e4694965 - R1's continuation, the commit this plan was checked at
  - "[code://.project/working/maycxc-union-20261101-review.md](../../../working/maycxc-union-20261101-review.md) - Softov's review: `conformance.test.ts:906` sends `permissionMode` where it sent `mode`"
  - "[code://packages/agent-claude/src/session/config.ts#L114-L125](../../../../packages/agent-claude/src/session/config.ts#L114-L125) - `permissionFor`, which maps `autoApprove` and `mode` onto the mode the CLI takes"
  - "[code://packages/agent-claude/src/session/config.ts#L248-L310](../../../../packages/agent-claude/src/session/config.ts#L248-L310) - `setConfig`, which answers a mapped key as the mode it moved"
  - "[code://packages/sdk/test/conformance.test.ts#L885-L899](../../../../packages/sdk/test/conformance.test.ts#L885-L899) - the unit case of `permissionFor`"
  - "[code://packages/sdk/test/conformance.test.ts#L935-L960](../../../../packages/sdk/test/conformance.test.ts#L935-L960) - the continuation's case for `mode`, through the host"
  - "[code://.project/plans/host/20261101-1641-every-backend-says-its-state-by-actions/plan.md](../20261101-1641-every-backend-says-its-state-by-actions/plan.md) - the continuation's plan, which answers a mapped key as the mode it moved"
---

## Goal

`autoApprove`, the other name a client sends for the permission mode, is held through the host as `mode` is.
A value neither name has is refused in the backend's words, and the mode stays where it was.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `git log -S "permissionMode: 'plan' } });" -- packages/sdk/test/conformance.test.ts` - 61b9f221 moved the host case from `mode` to `permissionMode`.
- `rg -n "autoApprove" packages/sdk/test` on main and on e4694965 - no case sends `autoApprove` through the host.
- A case on main sending `autoApprove: 'assisted'` reads `permissionMode` back as `default`.

### Runtime path

```
main: client {autoApprove: assisted} -> setConfig maps it, the CLI runs acceptEdits
  -> the host echoes {autoApprove: assisted}; the held state keeps permissionMode: default
e4694965: setConfig answers {permissionMode: acceptEdits}
  -> the host says it to every client, and the held state holds it
```

### Gaps

- On main the advertised mode stays put when a client sends `mode` or `autoApprove`; the continuation fixes it and covers `mode`.
- No case sends `autoApprove` through the host, and none sends a value neither name has.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A client sends `autoApprove` and `mode` whatever a host advertises, and the backend maps both | config.ts's own reason: "VS Code sends both at session creation whatever a host advertises." | 01 |
| A mapped key is answered as the mode it moved | the continuation's plan, and its case for `mode` | 01 |
| A value a taken key does not have is refused naming the value | the host case on main: "What comes back names the *value*" | 01 |
| The branch stacks on the continuation | the behavior it holds lands there; main's held state does not move the mode | 01 |

## Proposed architecture

- **Data flow** - a conformance case sends `autoApprove` twice and `mode` once, through the host to Claude's `setConfig`.
- **Layer responsibilities** - the sdk's conformance suite alone.
- **Source-of-truth files** - [`code://packages/sdk/test/conformance.test.ts`](../../../../packages/sdk/test/conformance.test.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - an approval key is held through the host](task-01-an-approval-key-is-held-through-the-host.md) | done | - |

## Risks and tradeoffs

- The branch starts from R1's continuation, not from main, so it merges into the union after it.

## Resume state

- **Done so far:** task 01, 2026-11-02; [implemented.md](implemented.md) says what was verified.
- **Next action:** none.
- **Open questions:** none.
- **Watch out for:** the continuation's own case sends `mode`; this one sends `autoApprove`, and `mode` only for the refusal.

## Final verification checklist

- [x] `autoApprove: assisted` is answered and served as `acceptEdits`, and `autopilot` as `bypassPermissions`.
- [x] `mode: yolo` is refused naming `yolo`, and the served mode stays.
- [x] On main's code the case fails, because the served mode does not move.
