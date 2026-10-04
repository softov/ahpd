---
title: The proxy and the capture check are ahpc's
status: todo
depends: []
layer: "docs"
refs:
  - "[code://DEVELOPER.md#L39-L53](../../../../DEVELOPER.md#L39-L53) - the paragraph and table row"
  - "[code://package.json#L28](../../../../package.json#L28) - the `wire` script"
---

## Objective

`scripts/tee.mjs`, `tools/validate.mjs` and the `wire` script are removed, and every doc that named them names `ahpc wire proxy` or `ahpc wire check`.

## Files

- `DELETE: scripts/tee.mjs`, `tools/validate.mjs`.
- `UPDATE: package.json` - the `wire` script removed.
- `UPDATE: DEVELOPER.md:39-53` - the recording paragraph names the line shape `--wire` writes now (the message with `_ahpLog`) and `ahpc wire proxy`; the `pnpm wire` row becomes `ahpc wire check <capture>`.
- `UPDATE: docs/AHP.md:871`, `docs/DAEMON.md:279`, `README.md:443`, `UPSTREAM.md` - the same names.
- `UPDATE: tools/wire.mjs` - the comment that names `tools/validate.mjs`.

## Steps

1. Remove the files and the script.
2. Rewrite each mention, one line each, with the ahpc command.

## Validation

- The plan's `rg` finds nothing; `pnpm test` passes.

## Resume

