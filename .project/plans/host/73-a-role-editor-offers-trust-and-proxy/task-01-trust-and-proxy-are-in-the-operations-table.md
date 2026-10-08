---
title: trust and proxy are in the operations table
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/users.ts#L111-L189](../../../../packages/sdk/src/users.ts#L111-L189) - `OPERATIONS`"
  - "[code://packages/sdk/src/host/root.ts#L305-L331](../../../../packages/sdk/src/host/root.ts#L305-L331) - `advertisedGrants`"
  - "[code://packages/sdk/test/users-host.test.ts#L369](../../../../packages/sdk/test/users-host.test.ts#L369) - the advertisement test"
---

## Objective

`OPERATIONS` has a `trust` entry and a `proxy` entry, and the host advertises both to a client.

## Files

- `UPDATE: packages/sdk/src/users.ts:111-189` - add `trust` (`push`, write group) and `proxy` (`models` read, `call` write), each with a short title and a one-sentence description.
- `UPDATE: packages/sdk/src/host/root.ts:309` - the comment's subject count.
- `UPDATE: packages/sdk/src/host/gate.ts:271-280` - the trust push asks for `trust:push`.
- `UPDATE: packages/server/src/proxy/listener.ts:462` - a proxy call asks for `proxy:call`.
- `UPDATE: packages/server/src/proxy/listener.ts:614` - the model list asks for `proxy:models`.
- `UPDATE: packages/sdk/test/users-host.test.ts` - the cases below.
- `UPDATE: packages/sdk/test/users-gate-dispatch.test.ts` - a push from a role holding only `trust:push`, and from one holding only `trust:get`.
- `UPDATE: packages/sdk/test/users.test.ts` - the built-in roles, which hold the groups that cover the operations.
- `UPDATE: packages/server/test/proxy-listener.test.ts` - a call from a role holding only `proxy:call`, and a list from one holding only `proxy:models`.
- `UPDATE: docs/USERS.md` - the count of decided subjects, the `proxy` and `trust` rows with their own operations and groups, the built-in `member` row, and the places that name the grant behind each.
- `UPDATE: docs/PROXY.md` - *Who may call*, and the 403 row of the error table.
- `UPDATE: docs/AHP.md:176` - the `root/configChanged` row.

## Steps

1. Write the tests.
2. Add the two entries.
3. Run `node tools/schema.mjs` and keep what the wire test writes.
4. Ask for the operation at the three ask sites, and let the group cover it.
5. Update every page that names the grant behind the two subjects.

## Validation

- `users-host.test.ts`: the advertisement holds `trust` with `push` and `proxy` with `models` and `call`, in the groups above.
- The same file: `grantProblem('trust:push')` and `grantProblem('proxy:call')` answer nothing, and `grantProblem('trust:get')` names the subject's operations.
- A gate test refuses a `workspaceTrust` push from a role with no trust grant.
- It accepts one from a role holding only `trust:push`, and refuses one holding only `trust:get`.
- A proxy test calls for a role holding only `proxy:call` and lists for one holding only `proxy:models`.
- The built-in `member` is still served the call, the model list and the push.
- `pnpm build`, `pnpm typecheck`, `pnpm boundary` and `npx vitest run` pass from the root.

## Resume

- **Implemented** 2026-10-07 on `build/agents/a261d92b`.
- `OPERATIONS` gains `trust` and `proxy`. `trust` has `push`, in the write group. `proxy` has `models` in the read group and `call` in the write group. Each carries a title and a one-sentence description.
- `advertisedGrants` and `grantProblem` read the two entries with no change. The subjects now reach a client. A word that is not one of theirs is refused with the list they do have.
- The comment at `root.ts` says ten subjects, not eight. It says the ones this host decides, not the ones the gate asks for. The proxy's listener asked for `proxy:read` and `proxy:write` then, which the review fix below changes.
- `users-host.test.ts` names the two subjects in its two key lists. A case of its own reads both off the handshake, with their operations and groups. It checks the words `grantProblem` takes and refuses.
- `docs/USERS.md` was not in *Files* and had to move. Its `trust` and `proxy` rows sat in the schemes table and named no operation. The page's own test requires a row for each of `OPERATIONS` to name each of its operations. Both rows move into the table with read and write group columns, which is now ten subjects. A short paragraph says neither subject has a scheme of its own.
- Found while moving them: the `member` row of that page omitted `trust:write`. `users.ts` gives the role that grant, and *Trusted folders* says it holds it. The row is corrected.
- **A stale ref corrected**: the decision `pushing-workspace-trust-needs-trust-write` pointed at `gate.ts#L269-L276`. That range stopped covering the line it is about when host/70 landed. It points at `gate.ts#L271-L280` now.
- Gates: `pnpm build`, `pnpm typecheck`, `pnpm boundary` and `npx vitest run --maxWorkers=2` all pass. The last ran 251 files and 4,355 tests. `packages/sdk/test/fixtures/wire.jsonl` gained the two subjects on the handshake and the root snapshot. The one line carrying the provider endpoint of this box was restored to the committed one.
- **The review fix, later the same day**: the advertisement offered `trust:push`, `proxy:call` and `proxy:models`. The gate still asked for the groups, so a role holding only an operation was refused. A review found it, and Softov answered the fork: the gate asks the operation.
- The three ask sites changed to the operation: `gate.ts` line 277, and `listener.ts` lines 462 and 614. `holds` already covered each one through its group and through the wildcards, so the built-in roles did not change. The refusal text names the operation now, which is the whole of the visible change on a refusal.
- Tests written for it first, and red until the three lines changed. A role holding only `trust:push` may push, and one holding only `trust:get` may not. The proxy takes a call only from `proxy:call`, and a list only from `proxy:models`. The two older refusal cases still hold the group, and so does the built-in `member`.
- Two more pages moved, and both are in *Files* now. `docs/PROXY.md` named `proxy:write` and `proxy:read` where it says what a caller needs, and `docs/AHP.md` named `trust:write` in its action table.
- The plan's defaulted row is the answered fork now, its three refs were corrected, and so was the note of the decision's ref. The refs of this task and of the plan carry the new span of `OPERATIONS`.
- Gates run again after the fix: `pnpm build`, `pnpm typecheck` and `pnpm boundary` clean, and the schema unchanged. The suite is green at 251 files and 4,359 tests with `--testTimeout=10000`. One test of `packages/computer` needs 5,165 ms and misses the default 5 second budget on this box.
