---
title: "@cofold/remote serves a registry (cofold repository)"
status: todo
depends: []
layer: "cofold remote"
refs:
  - file:///github/cofold/examples/commands/clerver/server.ts - the handler to promote
  - file:///github/cofold/packages/remote/src/index.ts - the exports
---

## Objective

`@cofold/remote` exports `serve(registry, program, { authorize?, prefix? })`, a Node request handler that routes by `meta.http`, answers `<prefix>/cli-manifest`, passes each request's headers to `authorize`, and maps errors to 401, 403, 404, 400 and 500; the `clerver` example uses it.

## Files

- `CREATE: /github/cofold/packages/remote/src/serve.ts`
- `UPDATE: /github/cofold/packages/remote/src/index.ts`
- `UPDATE: /github/cofold/examples/commands/clerver/server.ts`
- `UPDATE: /github/cofold/ROADMAP.md` - the `serve` item answered.

## Steps

1. Move the example's handler, adding `prefix` and the `authorize` context.
2. Tests beside it, as the package's others are.
3. A cofold release, since ahpd depends on the published package.

## Validation

- `npm run check` in `/github/cofold` green; the clerver round trip still works.

## Resume
