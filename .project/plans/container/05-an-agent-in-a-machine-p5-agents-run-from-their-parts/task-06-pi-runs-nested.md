---
title: pi runs nested from the ahpd part
status: done
depends: [task-03-a-cofold-machine-runs-ahpd-from-its-part.md]
layer: "agent-pi, computer"
refs:
  - "[code://packages/agent-pi/src/agent.ts#L90-L155](../../../../packages/agent-pi/src/agent.ts#L90-L155) - the agent object `piAgent` answers"
  - "[code://packages/agent-cofold/src/agent.ts#L640-L646](../../../../packages/agent-cofold/src/agent.ts#L640-L646) - cofold's `runsNested`, the pattern"
  - "[code://.project/plans/container/04-a-cofold-session-in-a-computer/task-17-a-backend-names-its-nested-plugin.md](../04-a-cofold-session-in-a-computer/task-17-a-backend-names-its-nested-plugin.md) - the inner host loads the plugin that registered the agent"
  - "[code://.project/decisions/a-session-reaches-a-nested-host-through-a-generic-proxy.md](../../../decisions/a-session-reaches-a-nested-host-through-a-generic-proxy.md) - the proxy names pi as a later user"
---

## Objective

`@ahpd/agent-pi` declares `runsNested: true` (the inner host loads `@ahpd/agent-pi`, the plugin that registered it, container/04 task 17) and `machine()` with `ahpdPart: { part: 'ahpd' }`, and the ahpd part installs `@ahpd/agent-pi` beside `@ahpd/agent-cofold`, so a pi session on a computer runs in an ahpd started inside it.

## Files

- `UPDATE: packages/agent-pi/src/agent.ts:90-155` - `runsNested` and `machine()`, each with a comment saying what it is, as cofold's has.
- `UPDATE: packages/computer/images/versions.json` - the `ahpd` part's plugin list gains `@ahpd/agent-pi`.
- `UPDATE: packages/agent-pi/test/agent-pi.test.ts` - both fields.

## Steps

0. This task needs container/04 task 17 (the host records each agent's plugin) and p3 task 02 (plugins installed into `/opt/ahpd/ahpd/plugins`, resolved through `AHPD_PLUGIN_ROOT`).
1. Add both fields; nothing in pi's session changes, because the inner host runs pi as it runs on this one.
2. The proxy starts `ahpd --stdio --plugin @ahpd/agent-pi`, which the plugin list makes resolvable.

## Validation

- The agent reports `runsNested` and the part need.
- By hand: a pi session on a disposable machine from `debian:bookworm-slim` answers a turn.

## Resume
