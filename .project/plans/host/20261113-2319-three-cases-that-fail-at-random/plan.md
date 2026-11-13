---
title: Three cases that fail at random wait on what they mean
domain: host
status: planned
priority: high
created: 2026-11-13
revalidated: 2026-11-13
requires: []
changes: []
creates: []
refs:
  - git://2bf97a6c1 - the commit of ahpd this plan was checked at, and the last one that holds `problems/an-agents-channel-case-hears-two-changes.md` and `problems/the-case-of-a-claude-cli-that-is-gone-waits-on-fixed-times.md`
  - "[code://packages/sdk/test/agents-channel.test.ts](../../../../packages/sdk/test/agents-channel.test.ts) - \"sends one root/agentsChanged with the new agent\""
  - "[code://packages/sdk/src/host.ts#L1921-L1931](../../../../packages/sdk/src/host.ts#L1921-L1931) - a change of the users directory sends the agent list again, whatever it holds"
  - "[code://packages/sdk/test/nested-process.test.ts#L53-L61](../../../../packages/sdk/test/nested-process.test.ts#L53-L61) - the teardown that killed each inner host and removed its folder at once"
  - "[code://packages/computer/test/computer-spawn.test.ts](../../../../packages/computer/test/computer-spawn.test.ts) - \"fails a turn on a session whose CLI is gone, instead of thinking for ever\""
---

## Goal

Three cases that failed main on 2026-11-13 wait on what they mean, not on a fixed time or on luck.

| Case | Run on main |
| --- | --- |
| `agents-channel.test.ts`, "sends one root/agentsChanged with the new agent" | 43437687851, `windows (1/4)` |
| `nested-process.test.ts`, its teardown | 43434699973, `processes (2/2)` |
| `computer-spawn.test.ts`, "fails a turn on a session whose CLI is gone" | 43362605101, `processes (2/2)` |

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- The agents-channel case, with a wait of 1500 ms and a print of each change: two `root/agentsChanged`, the same list twice. The publishes of the catalogue sent one of them. The other came from the watch of the users directory, which the token that `as` mints changes, and whose event can land after the put. With a second of quiet before the count, the case heard one.
- The nested-process teardown sends `SIGKILL` and removes the folder at once, and the problem file names `ENOTEMPTY`.
- The computer-spawn case timed out at 5 s on Softov's machine each time, and its two fixed waits were 600 ms and 100 ms.

### Runtime path

```
token minted -> users watch, later -> root/agentsChanged with the same list -> the case counts two
```

### Gaps

- The agents-channel case counts a list sent again the same as a second change.
- The nested-process teardown does not wait for an inner host to exit.
- The computer-spawn case imports the backend inside its limit, and waits fixed times.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The second `root/agentsChanged` is the users watch's, and the host is right to send it | [`code://packages/sdk/src/host.ts#L1921-L1931`](../../../../packages/sdk/src/host.ts#L1921-L1931): "Said whatever the list holds" | 01 |
| The agents-channel case counts a list sent again the same as one change | `(defaulted: a probe that adds models sends another list, which still counts)` | 01 |
| A teardown waits for its children to exit, 5 s at most, and its removal tries again | The problem file's two fixes | 02 |
| The computer-spawn case follows the problem file's fix | The problem file | 03 |

## Proposed architecture

- **Data flow** - unchanged.
- **Event flow** - unchanged.
- **State flow** - unchanged.
- **Layer responsibilities** - three test files and the disposable teardown.
- **Source-of-truth files** - the three test files.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The agents-channel case counts one change](task-01-the-agents-channel-case-counts-one-change.md) | implemented | - |
| [02 - A teardown waits for its children](task-02-a-teardown-waits-for-its-children.md) | implemented | - |
| [03 - The gone-CLI case waits on events](task-03-the-gone-cli-case-waits-on-events.md) | implemented | - |

## Risks and tradeoffs

- In the computer-spawn case, the stand-in CLI writes its file just before it exits. A turn can reach it in that moment, and the case still reads the same error.
- The ACP and service-install teardowns of the nested-process problem file are not changed. That file stays open for them.

## Resume state

- **Done so far:** tasks 01 to 03 implemented, 2026-11-13; see [implemented.md](implemented.md).
- **Next action:** review of the PR. The plan closes as `built` on Softov's word.
- **Open questions:** none.
- **Watch out for:** none.

## Final verification checklist

- [x] The agents-channel case passes with a wait of 1500 ms, which made two changes before.
- [x] The nested-process file passes.
- [x] The computer-spawn file passes three times in a row on Softov's machine, where it timed out each time.
