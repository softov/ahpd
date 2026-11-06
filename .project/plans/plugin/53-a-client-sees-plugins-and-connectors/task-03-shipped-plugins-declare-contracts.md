---
title: Every shipped plugin declares its contracts
status: done
depends: [task-02-a-registration-is-checked.md]
layer: "every plugin package"
refs:
  - "[code://packages/webhook/package.json](../../../../packages/webhook/package.json) - an `ahpd` field to extend"
  - "[code://packages/bot/src/plugin.ts](../../../../packages/bot/src/plugin.ts) - a plugin with channels, methods and an agent"
---

## Objective

Each plugin package in this repository declares `description`, `categories` and `contracts` in its `ahpd` field.
Each one still loads, which proves the contracts list every registration.

## Files

- `UPDATE: packages/agent-acp/package.json` - the manifest fields.
- `UPDATE: packages/agent-claude/package.json` - the manifest fields.
- `UPDATE: packages/agent-cofold/package.json` - the manifest fields.
- `UPDATE: packages/agent-pi/package.json` - the manifest fields.
- `UPDATE: packages/bot/package.json` - the manifest fields.
- `UPDATE: packages/computer/package.json` - the manifest fields.
- `UPDATE: packages/push/package.json` - the manifest fields.
- `UPDATE: packages/tasks/package.json` - the manifest fields.
- `UPDATE: packages/tunnel-devtunnel/package.json` - the manifest fields.
- `UPDATE: packages/webhook/package.json` - the manifest fields.
- `CREATE: packages/server/test/plugin-contracts.test.ts` - load every shipped plugin with its contracts.

## Steps

1. Read each plugin's `apply`, and list every register call with its name.
2. Write the list in `ahpd.contracts`, one key for each kind.
3. Write `description` as one sentence, and `categories` from `agent`, `channel`, `connector`, `storage` and `tool`.
4. Add the repository's `links` entry to each one.
5. Write a test that loads each shipped plugin and expects no contract error.
6. Run the test, and set this task and the plan row to `done`.

## Validation

- `plugin-contracts.test.ts`: every shipped plugin loads with no problem line about a contract.
- `pnpm -s build`, `pnpm -s typecheck` and `pnpm -s boundary` pass.

## Resume

- **Done so far:** every package's `ahpd` field carries `description`, `categories`, `links` and `contracts`, and `plugin-contracts.test.ts` loads all ten by directory with no contract problem. Step 1's list is what each contract says:
  - `agent-acp`, `agent-claude`, `agent-cofold`, `agent-pi`: `agents: ["*"]`, because the agent id is the preset key or the `provider` option and any name is allowed. Three of them have a fixed default (`claude`, `cofold`, `pi`) that `*` already covers, so no separate entry is written.
  - `bot`: `agents` `bot-chat`; `channels` `x-ahpd-bots`; `resourceProviders` `bot`; `tools` `post_message`.
  - `computer`: `channels` `x-ahpd-computers`; `resourceProviders` `computer`; `methods` `x-ahpd/computers/create`, `x-ahpd/computers/start`, `x-ahpd/computers/stop`, `x-ahpd/computers/restart`, `x-ahpd/computers/remove`; `tools` `request_disposable_computer`, `release_computer`, `computer_exec`; `sessionConfigs` `computer`; `ports` `computers` and `containers`; `closers` `the up time of every running machine`.
  - `push`: `resourceProviders` `push`.
  - `tasks`: `channels` `x-ahpd-plans`; `tools` `plan_create`, `plan_set`, `plan_show`, `plan_list`, `plan_approve`, `task_add`, `task_set`, `task_list`, `task_approve`, `task_review`; `plans` `a session's plan lines`; `sessionMeta` `ahpd.tasks`.
  - `tunnel-devtunnel`: `contracts: {}`, because it registers only `on` handlers.
  - `webhook`: `routes` `post /plugins/webhook/:endpoint`; `triggerTypes` `webhook`.
  - The name-less kinds (`plans`, `routes`, `closers`) say what they register rather than a name, which is what their check reads: the key and one entry.
  - Patterns are the answer Softov gave to the open question below: task 02's `declared` now matches an entry ending in `*` by prefix and `*` by itself, with two cases in `plugin-host.test.ts`. The plan's Answers table carries the row.
  - 28 `plugin-host` tests, 10 in `plugin-contracts.test.ts` and 34 in `plugin-load.test.ts` pass; `build`, `typecheck` and `boundary` pass.
- **Departures:** `push` and `tunnel-devtunnel` carry `categories: []`, because neither registers an agent, channel, connector, tool or store the vocabulary names: push is a resource provider and a set of event listeners, and the tunnel is two host moments. `webhook` says `connector`, which is the kind task 08 gives it.
- **Next action:** task 05.
- **Open questions:** none.
- **Watch out for:** `packages/server/package.json` has an `ahpd` field and is not a plugin; it was left alone. The test loads the built `dist`, so it must run after `pnpm -s build`. The computer load passed here in under a second, so the CI-only note in the earlier Resume did not hold.
- **Commit:** not made in the session (`git add` is denied here). Files: the ten `packages/*/package.json` named in Files, `packages/server/test/plugin-contracts.test.ts`, this task file and the plan row. The pattern support is in task 02's commit line: `packages/sdk/src/plugins/validate.ts`, `packages/sdk/test/plugin-host.test.ts` and that task file.
