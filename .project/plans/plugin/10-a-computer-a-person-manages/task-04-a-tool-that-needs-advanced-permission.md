---
title: A tool that needs advanced permission waits for the host
status: done
depends: []
layer: packages/sdk, packages/server, packages/computer
refs:
  - "[code://packages/sdk/src/types/host.ts#L243-L262](../../../../packages/sdk/src/types/host.ts#L243-L262) - `HostTool`, where the claim goes beside `effects`"
  - "[code://packages/sdk/src/types/host.ts#L177-L186](../../../../packages/sdk/src/types/host.ts#L177-L186) - `HostOptions.tools`"
  - "[code://packages/sdk/src/host.ts#L3576](../../../../packages/sdk/src/host.ts#L3576) - `contributing`, the set a session is offered"
  - "[code://packages/sdk/src/host.ts#L3606-L3620](../../../../packages/sdk/src/host.ts#L3606-L3620) - `toolDefinitions`, what a session reports"
  - "[code://packages/sdk/src/host.ts#L3822-L3845](../../../../packages/sdk/src/host.ts#L3822-L3845) - `boundTools`, where a call is made"
  - "[code://packages/computer/src/tools.ts#L34-L132](../../../../packages/computer/src/tools.ts#L34-L132) - the three tools that declare it"
  - "[code://packages/sdk/src/tools.ts](../../../../packages/sdk/src/tools.ts) - `hostTools()`, which declares nothing and is untouched"
  - "[code://packages/server/src/config.ts](../../../../packages/server/src/config.ts) - the daemon key"
  - "[code://test/host.test.ts](../../../../test/host.test.ts) - where the offered-set cases go"
---

## Objective

`HostTool` has `advancedPermission?: boolean`, a tool that declares it is absent from every session unless the host permits advanced tools, `HostOptions.advancedTools` is that permission and defaults false, the daemon reads it from `advancedTools` or `--advanced-tools`, and the computer's three tools declare it while the reference twelve declare nothing and are untouched.

## Files

- `UPDATE: packages/sdk/src/types/host.ts` - `HostTool.advancedPermission?`, documented beside `effects`, and `HostOptions.advancedTools?`.
- `UPDATE: packages/sdk/src/host.ts` - the offered set is derived through one filter, applied where `contributing` is initialised and where `setTools` replaces it, so a withheld tool is neither reported in `serverTools` nor bound for a call.
- `UPDATE: packages/computer/src/tools.ts` - `advancedPermission: true` on `request_disposable_computer`, `release_computer` and `computer_exec`.
- `UPDATE: packages/server/src/config.ts` - `advancedTools?: boolean`, documented beside `trustToken`.
- `UPDATE: packages/server/src/main.ts` - `Options.advancedTools` false, `--advanced-tools`, the file merge, the usage line, and one startup line.
- `UPDATE: test/host.test.ts` - a marked tool absent without the permission and present with it; an unmarked tool present either way.
- `UPDATE: test/daemon.test.ts` - the key and the flag.
- `UPDATE: packages/sdk/README.md`, `docs/PLUGINS.md`, `docs/DAEMON.md` - the field, the key and the contract.

## Steps

1. Add the two fields, and say in the field's comment that it is the tool's claim and the host's permission that decides.
2. Filter once, in the function that answers the offered set, so both the reported definitions and the bound tools see the same answer and a later `setTools` is filtered too.
3. Add the daemon key and flag, defaulting false, and merge the file under the flag the way every other key does.
4. Mark the computer's three tools, which is the only marking in the tree.
5. Report the answer once at startup, so an operator can see whether advanced tools are offered.
6. Write the contract down for a plugin author: what declaring it means, and that a host that does not permit it never offers the tool.

## Validation

- `test/host.test.ts` - with `advancedTools` absent, a marked tool is not in `SessionState.serverTools` and a call to it does not run; with it true, the tool is reported and runs. An unmarked tool is reported either way, and `hostTools()` is unaffected.
- `test/computer.test.ts` or `test/computer-plugin.test.ts` - the three computer tools carry the field.
- `test/daemon.test.ts` - `advancedTools` defaults false, `--advanced-tools` sets it, and the file sets it.
- `pnpm test`, `pnpm typecheck` and `pnpm boundary` green.

## Resume

Not started.
The reference twelve stay unmarked on purpose: the question is not who contributed a tool but what a tool does, and only the computer's three answer "more than a session's ordinary work".
