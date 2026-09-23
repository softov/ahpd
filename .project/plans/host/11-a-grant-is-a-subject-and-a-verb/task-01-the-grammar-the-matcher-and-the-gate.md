---
title: The grammar, the matcher and the gate
status: done
depends: []
layer: packages/sdk
refs:
  - "[code://packages/sdk/src/types/users.ts#L13-L35](../../../../packages/sdk/src/types/users.ts#L13-L35) - the grammar"
  - "[code://packages/sdk/src/users.ts#L20-L52](../../../../packages/sdk/src/users.ts#L20-L52) - the built-ins, `isGrant` and `holds`"
  - "[code://packages/sdk/src/users.ts#L140-L200](../../../../packages/sdk/src/users.ts#L140-L200) - the file reader, the once-only reporter and `principalOf`"
  - "[code://packages/sdk/src/host.ts#L137-L190](../../../../packages/sdk/src/host.ts#L137-L190) - `NEEDS`"
  - "[code://packages/sdk/src/host.ts#L220-L245](../../../../packages/sdk/src/host.ts#L220-L245) - `dispatchNeeds`"
  - "[code://packages/sdk/src/host.ts#L4626-L4665](../../../../packages/sdk/src/host.ts#L4626-L4665) - `capabilityFor`"
---

## Objective

A grant is `<subject>:<verb>`, `*` matches in either position, every method declares its pair, and the three built-ins are `admin` (`*:*`), `member` and `guest`.

## Files

- `UPDATE: packages/sdk/src/types/users.ts` - `Grant` becomes the grammar; `Verb` replaces `Capability`; `Users.list` answers resolved grants.
- `UPDATE: packages/sdk/src/types/index.ts` - export `Verb` instead of `Capability`.
- `UPDATE: packages/sdk/src/users.ts` - the built-ins, `isGrant`, `holds`, the malformed-grant report, the role-name refusal in `add`, and the grants in `list`.
- `UPDATE: packages/sdk/src/host.ts` - `NEEDS` by pair, `dispatchNeeds` by pair, and `capabilityFor` scoping only the file subject by the URI.
- `UPDATE: test/users.test.ts`, `test/users-gate.test.ts`, `test/users-issuer.test.ts`, `test/users-host.test.ts` - the matrix, the wildcards and the new expectations.

## Steps

1. Replace `Capability` and the old `Grant` with `Verb` and `${string}:${Verb | '*'}`.
2. Write `isGrant` and `holds`, the second matching exact, `*:*`, `*:<verb>` and `<subject>:*`.
3. Rewrite `NEEDS`: file read and write, session read and write, terminal write, automation read and write, diagnostics read.
4. Rewrite `dispatchNeeds` as writes: `session:write`, `terminal:write`, `automation:write`, `file:write` for the root, `file:read` otherwise.
5. Have `capabilityFor` read the subject from `NEEDS` and scope only `file` by the URI's scheme, so a resource on a plugin's scheme is `<scheme>:read` or `<scheme>:write`.
6. Report a grant that is not a subject and a verb once, and drop it, rather than leaving it inert.
7. Refuse a role name that is neither in the file nor built in, and answer resolved grants from `list`.

## Validation

- `test/users.test.ts` - `admin` covers every area and reaches a scheme only through `*:*`; `member` keeps its two areas; `guest` looks and does not act; `*:read`, `session:*` and `*:*` each do what they say; a malformed grant is reported and dropped; `list` answers the grants; `add` refuses a role nothing defines.
- `test/users-gate.test.ts` - the gate matrix in the new spelling, including the scheme case and the channel map.
- `pnpm test`, `pnpm typecheck` and `pnpm boundary` green.

## Resume

Done 2026-09-23.
The grammar, `isGrant` and `holds` are in; `NEEDS`, `dispatchNeeds` and `capabilityFor` are by pair; the built-ins are `admin` = `*:*`, `member`, `guest`; a malformed grant is reported once and dropped; `add` refuses an unknown role; `list` answers the resolved grants.
Found: the first cut reported a malformed grant on every file read, and the file is read on every question, so the report moved behind a once-only set. The role-nothing-defines line had the same problem and is now once as well.
