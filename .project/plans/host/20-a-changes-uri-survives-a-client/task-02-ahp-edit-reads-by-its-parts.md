---
title: ahp-edit keeps the session out of the authority and is read by its parts
status: implemented
depends: [task-01-ahp-git-reads-any-form.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/changes.ts#L242-L255](../../../../packages/sdk/src/changes.ts#L242-L255) - `kept` and `capturedUri`"
  - "[code://packages/sdk/src/changes.ts#L310-L320](../../../../packages/sdk/src/changes.ts#L310-L320) - `rowsOf`"
  - "[code://packages/sdk/src/changes.ts#L733](../../../../packages/sdk/src/changes.ts#L733) - a captured side kept"
  - "[code://packages/sdk/src/changes.ts#L759-L779](../../../../packages/sdk/src/changes.ts#L759-L779) - `read`"
---

## Objective

A turn's captured sides resolve after VS Code has lowercased and decoded the URI, for a session URI with a colon and capitals and a file with a space or a `#`, per decision [an-ahp-edit-uri-carries-its-session-as-base64url](../../../decisions/an-ahp-edit-uri-carries-its-session-as-base64url.md).

## Files

- `UPDATE: packages/sdk/src/changes.ts:242-255` - `kept` is keyed by the parsed parts; `capturedUri` mints `ahp-edit://turn/...`.
- `UPDATE: packages/sdk/src/changes.ts:310-320,733` - sides are kept by their parts.
- `UPDATE: packages/sdk/src/changes.ts:759-779` - the `ahp-edit:` half of `read` parses the URI.
- `UPDATE: packages/sdk/test/changes-uris.test.ts` - the cases below.

## Steps

1. `capturedUri(session, turn, path, phase)` is `ahp-edit://turn/` then the session URI as one base64url segment (RFC 4648 section 5, no padding), then the turn, the phase and the file path, each of those segments percent-encoded, so nothing case-sensitive is in the authority and no segment holds a `%2F` a client can turn into `/`.
2. `kept` is keyed by one string built from the decoded session, turn, phase and path, and both places that fill it use that key.
3. `read` parses an `ahp-edit:` URI, decodes the session from base64url and the other segments from percent-encoding, and looks the side up by the same key.
   One minted in the old form (the session as the authority) is parsed the same way and still resolves while the side is held, when the client sends it back as it was given.

## Validation

- `changes-uris.test.ts`: a captured side for session `cofold:/Abc-123`, turn `t1`, file `/w/a file #1.md` resolves from the minted URI and from the form VS Code sends back for it (the authority lowercased, the path decoded and re-encoded with VS Code's own encoder, which keeps `/` literal, so a `%2F` inside a segment becomes a `/`).
  Today the second answers `undefined`.
- A side minted in the old `ahp-edit://<encoded session>/...` form still resolves when it comes back exactly as minted.
- `node_modules/.bin/vitest run packages/sdk/test/changes-uris.test.ts` green.

## Resume

Built. `capturedUri` mints `ahp-edit://turn/<base64url session>/<turn>/<phase>/<path>`, with the turn, the phase and each path segment percent-encoded.
`kept` is keyed by `sideKey(session, turn, phase, path)`, and `rowsOf` and `observe` both fill it under that key.
A new `sideOf` parses an `ahp-edit:` URI: under the `turn` authority the first segment is the session in base64url, and under any other authority the authority is the percent-encoded session of the older form.
The turn is everything before the phase segment, and `sideOf` tries each place a `before` or `after` segment could start, because a `compare/<a>/<b>` scope is one encoded segment as minted and three segments once VS Code has decoded its `%2F`.

- `changes-uris.test.ts` carries a normaliser ported from VS Code's `uri.ts` (`_regexp`, `percentDecode`, `encodeURIComponentFast` and `_asFormatted`) and checks it against the five outputs in the plan's Searches performed.
- The cases capture both sides of `a file #1.md` for session `cofold:/Abc-123`, turn `t1`, and read them from the minted URI and from the normalised form, read a `compare/t1/t1` side in both forms, and read a side from the older `ahp-edit://<encoded session>/...` form sent back as given.
- Failing first: the minted side did not start with `ahp-edit://turn/` ("expected false to be true"), and the normalised form of a `compare/t1/t1` side answered `undefined` ("expected undefined to be 'as left\n'").
- Gates: `pnpm typecheck` green, `pnpm boundary` green, `pnpm test` 105 files and 1443 tests green.
