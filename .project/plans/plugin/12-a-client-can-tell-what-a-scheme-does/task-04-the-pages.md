---
title: The pages a provider author and a client read
status: done
depends:
  - task-01-a-provider-says-what-its-scheme-is-for.md
  - task-02-the-host-advertises-them.md
  - task-03-not-a-permission-error.md
layer: docs
refs:
  - "[code://docs/PLUGINS.md](../../../../docs/PLUGINS.md) - the provider contract a plugin author reads"
  - "[code://docs/COMPUTER.md](../../../../docs/COMPUTER.md) - the worked example"
  - "[code://packages/sdk/README.md](../../../../packages/sdk/README.md) - the ports and the types"
  - "[code://.project/plans/index.md](../../index.md) - the row this plan's status moves with"
  - "[code://.project/working/HANDOFF.md](../../../working/HANDOFF.md) - the pending list"
---

## Objective

A plugin author reads what `describe()` is for and what the host does with it, a client author reads the `_meta` key and its shape, and the computer page says what ahpapp reads.

## Files

- `UPDATE: docs/PLUGINS.md` - `describe()` in the provider section, and the `_meta` key in a short "what a client is told" subsection.
- `UPDATE: docs/COMPUTER.md` - the advertisement as the way a client learns there are computers, with the key and its shape.
- `UPDATE: packages/sdk/README.md` - `SchemeDescription` and the optional method in the provider line.
- `UPDATE: .project/plans/index.md` - the row, built when it is built.
- `UPDATE: .project/working/HANDOFF.md` - the pending list and the recent-things paragraph.

## Steps

1. Say in `docs/PLUGINS.md` that `describe()` is a claim about the scheme, that the host supplies `root` and `operations` from what the provider implements, and that a provider without it is advertised by those alone.
2. Document the `ahpd.resourceProviders` shape with one example, including that the key is absent when no provider is registered and that a client must ignore a key it does not know.
3. Point `docs/COMPUTER.md` at the key as what a client reads before it draws a create form, next to the resource commands it already documents.
4. Keep every page to links for the parts another page owns.

## Validation

- The docs link check over `.project` and `docs` is clean.
- Every key, flag and field a page names is one the code reads, checked by reading the code.
- `pnpm test` green, since no code changes here.
- The plan's status in `plans/index.md` matches the plan folder.

## Resume

Not started.
