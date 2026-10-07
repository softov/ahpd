---
title: An ACP agent in a folder nobody trusted - implemented
date: 2026-10-06
refs:
  - git://fb1f022
  - "[code://packages/agent-acp/src/session/opening.ts#L291-L304](../../../../packages/agent-acp/src/session/opening.ts#L291-L304) - the refusal, before anything is placed or connected"
  - "[code://packages/agent-acp/src/presets.ts#L47-L55](../../../../packages/agent-acp/src/presets.ts#L47-L55) - `honoursTrust` on `AcpPreset`"
  - "[code://packages/agent-acp/src/types.ts#L115-L125](../../../../packages/agent-acp/src/types.ts#L115-L125) - the same flag on `AcpOptions`"
  - "[code://packages/agent-acp/src/plugin.ts#L71](../../../../packages/agent-acp/src/plugin.ts#L71) - the schema property, and `PER_PRESET`"
  - "[code://packages/agent-acp/test/agent-acp-trust.test.ts](../../../../packages/agent-acp/test/agent-acp-trust.test.ts) - the three cases"
  - "[code://packages/agent-acp/test/people.ts](../../../../packages/agent-acp/test/people.ts) - the people a host needs for a session to have an owner"
---

An ACP session in a folder the host did not vouch for is refused before anything is placed or spawned. The refusal names the folder and `honoursTrust`, rather than handing an external agent a folder it will load its own hooks and settings from. A preset that says `honoursTrust: true` starts as it did, in any folder, because its agent asks the question itself. A folder the host vouched for starts in both. An absent `Start.trusted` is the host having said nothing, which is the same answer as untrusted. No shipped row sets the flag.

## What was built

- [`code://packages/agent-acp/src/session/opening.ts`](../../../../packages/agent-acp/src/session/opening.ts) - the check is the first thing in `open()`'s async body, ahead of `placed()` and `connectAcp`. The point is that the agent never starts in such a folder. A refusal after the placement would already have made the machine or copied the part the session asked for. The sentence names the folder, says why, and names the two ways out.
- [`code://packages/agent-acp/src/presets.ts`](../../../../packages/agent-acp/src/presets.ts) - `honoursTrust?: boolean` on `AcpPreset`, with the doc saying what an absent value means and what a row that sets it is claiming about its agent. No shipped row sets it.
- [`code://packages/agent-acp/src/types.ts`](../../../../packages/agent-acp/src/types.ts) - the same flag on `AcpOptions`, which is what `open()` reads.
- [`code://packages/agent-acp/src/plugin.ts`](../../../../packages/agent-acp/src/plugin.ts) - the property in `optionsSchema.presets.additionalProperties`. `honoursTrust` is in `PER_PRESET`, so the host refuses a load-level one above a preset. `presetOf` reads it from the preset, with the plugin-wide value behind it, spread only when it is defined.
- [`code://packages/agent-acp/test/agent-acp-trust.test.ts`](../../../../packages/agent-acp/test/agent-acp-trust.test.ts) - new: the session is refused and nothing spawns, since the fixture's log file is never created. The same folder starts under `honoursTrust: true`, and a vouched-for folder starts without it.
- [`code://packages/agent-acp/test/people.ts`](../../../../packages/agent-acp/test/people.ts) - new: `anyone()`, a `Users` directory for a host to have somebody, and `signIn(client)`. Before the review of 2026-10-06 a backend heard which folders are trusted only from a connection that owns the session. So a host with no people directory trusted nothing. The sender's push decides there now ([the decision](../../../decisions/the-sender-decides-on-a-host-with-no-people.md)). The host-driven files below still sign in, so they cover the host-with-people path. The no-people path is covered in `packages/sdk/test/host-trust.test.ts`.

## Verified

- Step 1 failed first: with the refusal disabled and everything else in place, `npx vitest run packages/agent-acp/test/agent-acp-trust.test.ts` was `Tests 1 failed | 2 passed (3)`. The failure was `expected undefined to contain <the folder>` on the sentence the client should have been sent. Nothing failed the session, because the agent started in the folder. Steps 2 and 3 passed before and after, which is what they are for.
- `npx tsc -b` clean.
- `pnpm boundary` clean, all eight packages "declared, none undeclared".
- `npx vitest run packages/agent-acp` - 14 files, 177 tests, all passed. The three new cases and the 174 that were there before.
- The work is uncommitted on `fb1f022`, as p1's is.

## Departures from the plan

- The plan names `packages/agent-acp/src/presets.ts` for the flag's home and the option a person's own preset takes. It also needed `types.ts` (what `open()` actually reads) and `plugin.ts` (the schema, `PER_PRESET`, and `presetOf`). That is how every other preset option in this package travels. The plan's ref list stops one file short of the path the value takes.
- The refusal comes out of `open()` as a `throw`. A client sees it as the failed turn or failed session it already handles, in the same place a missing `command` is reported.

## Tests that changed because the behaviour did

Nine files that already existed started ACP sessions through a host that pushed no `workspaceTrust`, which is a refusal now. Each was given the thing the case is actually about, and nothing else in them moved:

- `agent-acp-turn.test.ts`, `agent-acp-ports.test.ts`, `agent-acp-plugin.test.ts` - the hosts are given `users: anyone()`, each client signs in, and each window pushes `workspaceTrust`. The first two push `{ enabled: true, trustedUris: [uriOf(path)] }` for the folder the session is in. The plugin cases push `{ enabled: false }`, which is VS Code's "no untrusted folder here", because those cases name no folder.
- `agent-acp-blocks.test.ts`, `agent-acp-catalog.test.ts`, `agent-acp-usage.test.ts`, `agent-acp-signin.test.ts`, `agent-acp-failure.test.ts` and `agent-acp-machine.test.ts` are backend-level: they call `agent.create` themselves. So each harness passes `trusted: () => true` now, which stands for "the host vouched for the folder". That is not what those cases are about.
- `agent-acp-machine.test.ts` "reaches a disposable machine" was given `, 20_000` while the file was open. It makes two machines and asks how one of them runs a command, all of which are spawns of the fixture's own processes. Alone it takes about five seconds, which is vitest's default exactly. Beside this package's thirteen other files, one more than before, it timed out at 5000ms. With the budget it passed at 6469ms. Nothing about the case changed. `packages/computer/test/computer-uptime.test.ts` states its own budget for the same reason, and `fb1f022` is the commit that gave it one.

## Left for later

- none. Nothing this plan named is left; there is no `deferred.md`.
- The three host-driven files above needed people before a window's trust could reach a backend at all. A host with no people directory trusted nothing and refused every ACP session. The review of 2026-10-06 settled that: the sender's push decides there ([the decision](../../../decisions/the-sender-decides-on-a-host-with-no-people.md)). It was where trust is read rather than where it is refused, and the refusal above is right either way. The files keep their sign-in, so they now cover the host-with-people path.
