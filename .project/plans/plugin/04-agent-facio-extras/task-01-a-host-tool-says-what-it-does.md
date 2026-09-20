---
title: A host tool says what it does, so the default policy can ask
status: todo
depends: []
layer: packages/sdk
refs:
  - code://packages/sdk/src/types/host.ts#L279-L332 - `HostTool`, which gains `effects`
  - code://packages/agent-facio/src/tools.ts - `facioTool`, which passes it to `createTool`
  - file:///github/facio/packages/agents/src/types/tool.ts - `ToolEffects`: `reads`, `writes`, `network`, `destructive`
  - file:///github/facio/packages/agents/src/policy/rules.ts - the default that asks when a tool is destructive
  - code://.project/decisions/host-tool-declares-what-it-does.md - why four flags and not one boolean
  - code://test/agent-facio-approval.test.ts - the harness the new case follows
---

## Objective

`HostTool` gains an optional `effects` of four booleans, the facio bridge passes it to `createTool`, and a tool marked `destructive` raises an approval through facio's own default policy with no policy function configured, so a daemon configured only from a file can gate one.

## Files

- `UPDATE: packages/sdk/src/types/host.ts` - `effects?: { reads?: boolean; writes?: boolean; network?: boolean; destructive?: boolean }` on `HostTool`, with a comment saying what a policy reads it for.
- `UPDATE: packages/agent-facio/src/tools.ts` - pass `effects` through when wrapping a bound tool.
- `UPDATE: test/agent-facio-approval.test.ts` - a destructive host tool gated by the default policy.
- `UPDATE: docs/PLUGINS.md` - the field and what it makes happen.

## Steps

1. Add `effects` to `HostTool` as four optional booleans, documented as the host's own claim about running the tool, not a guarantee, and copied by fakes that do not care.
2. Pass `effects` in `facioTool` when the bound tool carries them, and pass nothing when it does not, so a tool that says nothing keeps the effects facio defaults to.
3. Write the test: a host tool with `effects: { destructive: true }`, a `facioAgent` with no `policy` option, and a fake model that calls it, so the pause comes from facio's default rather than from a policy the test supplied.
4. Assert the entry is a `toolConfirmation`, that `confirm(callId, true)` runs the tool, and that the same session with the same tool and no effects asks nothing.
5. Add the field to `docs/PLUGINS.md` beside the host tool's other members.

## Validation

- A test with no `policy` option raises one `toolConfirmation` for a destructive host tool, and one with no effects raises none.
- The same tool marked `reads: true` and not destructive is not asked about.
- `pnpm test` green, `pnpm typecheck` green, `pnpm boundary` green.

## Resume

Empty until started.
