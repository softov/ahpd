---
title: The cofold extras - deferred
date: 2026-09-20
---

The harness configuration is read with a small reader of its own, which covers the case that prompted it; the rest waits on whether the extra layers matter.
The published-dependency row this file used to carry is closed and recorded under *Since built* in [implemented.md](implemented.md): the runtime shipped as `@cofold/*`, so the `link:` into a sibling checkout became ranges.

| What | Why it waits | Where it goes |
| --- | --- | --- |
| The harness's layered configuration: the project file, the `COFOLD_CONFIG` environment layer and `--config` | `@cofold/config`'s `resolveConfig` would add a fourth runtime dependency and can relocate the store, which is more than the case that prompted it needed; the user-level `config.json` is enough for a person who has already pointed the runtime at a provider | unplanned; it is one function swap in `packages/agent-cofold/src/config.ts` if the layers are wanted |
