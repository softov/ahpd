---
title: The resource writes are served without a grant
status: done
depends: []
layer: host
refs:
  - code://packages/sdk/src/host.ts#L4298 - the connection literal that declares `grants`
  - code://packages/sdk/src/host.ts#L4388-L4412 - `mayWrite` and `needsWrite`, deleted
  - code://packages/sdk/src/host.ts#L4963-L4973 - the `resource*` comment that says the write half is gated
  - code://packages/sdk/src/host.ts#L5245-L5257 - the "two gates" comment, rewritten to one
  - code://packages/sdk/src/host.ts#L5258-L5327 - the five `needsWrite` calls, deleted
  - code://packages/sdk/src/host.ts#L5342-L5353 - `resourceRequest`, which keeps answering and loses the set it wrote
  - code://test/writes.test.ts#L23-L37 - the `client(grant)` helper, whose flag goes
  - code://test/writes.test.ts#L242-L280 - the far-end move case, rewritten
  - code://test/writes.test.ts#L282-L309 - the two grant cases, replaced
  - code://test/host.test.ts#L3375-L3395 - the refusal case, replaced
  - code://test/clients.test.ts#L200-L241 - the client-owned refusal, which must keep passing untouched
  - code://docs/AHP.md#L91-L96 - the `resourceWrite` and `resourceRequest` rows
  - code://README.md#L248 - the Resources row
---

## Objective

`resourceWrite`, `resourceDelete`, `resourceMkdir`, `resourceMove` and `resourceCopy` act for a connected client with no grant, `resourceRequest` still answers `{}` for a `file:` URI and still logs the ask, and nothing reads or writes a per-connection grant.

## Files

- `UPDATE: packages/sdk/src/host.ts:4298` - drop `grants` from the connection literal it builds.
- `UPDATE: packages/sdk/src/host.ts:4388-4412` - delete `mayWrite` and `needsWrite` and the comment above them.
- `UPDATE: packages/sdk/src/host.ts:4963-4973` - the `resource*` comment now says both halves are served and neither is gated beyond what the store decides.
- `UPDATE: packages/sdk/src/host.ts:5245-5257` - the comment naming "the same two gates" names the store's one.
- `UPDATE: packages/sdk/src/host.ts:5260,5287,5296,5311,5312,5322` - the six `needsWrite(...)` calls go.
- `UPDATE: packages/sdk/src/host.ts:5342-5353` - `resourceRequest` keeps its `file:` answer, its non-`file:` refusal and its log line; it stops adding to `grants`.
- `UPDATE: test/writes.test.ts:23-37` - `client(grant)` loses its argument and its `resourceRequest` call.
- `UPDATE: test/writes.test.ts:242-280` - the move to `outside` now lands; the case keeps the `failIfExists` refusal and says why the far end is no longer refused.
- `UPDATE: test/writes.test.ts:282-309` - one case that a first write with no `resourceRequest` lands, and one that `resourceRequest` still answers `{}`.
- `UPDATE: test/host.test.ts:3375-3395` - the `-32009` case becomes one where the same write succeeds and answers `{}`.
- `UPDATE: docs/AHP.md:91-96` - the rows stop saying "Behind `resourceRequest`" and "The write gate".
- `UPDATE: README.md:248` - the Resources row drops "writes behind `resourceRequest`".

## Steps

1. Delete `mayWrite` and `needsWrite` and the comment above them from `host.ts`, and remove `grants` from the connection literal at `:4298`.
2. Remove the six `needsWrite(...)` calls from the five resource handlers, and rewrite the comments at `:4963` and `:5245` so they name one gate, the store's, rather than two.
3. Leave `resourceRequest` served: it still refuses a non-`file:` URI with `-32009` and still logs `<client> may write <uri>`, without writing to a set, per decision 1.
4. Update `test/writes.test.ts`: simplify the helper, rewrite the far-end case, and replace the two grant cases with one that a write needs no grant and one that `resourceRequest` still answers.
5. Update `test/host.test.ts`'s case to assert the write succeeds, and confirm `test/clients.test.ts`'s client-owned refusal still passes with no change.
6. Update `docs/AHP.md`'s two rows and `README.md`'s row.
7. Run `pnpm test`, `pnpm typecheck` and `pnpm boundary`.

## Validation

- `test/writes.test.ts` - a first write, a delete, a mkdir, a move and a copy all land with no `resourceRequest`; `resourceRequest` still answers `{}`; the store's symlink, directory and missing-parent refusals are unchanged.
- `test/host.test.ts` - the write that was refused now succeeds and answers `{}`.
- `test/clients.test.ts` - a client-owned resource still refuses with the owner's own `-32009` and the same log line.
- `pnpm test`, `pnpm typecheck` and `pnpm boundary` green.
- By hand: a VS Code window saves a file in a session workspace this host serves.

## Resume

Done 2026-09-23.
`mayWrite`, `needsWrite` and the `grants` set are gone from `packages/sdk/src/host.ts`, and `grants` is gone from the `Connection` interface in `packages/sdk/src/types/host.ts` as well, which the plan's file list did not name: `mayWrite` was its only reader, so leaving the field would have been a claim of enforcement nothing performs.
Two comments outside the plan's list claimed the host gated on a write grant and were corrected with it: `CodegenOperation.writes` in `packages/sdk/src/types/changes.ts` and the `invoke` comment in `packages/sdk/src/changes.ts`. The flag itself stays, as the descriptive thing it now is.
Found as the plan predicted: the far-end move does land because the store reaches any absolute path, and the copy `failIfExists` refusal is still `-32010`. The store's own `-32009` for a directory or a symlink is untouched.
The `client(grant)` helper existed only for the two cases the plan replaced, so it lost its argument.
