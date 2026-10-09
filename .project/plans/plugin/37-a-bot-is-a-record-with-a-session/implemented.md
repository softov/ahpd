---
title: A bot is a record a person makes, with a session to talk to it in - implemented
date: 2026-10-08
refs:
  - "[code://packages/bot/src/provider.ts](../../../../packages/bot/src/provider.ts)"
  - "[code://packages/bot/src/start.ts](../../../../packages/bot/src/start.ts)"
  - "[code://packages/sdk/src/types/plugin.ts](../../../../packages/sdk/src/types/plugin.ts)"
  - "[code://docs/BOTS.md](../../../../docs/BOTS.md)"
  - "[code://.project/plans/plugin/37-a-bot-is-a-record-with-a-session/plan.md](plan.md)"
---

Tasks 02, 04 and 05 are built on top of 01 and 03, which were already merged (1a3ee7a). A bot's `session` is written now: a body may link a session its owner has, a make with no `session` gets one started for it, and the plugin has a page of its own in the docs. Nothing is committed: Softov reads the diff first.

## What was built

- [`code://packages/bot/src/provider.ts`](../../../../packages/bot/src/provider.ts) - a `BotSessions` seam on `BotOptions` (`owner(uri)`, `start(wanted)`), built in `plugin.ts` over `host.sessionOwner` and `host.startSession`. A write whose body names a session asks the host before saving, and a make with no session asks the host to start one; both happen before `store.put`, so a refusal leaves no record.
- [`code://packages/bot/src/start.ts`](../../../../packages/bot/src/start.ts) - new. `sessionFor(bot)` builds the `SessionRequest`: `provider` is `preset ?? harness`, `workingDirectory` is the bot's folder, `model` is `{ id }` unless a preset is set, `config` carries a named computer, `prompt` is the instructions and `title` is the name. The folder is made before the start where the bot runs on this host.
- [`code://packages/bot/src/record.ts`](../../../../packages/bot/src/record.ts) - `session` is read off a body by `link`: a URI, `null` to unlink, or absent to leave the link as it was. `MANIFEST` in `provider.ts`, the form a client draws a make from, gained `session` and `owner`: the form and the check must not disagree, which is the standard `policy-scheme.test.ts` holds its own scheme to.
- [`code://packages/sdk/src/types/plugin.ts`](../../../../packages/sdk/src/types/plugin.ts) - `PluginHost.sessionOwner(uri)`, mirroring `sessionKept`; `SessionRequest` gained `model`, `title` and an optional `prompt`.
- [`code://packages/sdk/src/plugins.ts`](../../../../packages/sdk/src/plugins.ts) - `sessionOwner` reads the fold's live `sessions` option by the id inside the URI, the way `sessionKept` does.
- [`code://packages/sdk/src/host/automations.ts`](../../../../packages/sdk/src/host/automations.ts) - `beginSession` passes `title` to `openSession`'s existing eighth parameter, and `beginIn` returns without firing a turn when the text is blank.
- [`code://packages/sdk/src/validate.ts`](../../../../packages/sdk/src/validate.ts), [`code://packages/sdk/src/types/automations.ts`](../../../../packages/sdk/src/types/automations.ts) - `checkSessionRequest` accepts an absent `prompt` as a silent session and checks `model` and `title`; `StartSession` carries `title`.
- [`code://packages/sdk/test/plugin-host.test.ts`](../../../../packages/sdk/test/plugin-host.test.ts), [`code://packages/bot/test/bot-provider.test.ts`](../../../../packages/bot/test/bot-provider.test.ts) - `sessionOwner` answers from the store by the id in the URI; the bot's cases cover the link and its two refusals, unlinking, a start that is refused leaving no bot, the thirteen fields the make form offers, and the four bodies `docs/BOTS.md` prints.
- [`code://docs/BOTS.md`](../../../../docs/BOTS.md) - new. The record, the slug, the folder and the `root` option, the bodies and colours, the session, the grants and four example writes.
- [`code://docs/RESOURCES.md`](../../../../docs/RESOURCES.md), [`code://docs/README.md`](../../../../docs/README.md), [`code://docs/PLUGINS.md`](../../../../docs/PLUGINS.md), [`code://packages/bot/README.md`](../../../../packages/bot/README.md), [`code://README.md`](../../../../README.md) - the `bot:` scheme named among the plugin-served ones, the index row, a `Starting a session as an owner` section for `startSession`, `sessionKept` and `sessionOwner`, the bot README's `session` field, session section and grants table, and the package row a reader finds the plugin by.

## Verified

- `node tools/schema.mjs`: 508 definitions from 506 exported types, 633 closed objects, the same unexpressed list as before.
- `pnpm build`, `pnpm typecheck` and `pnpm boundary`: clean. Boundary reports 9 packages, none undeclared.
- `npx vitest run --maxWorkers=2 --testTimeout=10000`: 254 files, 4428 tests, all passed, exit 0. Two runs were made, and the second is the one on the frozen tree: the first was 4427 tests before the make form's case was added.
- Every example body in `docs/BOTS.md` is sent by a test: `answers the writes docs/BOTS.md shows` writes each one to this host and reads the record back.
- Nothing was committed, so there is no `git://` ref.

## Departures from the plan

- **Four sdk additions the tasks did not name.** Task 02's Files list three files and the work needed a fourth thing: a way to ask whose a session is, which `sessionKept` answers only as a boolean. `PluginHost.sessionOwner` was added beside it, and with it `types/plugin.ts`, `plugins.ts` and `test/plugin-host.test.ts`. Task 04 needed three more: `SessionRequest.model` and `SessionRequest.title`, `StartSession.title`, and `SessionRequest.prompt` becoming optional. Each mirrors the code beside it rather than inventing a mechanism.
- **The empty prompt is narrowed, not reversed.** Task 03 settled that "an empty prompt is a mistake and not a quiet session", and this task's validation asks for "a bot with none sends no turn", which cannot both hold. An absent `prompt` is now a session that opens silent and a present-but-blank one is still refused `-32602`, so the mistake task 03 named is still a mistake on the road that takes text.
- **The model rides as `SessionRequest.model`, not in `config`.** The plan says a preset wins over `harness` and `model`; the model reaches the backend as the protocol's `ModelSelection` on the first turn, which is the only place a session has one, and `config` would name a key no backend declares.
- **Task 05's `docs/USERS.md:385-404` no longer holds a grants table.** The docs were reorganised by documentation/03 and USERS.md now points at RESOURCES.md for the scheme rows, so the `bot:` scheme was named in RESOURCES.md's **Schemes** paragraph instead. The grants are the ten operations every scheme has, which RESOURCES.md's **Grants** section already states; the bot's own rule is BOTS.md's table. `packages/bot/README.md` also said a member of the owning team or project may only read, and the code, the user's rule and task 01's tests all say they may edit and delete - corrected there.
- **The make form gained `session` and `owner`.** A body may carry either - `session` from task 02, `owner` since task 01 - and the advertised make form offered neither, so a client drawing a form from `describe()` could not give what the check accepts. The form moved with the check; `owner` is offered as the string it is, with the membership rule in its description.
- **The root README gained a `@ahpd/bot` row and badge.** No task in this plan names `README.md`, and the package table has listed every other package since task 01 added this one. The fact belongs where the package list lives, so the row is there rather than in `docs/BOTS.md`.
- **`sessionOwner` and `sessionKept` are documented for the first time.** Neither appeared in `docs/` before, and `startSession` had no section; all three are in PLUGINS.md now.
- **The wire fixture is rewritten by every suite run.** `packages/sdk/test/wire.test.ts` writes `packages/sdk/test/fixtures/wire.jsonl` as it captures, and this box's capture names the endpoint it found (`https://api.deepseek.com/anthropic/v1/models`) where the committed file names `https://api.anthropic.com/v1/models`. It is an output and never an input, so the suite's result does not depend on it. `git` is refused in this session, so the line was put back in place rather than by checkout, and the working tree holds no other change from the run.

## Left for later

- The colour palette is ahpapp's eleven, written into `packages/bot` as a fixed list. No palette exists in this repository, so a change on the client side has to come back here.
- The instructions go in as the session's first turn, so making a bot spends one turn. A harness that takes a system prompt can carry them without a turn, which is the bot harness plan's work.
- `packages/bot/src/provider.ts` makes the bot's folder itself when the bot runs on this host. Inside a computer the plugin cannot reach the filesystem, so the folder rides along as the session's working directory and the machine makes it; a computer that is not up yet fails the make rather than the folder.
- Every other plugin package holds its README's options table to `optionsSchema` in a `<package>-options.test.ts` (`documented()` against `declared()` in `computer-options.test.ts`). `packages/bot` has no such file, so its README's one `root` row is unchecked. No task in this plan names it, and the README it would guard was updated here, so the row still matches the schema by hand.
- The manifest offers `session` as a string, because a make links a session rather than unlinking one. `null` is an edit's body, and the form a client draws a *make* from has no use for it. It offers `owner` on the same footing, which a make may name and an edit may not move.

## Review, 2026-10-08

- Softov kept the narrowed empty prompt: an absent `prompt` opens a silent session, and a blank one is refused. Question: "plugin/37's builder now lets a plugin start a session with no first message, where task 03 called an empty prompt a mistake. Which rule holds?" Answer: "No prompt allowed".
- A named `workspace` has to be under the plugin's `root`, because the plugin makes the folder. Question: "Making a bot creates its workspace folder at any path the request body names. Limit it?" Answer: "Only under the plugin root". `workspaceFor` in `provider.ts` refuses another path with `-32602`; the README, BOTS.md and the make form say so.
