---
title: The agents build every file URI with uriOf
status: done
depends: [task-02-the-sdk-builds-every-file-uri-with-uri-of.md]
layer: "agent-claude, agent-pi, agent-acp, agent-cofold"
refs:
  - "[code://packages/agent-claude/src/session.ts#L152](../../../../packages/agent-claude/src/session.ts#L152) - `workingDirectories`, unencoded, also at 163 and 209"
  - "[code://packages/agent-pi/src/session.ts#L966](../../../../packages/agent-pi/src/session.ts#L966) - the same, also at 975"
  - "[code://packages/agent-acp/src/session.ts#L184](../../../../packages/agent-acp/src/session.ts#L184) - the same, also at 194"
  - "[code://packages/agent-cofold/src/session.ts#L249](../../../../packages/agent-cofold/src/session.ts#L249) - the same, also at 259"
---

## Objective

Every `file:` URI an agent sends is the sdk's `uriOf(path)`, so the host reads back the folder the agent works in.

## Files

- `UPDATE: packages/agent-claude/src/session.ts:152,163,209`, `packages/agent-claude/src/catalog.ts:30`, `packages/agent-claude/src/session/customizations.ts:55,198` - `uriOf`.
- `UPDATE: packages/agent-pi/src/session.ts:966,975`, `packages/agent-pi/src/catalog.ts:172,185` - `uriOf`.
- `UPDATE: packages/agent-acp/src/session.ts:184,194`, `packages/agent-acp/src/catalog.ts:83,101`, `packages/agent-acp/src/mapping.ts:299` - `uriOf`.
- `UPDATE: packages/agent-cofold/src/session.ts:249,259`, `packages/agent-cofold/src/agent.ts:763` - `uriOf`.
- `UPDATE: packages/agent-*/package.json` - the sdk peer range is the version that exports `uriOf`.
- Today each is `` `file://${dir}` ``: a Claude session in `~/src/C#/app` reports `file:///home/u/src/C#/app`, the host reads `~/src/C`, and `lifecycle.ts:731` restarts it there.
- `UPDATE: packages/agent-claude/test/`, `packages/agent-pi/test/`, `packages/agent-acp/test/`, `packages/agent-cofold/test/` - one case each, below.

## Steps

1. Failing case first, per agent: a session started in a folder named `C#` with a space in it reports `workingDirectories` equal to `[uriOf(folder)]`. Each fails today.
2. Replace each builder one for one; `agent-claude/src/input.ts:186` encodes on its own and is left.
3. `rg -n '\`file://\$\{' packages/agent-*/src` finds only `input.ts:186`.

## Validation

- Each agent's case fails on `e1c4ccc` and passes after.
- `pnpm exec vitest run packages/agent-claude packages/agent-pi packages/agent-acp packages/agent-cofold`, `pnpm boundary`.

## Resume

Was `blocked` 2026-10-06 on `packages/agent-*/package.json` and on nothing else; Softov answered the question the same day, and the range and the eight versions moved together.

Done and green: one failing case per agent, then every builder replaced. `packages/agent-claude/test/uris.test.ts` (new), a case in `packages/agent-pi/test/agent-pi.test.ts`, one in `packages/agent-acp/test/agent-acp-catalog.test.ts` and one in `packages/agent-cofold/test/agent-cofold-store.test.ts`, each a session in a folder called `C# a b` reporting `workingDirectories` `[uriOf(where)]`; all four failed before the replacement with `file:///…/C# a b` against `file:///…/C%23%20a%20b`. Every site in the Files list is `uriOf` now, and `rg -n '\`file://\$\{' packages/agent-*/src` finds only `agent-claude/src/input.ts:186`.

Softov, 2026-10-06, answering "what is the next published workspace version?": 0.10.0. So the four agents' `peerDependencies["@ahpd/sdk"]` are `>=0.10` - the first release that exports `uriOf`, which 0.9.0 does not - and all eight workspace packages moved to 0.10.0 in the same change, because `.github/workflows/release.yml` says "versions move together. A tag that disagrees with any of them publishes a version nobody asked for".

The bump moved three things that read a range rather than name one, and they had to move with it: `packages/server/test/fixtures/plugin-hello` and `plugin-alike` went from `^0.9.0` to `^0.10.0`, since a caret on a `0.x` version stops at the next minor and the daemon beside them is 0.10.0 now; `packages/server/test/fixtures/plugin-incompatible` went from `^0.10.0` to `^0.11.0`, since a range the current daemon does satisfy is a fixture that loads when the test needs it refused; and the two cases that assert those ranges by name - `plugin-compat.test.ts:65` and `plugin-list.test.ts:113` - moved with it.

`packages/server/test/plugin-compat.test.ts`'s floor table is where the four agents' range is asserted: they are `>=0.10` there with the computer at `>=0.9` and the tunnel at `>=0.8`, and its last line asks `satisfies(sdkVersion(), floor)` rather than `satisfies('0.9.0', floor)`, so the assertion is the real one - this workspace's own sdk satisfies every floor on the list - and it moves with the next bump instead of pinning a number.

`packages/computer/package.json` (`>=0.9`) and `packages/tunnel-devtunnel/package.json` (`>=0.8`) were left as they are: neither imports `uriOf`, so 0.9.0 and 0.8.0 are still honest floors for them, and the table above says so.

Gates: `npx tsc -b` clean; `npm run boundary` clean, 8 packages, none undeclared; `npx vitest run packages/agent-claude packages/agent-pi packages/agent-acp packages/agent-cofold` 61 files and 722 tests passed; `npx vitest run packages/server` 38 files and 732 tests passed; `npx vitest run packages/sdk` 106 files and 1489 tests passed. `packages/sdk/test/nested-proxy.test.ts`'s "a nested session is listed after the outer host restarts" failed once under the whole-suite load, counting one ask more than it expected, and passes alone and on the next full run - a flake in a test that counts calls over a port, and not this change's.

No tag and no publish: `git tag` is not run here, and the manifests are the claim until somebody tags `v0.10.0`.
