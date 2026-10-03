---
title: pi runs nested from the ahpd part
status: todo
depends: [task-03-a-cofold-machine-runs-ahpd-from-its-part.md]
layer: "agent-pi, computer"
refs:
  - "[code://packages/agent-pi/src/agent.ts#L90-L155](../../../../packages/agent-pi/src/agent.ts#L90-L155) - the agent object `piAgent` answers"
  - "[code://packages/agent-cofold/src/agent.ts#L640-L646](../../../../packages/agent-cofold/src/agent.ts#L640-L646) - cofold's `runsNested`, the pattern"
  - "[code://packages/sdk/src/nested.ts#L95-L103](../../../../packages/sdk/src/nested.ts#L95-L103) - the proxy loads `@ahpd/agent-<provider>` inside by default"
  - "[code://.project/decisions/a-session-reaches-a-nested-host-through-a-generic-proxy.md](../../../decisions/a-session-reaches-a-nested-host-through-a-generic-proxy.md) - the proxy names pi as a later user"
---

## Objective

`@ahpd/agent-pi` declares `runsNested: true` and `machine()` with `ahpdPart: { part: 'ahpd' }`, and the ahpd part installs `@ahpd/agent-pi` beside `@ahpd/agent-cofold`, so a pi session on a computer runs in an ahpd started inside it.

## Files

- `UPDATE: packages/agent-pi/src/agent.ts:90-155` - `runsNested` and `machine()`, each with a comment saying what it is, as cofold's has.
- `UPDATE: packages/computer/images/versions.json` - the `ahpd` part's plugin list gains `@ahpd/agent-pi`.
- `UPDATE: packages/agent-pi/test/agent-pi.test.ts` - both fields.

## Steps

1. Add both fields; nothing in pi's session changes, because the inner host runs pi as it runs on this one.
2. The proxy starts `ahpd --stdio --plugin @ahpd/agent-pi`, which the plugin list makes resolvable.

## Validation

- The agent reports `runsNested` and the part need.
- By hand: a pi session on a disposable machine from `debian:bookworm-slim` answers a turn.

## Resume
