---
title: Claude runs from its part
status: done
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/claude.ts#L373-L398](../../../../packages/agent-claude/src/claude.ts#L373-L398) - the needs"
  - "[code://packages/agent-claude/src/claude.ts#L390-L396](../../../../packages/agent-claude/src/claude.ts#L390-L396) - the host binary mount, unconditional today"
  - "[code://packages/agent-claude/src/claude.ts#L78-L96](../../../../packages/agent-claude/src/claude.ts#L78-L96) - `computerExecutable` and `computerConfigDir`"
  - "[code://packages/agent-claude/src/plugin.ts#L36-L45](../../../../packages/agent-claude/src/plugin.ts#L36-L45) - the plugin-wide options"
  - "[code://packages/agent-claude/src/plugin.ts#L136-L143](../../../../packages/agent-claude/src/plugin.ts#L136-L143) - what every variant shares"
  - "[code://packages/sdk/src/types/machine.ts#L74-L78](../../../../packages/sdk/src/types/machine.ts#L74-L78) - the need kinds, where p4 task 01 adds `PartNeed`, which gains `fallback`"
  - "[code://packages/computer/src/manifest.ts#L561-L605](../../../../packages/computer/src/manifest.ts#L561-L605) - where agents' needs are gathered, and where p4 task 02 leaves out a part that failed to build"
---

## Objective

Claude's `machine()` answers `claudePart: { part: 'claude' }` and the CLI inside a machine is `claude` on the machine's `PATH`; with `computerCli: "host"`, it answers today's `claudeExecutable` mount instead.
For now `computerCli: "part" | "host"` is a new plugin-wide option, `"part"` by default, shared by every variant like `computerExecutable`.
`computerExecutable` keeps its meaning, the CLI's path inside a machine.
When the `claude` part cannot be built, `computerCliFallback` decides: `"refuse"`, the default, leaves the part out as p4 task 02 does, so the Claude session is refused with a sentence naming `claude`, and `"host"` mounts the host binary in its place with one log line saying so.

## Files

- `UPDATE: packages/agent-claude/src/claude.ts:373-398` - the part need, or the host mount when asked for.
- `UPDATE: packages/agent-claude/src/claude.ts:78-96` - `computerCli?: 'part' | 'host'` on `ClaudeOptions`, with a comment saying what it is.
- `UPDATE: packages/agent-claude/src/plugin.ts:36-45,136-143` - `computerCli` in the schema as an enum of `part` and `host`, default `part`, and `computerCliFallback` as an enum of `refuse` and `host`, default `refuse`, both shared by every variant.
- `UPDATE: packages/agent-claude/src/claude.ts:78-96` - `computerCliFallback?: 'refuse' | 'host'` on `ClaudeOptions`, with a comment saying it is read only with `computerCli: "part"`.
- `UPDATE: packages/sdk/src/types/machine.ts` - `PartNeed.fallback?: FileNeed | DirectoryNeed`, with a comment saying it is made only when the part is left out.
- `UPDATE: packages/computer/src/manifest.ts` - a part need left out at create (p4 task 02 step 2) whose need carries `fallback` resolves the fallback in its place, logs one line naming the part and the fallback, and labels the part `<id>@host` in `ahpd.parts`.
- `UPDATE: packages/agent-claude/test/agent-claude-options.test.ts` - both routes and both fallback values.
- `UPDATE: packages/computer/test/computer-needs.test.ts` - the fallback cases below.

## Steps

0. This task needs p4 task 01's part need kind; build after it.
1. Add `computerCli`; a value other than `part` or `host` fails the load, naming the option.
2. Replace the executable need with the part need unless `computerCli` is `host`; the choice is one branch in `machine()`.
3. Keep `claudeExecutablePath` for the host route.
4. Add `computerCliFallback`; a value other than `refuse` or `host` fails the load, naming the option.
5. With `computerCliFallback: "host"` and `computerCli: "part"`, the part need carries today's `claudeExecutable` mount as its `fallback`; with `refuse`, it carries none.
6. In the computer plugin, a part left out because its build failed, or its requirement's build failed, resolves its need's `fallback` when there is one: the mount goes on the machine, one line says the part `claude` could not be built and the host binary is mounted instead, and the `ahpd.parts` label names it `claude@host`, which p4's session check accepts as the part.
7. Without a `fallback`, p4 task 02's rule holds: the part is left out with its log line, and a Claude session on that machine is refused with a sentence naming `claude`.

## Validation

Write each case first and see it fail against today's code, then build until it passes.

- Default: needs have `claudePart` and no `claudeExecutable`, and the part need has no `fallback`.
- `computerCli: "host"`: today's needs exactly.
- `computerCliFallback: "host"`: the part need carries the `claudeExecutable` mount as its `fallback`.
- `computerCliFallback: "skip"` fails the load, naming the option.
- Two variants of one load answer the same part need.
- `computer-needs.test.ts`: with the fake Docker failing the build of `ahpd-part/claude` and no fallback, the machine is labelled without `claude`, the log names `claude`, and a Claude session there is refused with a sentence naming `claude`.
- `computer-needs.test.ts`: the same with the fallback mount on the part need puts the host binary mount in the fake's argv, labels the machine `claude@host`, logs one line naming the part and the fallback, and the Claude session's check passes.

## Resume
