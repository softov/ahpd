---
title: An ACP preset says what its machine needs - implemented
date: 2026-10-05
refs:
  - git://a43c077
  - "[code://packages/agent-acp/src/plugin.ts](../../../../packages/agent-acp/src/plugin.ts)"
  - "[code://packages/agent-acp/src/agent.ts](../../../../packages/agent-acp/src/agent.ts)"
  - "[code://packages/agent-acp/src/types.ts](../../../../packages/agent-acp/src/types.ts)"
  - "[code://packages/agent-acp/src/session/opening.ts](../../../../packages/agent-acp/src/session/opening.ts)"
  - "[code://packages/computer/src/secrets.ts](../../../../packages/computer/src/secrets.ts)"
  - "[code://packages/sdk/src/types/machine.ts](../../../../packages/sdk/src/types/machine.ts)"
  - "[code://packages/sdk/src/machine.ts](../../../../packages/sdk/src/machine.ts)"
---

An ACP preset can write `machine: { env, copy }`, and the variant it registers answers `machine()` with one env need per variable, named `<preset>.<VARIABLE>`, and one copy need per entry, named `<preset>.copy.<n>`. A `{ "fromEnv": "NAME" }` value is read from the daemon's environment at load; a `{ "$secret": "<scope>:<name>" }` value travels as the need's default and the computer plugin reads it for the machine's owner when it makes the machine, through p1's path, so it is never given at create and is passed by name on each command. A preset whose `machine` is wrongly written or reads a variable the daemon lacks is skipped with one line naming the field, and the others register. A session in a machine is handed the host's tools only where the machine can reach the daemon's address, and the log says when they were left out.

## What was built

- [`code://packages/agent-acp/src/plugin.ts`](../../../../packages/agent-acp/src/plugin.ts) - the preset's `machine` in the schema, its `env` values `secretAtUse` and `writeOnly`; `machineOf`, which holds the block's shape and reads each `fromEnv`; `machine` refused at the top level.
- [`code://packages/agent-acp/src/agent.ts`](../../../../packages/agent-acp/src/agent.ts) - `needsOf` and the variant's `machine()`, absent when the preset wrote no block.
- [`code://packages/agent-acp/src/types.ts`](../../../../packages/agent-acp/src/types.ts) - `AcpMachine`, `AcpOptions.machine`, and `authenticateInMachine`, the row's sign-in when only `machine.env` sets its variable, which `signIn` in `session/opening.ts` sends for a session placed in a machine and never on this host. It carries a method id; the key reaches the server only as the machine's environment.
- [`code://packages/agent-acp/src/session/opening.ts`](../../../../packages/agent-acp/src/session/opening.ts) - `toolsReachable(url, where)` and `serversFor` taking where the session runs.
- [`code://packages/sdk/src/types/machine.ts`](../../../../packages/sdk/src/types/machine.ts) - an `EnvNeed` default may be a `SecretRef`.
- [`code://packages/sdk/src/machine.ts`](../../../../packages/sdk/src/machine.ts) - `resolveNeeds` refuses a secret default nothing read.
- [`code://packages/computer/src/secrets.ts`](../../../../packages/computer/src/secrets.ts) - `withDefaults`, used at the form, disposable and dev container creates in `provider.ts` and `plugin.ts`; `namedAgain` falls back to the agent's default after a restart.
- `docs/PLUGINS.md`, `docs/COMPUTER.md`, `packages/agent-acp/README.md`.

## Verified

- `packages/agent-acp/test/agent-acp-machine.test.ts` (12): a `codex` preset with `machine.env.CODEX_API_KEY` and no host-side key sends `api-key` for a session in its machine and no sign-in on this host, with the key in no log line, argv, error or request the server was sent; both need kinds and their names, `fromEnv` following `process.env`, a `$secret` as written, two presets answering their own, a missing `fromEnv` and eight malformed blocks each skipping only their preset beside a good one, no vault read at load and no value in a skip line, a host spawn and a machine port's command carrying none of the machine env, and the whole path through the computer plugin and the fake Docker: plain values at create, the `$secret` by name on `exec`, and no value on any argv, in the Docker state, in `computers.json` or in a log line.
- `packages/computer/test/computer-needs.test.ts` (4 new): a `$secret` default read for the owner at form and disposable create, refused for another owner and for a vault that lacks it with the need and the name, a profile's or the option's value winning without the default being read, and the read again after a restart.
- `packages/agent-acp/test/agent-acp-catalog.test.ts` (7 new) and `packages/sdk/test/machine-needs.test.ts` (1 new). Each new case failed before its change, except the three guards that a preset with no block, a host spawn and a machine port's command carry nothing.
- `pnpm exec tsc --noEmit` clean; `pnpm boundary` clean; `pnpm test` 212 files, 2944 tests passed; `pnpm build` clean.

## Departures from the plan

- The worktree was at 2e7f208; it was fast-forwarded to a43c077 before work started, so p1 is underneath.
- `revealed` is unchanged; `withDefaults` lays the defaults under the option's values, which keeps the profile, option, default order and lets `vaultNamed` mark them.
- `AcpMachine` holds settled values; `{ fromEnv }` is only the plugin option's form.
- `machine` is untyped in the schema so a malformed block costs only its preset; `machineOf` also refuses an unknown key and a copy `target` that is not absolute.
- `resolveNeeds` refusing an unread secret default was not in the plan.
- Task 05's refs pointed at `session.ts`; the code is in `session/opening.ts`.
- `packages/agent-acp/README.md` was updated beside the docs.

## Left for later

- A disposable machine for a Copilot preset answering a turn, against a real Docker and a real agent, is not run.
- The tasks stay `implemented` until Softov reviews them.
