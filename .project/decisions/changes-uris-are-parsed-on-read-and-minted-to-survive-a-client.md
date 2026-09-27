---
title: A changes URI is parsed on read, and minted so a client's normal form of it still resolves
status: superseded
superseded-by: decisions/an-ahp-edit-uri-carries-its-session-as-base64url.md
date: 2026-09-27
refs:
  - "[code://packages/sdk/src/changes.ts#L85-L86](../../packages/sdk/src/changes.ts#L85-L86) - `beforeUri`, `ahp-git:` with an empty authority"
  - "[code://packages/sdk/src/changes.ts#L254-L255](../../packages/sdk/src/changes.ts#L254-L255) - `capturedUri`, `ahp-edit:` with the session URI as the authority"
  - "[code://packages/sdk/src/changes.ts#L759-L779](../../packages/sdk/src/changes.ts#L759-L779) - `read`, which matches the text it minted"
  - git://6e4b2c4 - `gitChanges` and the `ahp-git:` URI
---

## Context

ahpd mints `ahp-git:` and `ahp-edit:` URIs for the sides of a diff and resolves them in `ChangesetSource.read` by comparing the text it minted.
VS Code parses every URI into its `URI` class and sends `toString()` of it back, which is not always the same text.
Run through VS Code's `src/vs/base/common/uri.ts`: an empty authority loses its `//` (`ahp-git:///github/x` comes back `ahp-git:/github/x`), an authority is lowercased and has `%3A%2F` decoded (`ahp-edit://cofold%3A%2FAbc-123/...` comes back `ahp-edit://cofold:/abc-123/...`), a space in a path comes back as `%20`, and a `#` in a file name starts a fragment.
So every modified file's `before` fails to open in VS Code, and a turn's captured sides fail whenever the session URI has a colon or a capital.

## Decision

`read` parses the URI it is given and decodes its path, so the form any client normalises it to resolves the same side.
Minted URIs carry no case-sensitive or reserved data in the authority: `ahp-git://head/<path>` and `ahp-edit://turn/<session>/<turn>/<phase>/<path>`, with every path segment percent-encoded.
Captured sides are kept under the parsed parts, not under the minted text.
`read` still resolves the forms minted before this change, so a URI a client already holds keeps opening.

Source: Softov, 2026-09-27, asked "How should ahpd's changes URIs be fixed?": "Parse on read, mint safe".

## Consequences

A client that sends back exactly what it was given, as ahpapp does, and one that normalises, as VS Code does, both open every side.
Each scheme ahpd mints needs a round-trip case through a client's normal form, not only through the text it minted.

## Options

- **Opaque ids** (`ahp-edit://side/<hex id>`, held in memory): survives any client, but an `ahp-git:` URI a client cached stops resolving after a restart.
- **Tolerate the slashes and add an authority to `ahp-git:`**: the smallest change, and it leaves `ahp-edit:` and file names with a space or a `#` broken.
