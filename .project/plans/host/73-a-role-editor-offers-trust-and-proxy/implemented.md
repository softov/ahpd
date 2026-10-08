---
title: A role editor offers trust and proxy, the two subjects the gate asks for and does not advertise - implemented
date: 2026-10-07
refs:
  - git://032a0c1 - the commit this work sits on; none of it is committed yet, on `build/agents/a261d92b`
  - "[code://packages/sdk/src/users.ts](../../../../packages/sdk/src/users.ts) - `OPERATIONS`, which now holds `trust` and `proxy`"
  - "[code://packages/sdk/src/host/root.ts](../../../../packages/sdk/src/host/root.ts) - `advertisedGrants`, which reads the two new entries with no change"
  - "[code://packages/sdk/src/host/gate.ts](../../../../packages/sdk/src/host/gate.ts) - `dispatchNeeds`, where the trust push is held to `trust:push`"
  - "[code://packages/server/src/proxy/listener.ts](../../../../packages/server/src/proxy/listener.ts) - the proxy's call and model-list routes, held to `proxy:call` and `proxy:models`"
  - "[code://packages/sdk/test/users-host.test.ts](../../../../packages/sdk/test/users-host.test.ts) - the case that reads both entries off the handshake"
  - "[code://docs/USERS.md](../../../../docs/USERS.md) - the grants table, which is now ten decided subjects"
---

A client's role editor now offers `trust` and `proxy`, the two subjects the host gates and did not advertise.
An operator can write a custom role holding `trust:push`, `proxy:call` or `proxy:models`, or a group that covers them.
The words an editor draws from the wire are the words a role may hold, and the words the gate asks for.
The gate asks for the operation, and the group the editor shows beside it covers the ask.
A role naming a word either subject does not have is refused with the list that subject does have.

## What was built

- [`code://packages/sdk/src/users.ts`](../../../../packages/sdk/src/users.ts) - `OPERATIONS` gains `trust` (`push`, write group) and `proxy` (`models` read, `call` write), each with a title and a one-sentence description. `SUBJECTS` already named the two; the table that `advertisedGrants` and `grantProblem` read did not.
- [`code://packages/sdk/src/host/root.ts`](../../../../packages/sdk/src/host/root.ts) - the comment over `advertisedGrants` says ten subjects, not eight. It says the ones this host decides, not the ones the gate asks for.
- [`code://packages/sdk/src/host/gate.ts`](../../../../packages/sdk/src/host/gate.ts) and [`code://packages/server/src/proxy/listener.ts`](../../../../packages/server/src/proxy/listener.ts) - the gate asks for the operation: `trust:push` on a `workspaceTrust` push, `proxy:call` on a call and `proxy:models` on the model list. `holds` covers each one through its group and the wildcards, so nothing else moved.
- [`code://packages/sdk/test/users-host.test.ts`](../../../../packages/sdk/test/users-host.test.ts) - both key lists name the two subjects. A case of its own asserts the entry of each. It reads `trust` with `push` and `proxy` with `models` and `call`, in the groups the plan fixed. It also asserts the words `grantProblem` takes for the two, and the refusal `trust:get` and `proxy:list` get.
- [`code://packages/sdk/test/fixtures/wire.jsonl`](../../../../packages/sdk/test/fixtures/wire.jsonl) - the handshake and the root snapshot gained the two subjects under `ahpd.grants`. The fixture is written by the wire test on every run.
- [`code://docs/USERS.md`](../../../../docs/USERS.md) - the `proxy` and `trust` rows left the schemes table for the table with read and write group columns. That table now has ten subjects. A short paragraph says neither subject has a scheme of its own. The `member` row gained the `trust:write` it was missing. Every place that names the grant behind the two subjects says the operation the gate asks for.
- [`code://docs/PROXY.md`](../../../../docs/PROXY.md) and [`code://docs/AHP.md`](../../../../docs/AHP.md) - the two pages outside the task's *Files* that named the group where they say what a caller needs.

## Verified

- `pnpm build` clean, `pnpm typecheck` clean, `pnpm boundary` reports nothing undeclared in any of the eight packages.
- `npx vitest run --maxWorkers=2 --testTimeout=10000` from the repository root: 251 files, 4,359 tests, all pass. The four cases the review fix added are the four the count gained.
- The plain run at the default 5 second budget lost one test three times, always the same one. It is `packages/computer`'s "gives a vault-filled key only to the agent whose need declared it", which needs 5,165 ms here. It is a machine test, and this change does not touch its package.
- `node tools/schema.mjs` regenerates the strict schema unchanged, which is what the wire test reads before it validates the new frames.
- The tests the plan's checklist names, all written first. `users-host.test.ts`, "advertises trust and proxy, which the gate asks about through no method", was red on the missing entries.
- The older cases still hold the group, and they still pass. `users-gate-dispatch.test.ts` holds "accepts a workspaceTrust push from a member" and "refuses a workspaceTrust push from a role holding no trust grant". `users.test.ts` holds the built-in roles.
- The review fix added four cases, red until the three ask sites changed. Two are in `users-gate-dispatch.test.ts`, for a push from a role holding only `trust:push` and from one holding only `trust:get`. Two are in `proxy-listener.test.ts`, for a call from a role holding only `proxy:call` and a list from one holding only `proxy:models`.
- `node .agents/skills/do-spec/scripts/lint-prose.mjs` on the plan folder and the decision is clean.

## Departures from the plan

- Task 01's *Files* named three files. A fourth, `docs/USERS.md`, had to move. The page's own test requires a row for each subject of `OPERATIONS` to name each of its operations. The two rows the page already had named none. Its `member` row also omitted `trust:write`, which `users.ts` gives the role and which the same page's *Trusted folders* section says it holds. Task 01's *Resume* records both.
- The decision `pushing-workspace-trust-needs-trust-write` pointed at `gate.ts#L269-L276`, which stopped covering the line it is about when host/70 landed. It points at `gate.ts#L271-L280` now, and its note says what that code does rather than what it did before.
- The plan defaulted "the gate keeps asking for the groups", and the first build left it that way. A review found that this makes the advertisement a lie: a role holding only `trust:push` could not push. Softov answered the fork the same day, the plan's row carries the answer now, and the gate asks the operation. The rejected option was that the editor offers the groups only, which leaves the gate as it was.

## Left for later

- None. The plan named one task and it is implemented.
