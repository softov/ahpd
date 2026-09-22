---
title: The three tools
status: done
depends:
  - task-01-the-package-runtime-and-provider.md
layer: plugin
refs:
  - code://packages/sdk/src/types/host.ts#L232-L254 - `HostTool`, `effects` and `instruction`
  - code://packages/sdk/src/sessiontools.ts - the host tools that ship, and how one is written
  - code://.project/research/host-owned-uri-resources.md - `request_disposable_computer`, which this registers
  - code://scripts/computer.mjs - the limits and the label the create tool applies
---

## Objective

A session's model can call `request_disposable_computer`, `release_computer` and `computer_exec`, and each answers with what it did in the terms the provider then reports.

## Files

- `CREATE: packages/computer/src/tools.ts` - `computerTools(runtime, options): HostTool[]`, one per tool, each with a `definition`, an `effects` claim and a `run`.
- `UPDATE: packages/computer/src/plugin.ts` - register each of them through `host.registerTool` after the provider.

## Steps

1. `request_disposable_computer({ image?, cpus?, memory?, name? })`: the configured limits unless the call overrides them, the configured label always, `sleep infinity` as the command, and an answer naming the `computer://<id>` URI the provider will report.
2. `release_computer({ id })`: stop and remove, and answer that it is gone; a machine that was not there is an answer, not a failure.
3. `computer_exec({ id, command })`: run it and answer its output and exit code, with a non-zero code said in the text rather than thrown, because the command failing is the tool working.
4. Refuse past the configured `max`, and refuse a call with no `id` where one is needed, each with a sentence naming the limit.
5. `effects`: `request` claims `writes` and `network`, `release` claims `destructive`, `exec` claims `writes`, `network` and `destructive`, so a backend with a policy has something to ask on.
6. `pnpm typecheck`, `pnpm test` and `node scripts/boundary.mjs`.

## Validation

- By hand: a daemon with the plugin loaded offers the three tools in `SessionState.serverTools` for a session.
- By hand: `request_disposable_computer` leaves a labelled container that `computer://` then lists, and `release_computer` takes it away.
- `pnpm test`, `pnpm typecheck` and `pnpm boundary` green.

## Resume

Done 2026-09-22.
Built: `tools.ts` with `request_disposable_computer`, `release_computer` and `computer_exec`, each with a definition, an `effects` claim and an instruction where one helps; the plugin registers all three after the provider.
The create tool takes the configured image, limits and label, lets a call override the image and the limits, generates a name when none is given, and refuses past `max` with the list of what exists.
A missing id, a machine that is not there and a missing command are sentences rather than throws, because the model is what reads them; a command that exits non-zero is answered with its code rather than thrown, because the command failing is the tool working.
