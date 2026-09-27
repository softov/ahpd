---
title: pi declares its state
status: todo
depends: [task-06-pi-runs-nested.md]
layer: "agent-pi"
refs:
  - "[code://packages/agent-pi/src/agent.ts#L70-L100](../../../../packages/agent-pi/src/agent.ts#L70-L100) - the agent object"
  - npm://@earendil-works/pi-coding-agent - `PI_CODING_AGENT_DIR`, default `~/.pi/agent`, holding `settings.json`, `models.json`, `auth.json` and `sessions/`
---

## Objective

pi's `machine()` adds a state need at `/ahpd/pi`, with `PI_CODING_AGENT_DIR=/ahpd/pi`, seeded with `settings.json` and `models.json` from the host's own dir, and the provider keys pi's settings name as secret env needs; `auth.json` is never seeded.

## Files

- `UPDATE: packages/agent-pi/src/agent.ts` - the needs.
- `UPDATE: packages/agent-pi/test/agent-pi.test.ts`.

## Steps

1. The host dir is `PI_CODING_AGENT_DIR` when the daemon has it, else `~/.pi/agent`.
2. The secrets are the provider key variables pi reads; name them from pi's provider list, and stop and ask if pi's settings can name a variable of their own.
3. In mode `host`, mount the host dir read-write at the same target, marked `when: 'host'`; pi locks `auth.json` across processes, so that route is safe on one filesystem.

## Validation

- Mode `volume`: the state need, its two seeds, the env, the secrets; no host mount.
- Mode `host`: the mount and the env.

## Resume
