---
title: pi declares its state
status: done
depends: [task-06-pi-runs-nested.md]
layer: "agent-pi"
refs:
  - "[code://packages/agent-pi/src/agent.ts#L90-L155](../../../../packages/agent-pi/src/agent.ts#L90-L155) - the agent object"
  - npm://@earendil-works/pi-coding-agent - `PI_CODING_AGENT_DIR`, default `~/.pi/agent`, holding `settings.json`, `models.json`, `auth.json` and `sessions/`
---

## Objective

pi's `machine()` adds a state need at `/ahpd/pi`, with `PI_CODING_AGENT_DIR=/ahpd/pi`, seeded with `settings.json` and `models.json` from the host's own dir, and the provider keys pi's settings name as secret env needs; `auth.json` is never seeded.

## Files

- `UPDATE: packages/agent-pi/src/agent.ts:90-155` - the needs.
- `UPDATE: packages/agent-pi/test/agent-pi.test.ts` - the cases below.

## Steps

1. The host dir is `PI_CODING_AGENT_DIR` when the daemon has it, else `~/.pi/agent`.
2. The secrets are the provider key variables pi reads, named from pi's provider list, and only those. A variable a person's pi settings name beyond that list is not declared: the profile adds it as a need of its own.
3. A secret need has no default of the daemon's: its value is the profile's or the plugin's need value, which the vault resolves when it is written as a `{ "$secret" }`.
4. In mode `host`, mount the host dir read-write at the same target, marked `when: 'host'`; pi locks `auth.json` across processes, so that route is safe on one filesystem.

## Validation

Write each case first and see it fail against today's code, then build until it passes.

- Mode `volume`: the state need, its two seeds, the env, the secrets; no host mount.
- With host pi settings that name a custom key variable, the declared secret env needs are exactly the provider list's, and the custom name is not among them.
- Mode `host`: the mount and the env.
- With `PI_CODING_AGENT_DIR` unset in the daemon, the seeds are read from `~/.pi/agent` under the test's `HOME`; with it set, from there.

## Resume
