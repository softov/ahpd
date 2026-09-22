---
title: The tests, the docs and the release set
status: done
depends:
  - task-02-the-three-tools.md
layer: docs
refs:
  - code://test/agent-acp-plugin.test.ts - the loader, a fixture through the real plugin entry, and the manifest listed without importing
  - code://test/fixtures/acp-server.mjs - a scripted subprocess that answers by request, which the docker fixture copies
  - code://docs/PLUGINS.md - the worked examples the new package joins
  - code://docs/COMPUTER.md - the operator's half, which gains what the package does
  - code://.github/workflows/release.yml - four loops that name the five packages by hand
  - code://.project/plans/index.md - the plugin rows
---

## Objective

The runtime, the provider and the tools are covered by tests that need no Docker, the docs say what the package is, and the workflow releases six packages rather than five.

## Files

- `CREATE: test/fixtures/docker.mjs` - a scripted `docker`: it answers `ps`, `inspect`, `run`, `stop`, `rm` and `exec` from a state file, records every call, and never asks a daemon for anything.
- `CREATE: test/computer.test.ts` - the provider and the tools against a fake runtime object: the listing, `status` and `capabilities`, the `-32008` for a machine that is not there, create with limits, release, exec, and the `max` refusal.
- `CREATE: test/computer-plugin.test.ts` - the real loader over `./packages/computer/src/index.ts` with `command` pointing at the fixture: the provider registered, a `computer:` read through the host, and the three tools in `SessionState.serverTools`.
- `UPDATE: docs/PLUGINS.md` - a worked example: the options, the three URIs, the three tools, and what a backend with a policy can do with `effects`.
- `UPDATE: docs/COMPUTER.md` - the package beside the script, and which one to reach for.
- `UPDATE: .github/workflows/release.yml` - a sixth name in the tag check, the staging loop, the rehearsal loop and the list it prints.
- `UPDATE: .project/plans/index.md`, `.project/plans/plugin/00-plugin.md` - the row and the kind's consumer.

## Steps

1. Write the fixture so it is driven by the arguments and the state file and never sleeps, as `acp-server.mjs` is.
2. Write the unit cases with a hand-written runtime object, which is where the limits and the refusals are cheap to check.
3. Write the end-to-end case through `loadPlugins`, naming the source entry rather than the package directory, because `pnpm test` runs before `pnpm build`.
4. Add the docs and the workflow edits, checking every loop in `release.yml` that names a package.
5. `pnpm test`, `pnpm typecheck`, `pnpm boundary`, `pnpm build` and `node tools/schema.mjs`.

## Validation

- `test/computer.test.ts` and `test/computer-plugin.test.ts` green, and the suite count moves by the cases they add.
- `pnpm test`, `pnpm typecheck`, `pnpm boundary` and `pnpm build` green.
- `rg -n "sdk agent-claude agent-cofold agent-acp server" .github/workflows/release.yml` finds no loop left at five.
- By hand: `ahpd plugin list --plugin ./packages/computer` says `ready` and names the title.

## Resume

Done 2026-09-22.
Built: `test/fixtures/docker.mjs` (a scripted `docker` that answers from a state file and records every call), `test/computer.test.ts` (5 cases against a runtime object), `test/computer-plugin.test.ts` (3 cases through the real loader and the fixture command), the `@ahpd/computer` example in `docs/PLUGINS.md`, the package beside the script in `docs/COMPUTER.md`, and `release.yml` six-wide in its four loops and its list.
Found: a client cannot call a host tool, so the end-to-end case calls the tools off `options.tools` directly; the daemon path was then checked by hand, with a real container the script made, and the provider listed it, read its `status` from `docker inspect`, answered `capabilities`, and refused a write with `-32601`.
Suite: 67 files, 872 tests.
