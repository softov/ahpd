---
title: A changes URI is parsed on read, and an ahp-edit URI carries its session as one base64url segment
status: accepted
date: 2026-09-27
supersedes: decisions/changes-uris-are-parsed-on-read-and-minted-to-survive-a-client.md
refs:
  - "[code://packages/sdk/src/changes.ts#L86](../../packages/sdk/src/changes.ts#L86) - `beforeUri`, `ahp-git:` with an empty authority"
  - "[code://packages/sdk/src/changes.ts#L254-L255](../../packages/sdk/src/changes.ts#L254-L255) - `capturedUri`, `ahp-edit:` with the session URI as the authority"
  - git://6e4b2c4 - `gitChanges` and the `ahp-git:` URI
---

## Context

ahpd mints `ahp-git:` and `ahp-edit:` URIs for the sides of a diff and resolves them in `ChangesetSource.read` by comparing the text it minted.
VS Code parses every URI into its `URI` class and sends `toString()` of it back, which is not always the same text.
Run through VS Code's `src/vs/base/common/uri.ts` (`git -C /github/externals/vscode show HEAD:src/vs/base/common/uri.ts`):
- an empty authority loses its `//`: `ahp-git:///github/x` comes back `ahp-git:/github/x`;
- an authority is lowercased and has `%3A%2F` decoded: `ahp-edit://cofold%3A%2FAbc-123/...` comes back `ahp-edit://cofold:/abc-123/...`;
- a path is decoded and re-encoded with `/` kept literal, so `%2F` inside a segment splits it: `ahp-edit://turn/cofold%3A%2FAbc-123/t1/...` comes back `ahp-edit://turn/cofold%3A/Abc-123/t1/...`;
- a space in a path comes back as `%20`, and a raw `#` in a file name starts a fragment.

## Decision

`read` parses the URI it is given and decodes its path, so the form a client normalises it to resolves the same side.
Minted URIs carry no case-sensitive or reserved data in the authority: `ahp-git://head/<path>` and `ahp-edit://turn/<session>/<turn>/<phase>/<path>`.
`<session>` is the session URI as one base64url segment (RFC 4648 section 5, no padding), which holds no `/`, `%` or character any client re-encodes; every other path segment is percent-encoded.
Captured sides are kept under the parsed parts, not under the minted text.
A URI minted before this change resolves when a client sends it back as it was given; one a normalising client has already rewritten, with its case lost, does not.

Source: Softov, 2026-09-27, asked "How should ahpd's changes URIs be fixed?": "Parse on read, mint safe"; then asked "VS Code decodes %2F inside a path segment, so the session URI comes back split. How should ahpd mint the session inside an ahp-edit URI?": "base64url".

## Consequences

A client that sends back exactly what it was given, as ahpapp does, and one that normalises, as VS Code does, both open every side.
An `ahp-edit:` URI no longer shows its session to a person reading it.
Each scheme ahpd mints needs a round-trip case through a client's normal form, not only through the text it minted.

## Options

- **Percent-encode the session twice** (`%252F`): readable, and survives VS Code's one decode, but not a client that decodes twice.
- **The turn id alone**: no session in the URI, but turn ids would have to be unique across sessions and the host would keep a table from turn to session.
- **Opaque ids** (`ahp-edit://side/<hex id>`, held in memory): survives any client, but an `ahp-git:` URI a client cached stops resolving after a restart.
- **Tolerate the slashes and add an authority to `ahp-git:`**: the smallest change, and it leaves `ahp-edit:` and file names with a space or a `#` broken.
