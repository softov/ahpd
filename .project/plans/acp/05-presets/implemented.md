---
title: One ACP load, and each preset is an agent of its own - implemented
---

## What exists

- `@ahpd/agent-acp` takes `presets` and an optional plugin-wide `hostTools`; each key registers an agent of its own with the key as its provider id, from one load.
- `packages/agent-acp/src/presets.ts` ships twelve rows: codex, gemini, copilot, opencode, kilo, goose, pi, dsh, devin, cursor, amp, qwen. A key that names a row takes it, any other key takes the row its `base` names or none and then needs `command`.
- A preset's `env` values are `secretAtUse`; a `$secret` there is read once at load in host scope. A row's sign-in is sent when one of its variables is set in the daemon's environment or the resolved preset `env`.
- A preset that cannot resolve is skipped with one line on `host.log` and `host.problem` naming `options.presets.<id>`; the load fails only when nothing is left, and a top-level per-preset key fails it naming `presets.<id>.<key>`.
- `docs/PLUGINS.md`, `packages/agent-acp/README.md`, `docs/COMPUTER.md` and the root `README.md` show the `presets` shape.

## Verified

- `agent-acp-presets.test.ts` (16 cases): row merge and `base`, preset fields over the row, every skip, `$secret` held, missing, no vault and out of scope, the sign-in from the daemon and from the preset `env`, `hostTools` plugin-wide and per preset, both load refusals.
- `agent-acp-plugin.test.ts`: one load with two presets lists both and serves a turn on each.
- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` (177 files, 2717 tests) pass.
- The codex row's `api-key` is the id `@agentclientprotocol/codex-acp` 2.1.1 defines; the cursor row's `cursor_login` is the one method Cursor's ACP docs advertise.

## Departures

- `docs/COMPUTER.md` and the root `README.md` were changed beyond the task's file list, because their examples wrote a top-level `command` that no longer loads.
- `optionsOf` is exported from `plugin.ts`, not `index.ts`, for the tests to read what a registered agent does not carry.
- An unknown field inside a preset is ignored, as agent-claude's schema allows.
