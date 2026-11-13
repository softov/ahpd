---
title: Plugin warnings go to the daemon's log
domain: plugin
status: planned
priority: medium
created: 2026-11-13
revalidated: 2026-11-13
requires: []
changes: []
creates: []
refs:
  - git://4e194f862 - the commit of ahpd this plan was checked at, and the last one that holds `problems/plugin-code-writes-its-warnings-to-the-console.md`
  - "[code://packages/agent-claude/src/session/context.ts](../../../../packages/agent-claude/src/session/context.ts) - `ClaudeSessionOptions`, which gets `log`"
  - "[code://packages/agent-pi/src/types.ts#L185](../../../../packages/agent-pi/src/types.ts#L185) - agent-pi's `log`, already passed from `host.log`"
  - "[code://packages/activepieces/src/plugin.ts#L256-L270](../../../../packages/activepieces/src/plugin.ts#L256-L270) - the engine is a forked process, with its stderr inherited"
  - "[code://packages/activepieces/src/wire.ts](../../../../packages/activepieces/src/wire.ts) - the messages between the engine and the plugin"
---

## Goal

Every line a package's code writes reaches the daemon's log with a time and a level.
On 2026-11-13, fourteen lines in activepieces, agent-claude, agent-pi and the sdk called `console.warn` or `console.error`. In a detached daemon they landed in `daemon.log` bare.
After this plan, each goes through the logger its package has, and a test fails on a new `console` call.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "console\.(error|warn|log|info)" packages/*/src` - fourteen calls, none in `packages/server/src`.
- agent-claude takes `log` from `host.log` in its options, and a session did not get it.
- agent-pi passes `log` to its sessions, and two lines and `toPiTool` did not use it.
- The activepieces engine is a forked process with no log. Its two lines went to the inherited stderr.

### Runtime path

```
a session or the engine has a line -> console.warn -> the daemon's stderr -> a bare line in daemon.log
```

### Gaps

- A claude session has no logger, `toPiTool` takes none, `gitWorktrees` takes none, and the engine has no way to reach the plugin's log.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Each line keeps its words, prefix and all | `(defaulted: the lines are already read in logs)` | 01 |
| A line with no logger to go to is dropped | `(defaulted: the daemon always passes one; a test passes its own)` | 01 |
| The engine sends a line as a `log` message, and the plugin writes it with `host.log` | `(defaulted: the IPC channel is the engine's one way to the plugin)` | 02 |
| A file URL's line names its origin alone | `(defaulted: a signed URL holds a token, as the engine's refusal already avoids)` | 02 |
| A test fails on a `console` call in any package's `src` | The problem file's fix | 03 |

## Proposed architecture

- **Data flow** - agent-claude passes `options.log` to `createSession`. `toPiTool` and `gitWorktrees` take a `log`. The sdk's tooling uses `ctx.log`. The engine sends `{ type: 'log', level, line }`.
- **Event flow** - the plugin's message handler writes a `log` message with `host.log` before it reads answers.
- **State flow** - unchanged.
- **Layer responsibilities** - four packages and the server's wiring of `gitWorktrees`.
- **Source-of-truth files** - [`code://packages/server/test/no-console.test.ts`](../../../../packages/server/test/no-console.test.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The sdk, claude and pi lines use their logger](task-01-the-sdk-claude-and-pi-lines-use-their-logger.md) | implemented | - |
| [02 - The engine's lines reach the plugin's log](task-02-the-engines-lines-reach-the-plugins-log.md) | implemented | - |
| [03 - A console call fails a test](task-03-a-console-call-fails-a-test.md) | implemented | 01, 02 |

## Risks and tradeoffs

- A line a session writes with no logger is dropped. The daemon always gives one, and so does each test that reads them.
- The problem file said a piece got `null` with no reason for a file it could not fetch. The engine test shows the validator refuses it, naming the host, so that part was not true.

## Resume state

- **Done so far:** tasks 01 to 03 implemented, 2026-11-13; see [implemented.md](implemented.md).
- **Next action:** review of the PR. The plan closes as `built` on Softov's word.
- **Open questions:** none.
- **Watch out for:** the engine runs its source with the types stripped, so a runtime import in it names a `.ts` file.

## Final verification checklist

- [x] No `console` call is left in any package's `src`.
- [x] The test fails on one planted in the sdk.
- [x] The agent-claude, agent-pi, activepieces, sdk and server suites pass.
