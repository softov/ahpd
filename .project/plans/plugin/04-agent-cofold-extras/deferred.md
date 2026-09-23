---
title: The cofold extras - deferred
date: 2026-09-20
---

The harness configuration is read with a small reader of its own, which covers the case that prompted it. The layered reader below is **dropped**, not waiting on a publish: see the row.
The published-dependency row this file used to carry is closed and recorded under *Since built* in [implemented.md](implemented.md): the runtime shipped as `@cofold/*`, so the `link:` into a sibling checkout became ranges.

| What | Why it waits | Where it goes |
| --- | --- | --- |
| The harness's layered configuration: the project file, the `COFOLD_CONFIG` environment layer and `--config` | Dropped 2026-09-23, and `@cofold/config` shipping does not change it. The layers exist so a CLI started inside a project resolves that project; this plugin resolves when the daemon starts, from the daemon's working directory, while a session's project is its own `workingDirectory`, so adopting `resolveConfig` there would resolve the wrong project. The plugin needs `providers`, `model` and `instructions` and already reads exactly those from the user file | dropped, not waiting on anything; no change to `@cofold/config` and no republish is needed for it |
