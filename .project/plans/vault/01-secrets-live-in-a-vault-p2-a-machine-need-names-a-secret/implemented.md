---
title: A machine need names a secret, read when the machine is made - implemented
date: 2026-10-03
refs:
  - "[code://packages/computer/src/secrets.ts](../../../../packages/computer/src/secrets.ts)"
  - "[code://packages/computer/src/plugin.ts](../../../../packages/computer/src/plugin.ts)"
  - "[code://packages/computer/src/provider.ts](../../../../packages/computer/src/provider.ts)"
---

A machine need's value in the computer plugin's `needs` or a profile's `needs` may be `{ "$secret": "<name>" }`; it is read from the vault when a machine is made, for that machine's owner and team, and only for needs an agent on that machine declares.

## What was built

- [`code://packages/computer/src/secrets.ts`](../../../../packages/computer/src/secrets.ts) - `revealed`, the one place a need value becomes a string: only the names the machine's agents declare are read, and a refusal names the need and the secret, never a value.
- [`code://packages/computer/src/plugin.ts`](../../../../packages/computer/src/plugin.ts) - `needs` and each profile's `needs` are `secretAtUse` strings; the dev container and disposable routes read for the session's owner and team.
- [`code://packages/computer/src/provider.ts`](../../../../packages/computer/src/provider.ts) - the form route reads the picked profile's needs for the writer, a refusal answered `-32602`.
- [`code://packages/computer/src/manifest.ts`](../../../../packages/computer/src/manifest.ts) - `pickedOf`, so only the picked profile is read.
- `docs/COMPUTER.md` - naming a secret under `## Profiles`.

## Verified

- `pnpm exec tsc --noEmit` clean, `pnpm boundary` clean, `pnpm test` 171 files and 2548 tests.
- `computer-needs.test.ts`: a `user:` need read for its person and refused for another, a `host:` value for anyone, a missing name refused, only the picked profile read, a disposable machine read for the session's owner, and a plugin-wide `user:` value under a need only one agent declares not read for a machine of another agent.

## Departures from the plan

- Review found every plugin-wide need read for every machine, so one person's `user:` value stopped everybody else's machines; reads are now limited to the needs the machine's agents declare.
- A machine made from the form has an owner and no team, so a `team:` secret on that route is refused.
- `writeOnly` on the need values waits for container/05 p1 task 04, which adds it beside `secretAtUse`.

## Left for later

- Nothing in this plan.
