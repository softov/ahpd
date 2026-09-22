---
title: The facio extras - deferred
date: 2026-09-20
---

The harness configuration is read with a small reader of its own, which covers the case that prompted it; the rest waits on whether the extra layers matter.

| What | Why it waits | Where it goes |
| --- | --- | --- |
| The harness's layered configuration: the project file, `$FACIO_CONFIG` and `--config` | `@facio/config`'s `resolveConfig` would add a fourth linked facio package and can relocate the store, which is more than the case that prompted it needed; the user-level `config.json` is enough for a person who has already pointed facio at a provider | unplanned; it is one function swap in `packages/agent-cofold/src/config.ts` if the layers are wanted |
| The `@facio/*` dependencies published and pinned to a range rather than `link:` to a sibling checkout | facio is at `0.0.1` and unpublished, and the cut task 02 needs is an uncommitted change there; the repository is `private: true` until it publishes | the facio release, then this package's `dependencies` |
