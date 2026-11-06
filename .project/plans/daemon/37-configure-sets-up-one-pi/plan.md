---
title: configure sets up one pi
domain: daemon
status: built
priority: medium
created: 2026-10-21
revalidated: 2026-10-21
refs:
  - "[code://packages/server/src/commands/configure.ts#L45-L49](../../../../packages/server/src/commands/configure.ts#L45-L49) - `BACKENDS`, which names `@ahpd/agent-pi` as the native pi backend"
  - "[code://packages/server/src/commands/configure.ts#L133-L150](../../../../packages/server/src/commands/configure.ts#L133-L150) - `takePreset`, which switches on one `agent-acp` preset"
  - "[code://packages/server/src/commands/configure.ts#L172-L211](../../../../packages/server/src/commands/configure.ts#L172-L211) - the backend questions, then the ACP agent questions"
  - "[code://packages/agent-acp/src/presets.ts#L167-L175](../../../../packages/agent-acp/src/presets.ts#L167-L175) - the `pi` preset, which registers the agent `pi` through `pi-acp`"
  - "[code://packages/sdk/src/plugins/plugins.ts#L375-L392](../../../../packages/sdk/src/plugins/plugins.ts#L375-L392) - the agent clash, where the second registration of an agent is dropped"
  - "[code://packages/server/test/server-configure.test.ts](../../../../packages/server/test/server-configure.test.ts) - the configure cases, over a faked terminal and a faked installer"
---

## Goal

On Softov's machine, `ahpd configure` found `pi` and `pi-acp` on the PATH.
It asked about the native pi backend and about the ACP `pi` preset, and Softov answered yes to both.
Both register the agent `pi`, so the daemon dropped `agent-pi` at start with `agent provider clash`.
After this plan, `configure` sets up one pi.
When the native pi backend is on, `configure` does not offer the ACP `pi` preset.
It offers to remove a `pi` preset that the file already has.
The clash line at start says how to keep one of the two.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg "^  [a-z'-]+: \{" packages/agent-acp/src/presets.ts` - `pi` is the only ACP preset with the name of a native backend.
- Softov's machine, 2026-10-20: `ahpd start` printed `skipped: agent provider clash: plugin agent-pi registers agent pi, which plugin agent-acp already registered`.

### Runtime path

```
ahpd configure -> one question per BACKENDS entry -> findAgents on PATH -> one question per found ACP agent -> takePreset
ahpd start -> loadPlugins -> pluginHost: the first registration of an agent keeps it, and the second is a clash
```

### Gaps

- `configure` asks about the ACP `pi` preset after a yes to the native pi backend.
- `configure` does not see that the file already has both.
- The clash line names the two plugins, but not what to do.

## Answers

| What | Source | Task |
| --- | --- | --- |
| `configure` sets up one pi, and the native backend comes first | Softov, 2026-10-21, to "Write the pi clash plan as I suggested?": "Write the plan" | 01 |
| The agent names stay `pi` in both plugins | (defaulted: a new name changes the URIs of sessions that exist) | 01 |

## Proposed architecture

- **Data flow** - the answer to the native pi question decides whether the ACP `pi` preset is asked about. A file with both gets one question to remove the preset.
- **Source-of-truth files** - [`code://packages/server/src/commands/configure.ts`](../../../../packages/server/src/commands/configure.ts), [`code://packages/sdk/src/plugins/plugins.ts`](../../../../packages/sdk/src/plugins/plugins.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - configure keeps one pi](task-01-configure-keeps-one-pi.md) | done | - |

## Risks and tradeoffs

- A person who wants the ACP `pi` answers no to the native pi question. Then `configure` offers the ACP `pi` preset as it does now.
- The rule names `pi` only, because no other preset has the name of a native backend. A later overlap gets the same treatment with its own entry.

## Resume state

- **Done so far:** [task-01](task-01-configure-keeps-one-pi.md) is implemented. `configure` skips the ACP `pi` question after a yes to the native pi backend. It asks to remove a `pi` preset the file already has. The clash line tells the person to run `ahpd configure`. `server-configure.test.ts` passed 36 of 36, and `plugin-host.test.ts` passed 22 of 22. From the repository root, `pnpm -s build`, `pnpm -s typecheck` and `pnpm -s boundary` passed, and the full suite passed 6474 tests with 29 skipped (387 files passed, 1 skipped).
- **Next action:** none. The plan is built, and `implemented.md` says what exists.
- **Open questions:** none.
- **Watch out for:** a person who wants the ACP `pi` answers No to the native pi question, and the preset is then offered as before. A later overlap of a preset name with a native backend gets the same treatment with its own entry.
