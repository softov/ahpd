---
title: Dev container cases wait for the first listing
domain: container
status: planned
priority: high
created: 2026-11-13
revalidated: 2026-11-13
requires: []
changes: []
creates: []
refs:
  - git://74b138b73 - the commit of ahpd this plan was checked at, and the last one that holds `problems/dev-container-cases-ask-before-the-first-listing.md`
  - "[code://packages/computer/test/computer-devcontainer.test.ts#L117-L136](../../../../packages/computer/test/computer-devcontainer.test.ts#L117-L136) - `answered`, and the listing that loading the plugin starts and nothing awaits"
  - "[code://packages/computer/test/computer-devcontainer.test.ts#L164-L182](../../../../packages/computer/test/computer-devcontainer.test.ts#L164-L182) - `load`, the helper every case loads the plugin with"
---

## Goal

Three dev container cases stop failing at random on Windows CI.
Each asked for a machine before the `docker ps` listing that the load started had answered.
On 2026-11-13 the case "reads the kept probe back after a restart" failed in run 43498633204 of #323, a change with no code in `computer`.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "await load\(" packages/computer/test/computer-devcontainer.test.ts` - 48 loads. Some never list, such as a load whose configuration is refused.
- A first try waited for a listing in every load. Three cases then timed out, because their load lists nothing.

### Runtime path

```
load -> the plugin starts docker ps, not awaited -> the case asks run_in_computer or the picker -> "There is no computer called <name>"
```

### Gaps

- `load` gives a case no way to wait for the listing it started.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A case waits, not the plugin | The problem file's first fix | 01 |
| `load` answers a `listing` a case awaits, and does not wait itself | `(defaulted: a load that lists nothing would wait for ever)` | 01 |
| The fourth case, a third Docker call that comes late, is its own problem | `(defaulted: its cause is not the listing)` | 01 |

## Proposed architecture

- **Data flow** - `load` counts the `ps` calls of the scripted Docker before the load. It answers `listing`, which waits for one more call and for the lock to go.
- **Event flow** - unchanged.
- **State flow** - unchanged.
- **Layer responsibilities** - the computer suite only.
- **Source-of-truth files** - [`code://packages/computer/test/computer-devcontainer.test.ts`](../../../../packages/computer/test/computer-devcontainer.test.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - Three cases wait for the listing](task-01-three-cases-wait-for-the-listing.md) | implemented | - |

## Risks and tradeoffs

- A new case that asks for a machine right after a load has to call `listing` too. The comment on `load` says so.

## Resume state

- **Done so far:** task 01 implemented, 2026-11-13; see [implemented.md](implemented.md).
- **Next action:** Softov reviews the PR. The plan closes as `built` on his word.
- **Open questions:** none.
- **Watch out for:** the cases that start the fake CLIs for three connects time out on this machine with no fault, as `problems/computer-cases-time-out-on-a-busy-machine.md` says.

## Final verification checklist

- [x] The three cases call `listing` before they ask for a machine.
- [x] The file passes three times in a row on Linux, apart from the two cases of the busy-machine problem.
