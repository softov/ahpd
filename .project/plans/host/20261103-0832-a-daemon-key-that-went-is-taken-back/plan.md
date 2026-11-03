---
title: A daemon key that went is taken back
domain: host
status: planned
priority: medium
created: 2026-11-03
revalidated: 2026-11-03
refs:
  - git://cde4dd6c - the commit of ahpd this plan was checked at
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-root/reducer.ts#L34 - the root reducer merges a config in, or replaces the values"
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/root-channel.md#L100 - \"Merges (or replaces) `config.values`\""
  - "[code://packages/sdk/src/host/root.ts#L675-L688](../../../../packages/sdk/src/host/root.ts#L675-L688) - `daemonValuesMoved`, which says a key that went as `null`"
  - "[code://packages/sdk/src/host/root.ts#L643-L662](../../../../packages/sdk/src/host/root.ts#L643-L662) - `rootSeed`, which assembles every value the root holds"
  - "[code://packages/sdk/test/root-config.test.ts#L100-L170](../../../../packages/sdk/test/root-config.test.ts#L100-L170) - the host with a daemon port"
---

## Goal

A daemon key the file no longer holds is taken back from every client's root config.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "daemonValuesMoved" packages` - the daemon's own writes and the server's path reader call it.
- `rg -n "null" packages/sdk/src/host/root.ts` - a key that went is said as `null` in a merge.

### Runtime path

```
the daemon's file changes -> daemonValuesMoved -> root/configChanged -> every client's root config
```

### Gaps

- A key that went is said as `null`, which the reducer merges in as a value.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The reducer merges a config in: `values: action.replace ? { ...action.config } : { ...state.config.values, ...action.config }`, so a `null` is a value under that key | [reducer.ts#L34](https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-root/reducer.ts#L34) | 01 |
| The channel's own table says the action "Merges (or replaces) `config.values`", so a replacement is how a key goes | [root-channel.md#L100](https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/root-channel.md#L100) | 01 |
| VS Code's host keeps no daemon file, so it has no counterpart and the specification's text decides | [`code://packages/sdk/src/host/root.ts`](../../../../packages/sdk/src/host/root.ts) | - |
| The replacement carries every value the root holds, which `rootSeed` already assembles | [`code://packages/sdk/src/host/root.ts`](../../../../packages/sdk/src/host/root.ts) | 01 |

## Proposed architecture

- **State flow** - a key that went sends a replacement of the root's values; a key that moved still sends a merge.
- **Layer responsibilities** - sdk: `daemonValuesMoved`.
- **Source-of-truth files** - [`code://packages/sdk/src/host/root.ts`](../../../../packages/sdk/src/host/root.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A key that went sends a replacement](task-01-a-key-that-went-sends-a-replacement.md) | todo | - |

## Risks and tradeoffs

- A replacement carries every value the root holds, so a value this host forgot to assemble would go from every client's config.

## Resume state

- **Done so far:** nothing.
- **Next action:** task 01.
- **Open questions:** none.
- **Watch out for:** a connection reads the daemon's keys only with `config:read`, and the echo is filtered for it as any other is.

## Final verification checklist

- [ ] The new case fails on `cde4dd6c` for the reason it names, and passes after the change.
- [ ] The root config test file passes.
- [ ] `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.
