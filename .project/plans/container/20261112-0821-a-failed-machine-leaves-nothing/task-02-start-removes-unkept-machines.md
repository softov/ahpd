---
title: Start removes unkept machines
status: implemented
depends: []
layer: "computer"
refs:
  - "[code://packages/computer/src/plugin.ts#L1543-L1549](../../../../packages/computer/src/plugin.ts#L1543-L1549) - `adopt`"
---

## Objective

At start, `adopt` removes a disposable machine with this daemon's `ahpd.host` label whose session this daemon does not keep.

## Files

- `UPDATE: packages/computer/src/plugin.ts:1545-1565` - the `mine` branch removes the machine in place of leaving it.
- `UPDATE: packages/computer/test/computer-disposable.test.ts` - cases for this daemon's machine and for another daemon's, and the two leftover cases the new branch changes.

## Steps

1. In `adopt`, split the branch for a disposable machine whose session is not kept into `mine` and not `mine`.
2. For `mine`, call the plugin's remove for the machine and log one line that names it and its session.
3. Keep the log line for another daemon's machine as it is.
4. Write the cases.

## Validation

- The new cases: `adopt` removes this daemon's unkept machine with its volume, and keeps another daemon's.
- `pnpm typecheck` and the computer suite pass.

## Resume

Done: `adopt` splits the unkept branch into not `mine`, which keeps its log line, and `mine`. The `mine` branch calls `made.remove(one.id)` and logs one line naming the machine and its session. The removal goes through `remove`, which takes a `fetch` machine's `ahpd-git-<name>` volume with the container. A removal that throws is logged and not thrown, and the branch continues.

The new branch would have removed two existing cases' machines, so each got what it needed to stay. A machine seeded with no `ahpd.host` and loaded with no `hostId` is `mine`, since `undefined === undefined`. The leftover case now seeds `ahpd.host: daemon-there` and loads as `daemon-here`. The `keptFor` case now passes a sessions store that keeps `echo:/one`, so its own `ours` machine is adopted instead of removed.

The new case seeds this daemon's unkept machine with a `fetch` label and an `ahpd-git-unkept` volume. It asserts that the machine and the volume are gone, and that the log names both the machine and its session. The changed leftover case asserts that another daemon's machine stays.

Left: no vitest was run, by the build instruction. `pnpm exec tsc -p tsconfig.json --noEmit` prints nothing.
