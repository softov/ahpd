---
title: The six stale places in the prose and the code match again
status: done
depends: []
layer: docs
refs:
  - code://packages/server/src/main.ts#L95-L98 - the `--path` USAGE row, which claims a directory not named there is refused
  - code://packages/server/src/main.ts#L151-L156 - the parse comment that explains the same fence
  - code://packages/server/src/main.ts#L109-L120 - the `--sessions`, `--wire` and `--version` rows that exist and are missing from the document
  - code://docs/DAEMON.md#L33-L46 - the options table to complete
  - code://docs/DAEMON.md#L63-L79 - the section that already says `--path` "is not a fence", which the other two must agree with
  - code://docs/AGENT.md#L118-L124 - the controls row, which names four setters that do not exist
  - code://packages/sdk/src/types/session.ts#L401 - `setConfig`, the only control setter
  - code://packages/sdk/src/host.ts#L4546-L4553 - the `resource*` comment to correct
  - code://packages/sdk/src/host.ts#L4837-L4905 - the served `resourceWrite`, `resourceDelete`, `resourceMkdir`, `resourceMove` and `resourceCopy`
  - code://packages/sdk/src/host.ts#L5140-L5147 - the `source` comment to correct
  - code://packages/sdk/src/host.ts#L5167-L5188 - where `fork` and `sideChat` are handled
  - code://packages/agent-claude/src/claude.ts#L125-L146 - the advertised permission modes to complete
  - code://packages/agent-claude/src/session.ts#L2190-L2208 - the accepted permission modes, six of them
  - code://test/conformance.test.ts#L663-L667 - the enum assertion that moves with the code
  - code://test/host.test.ts#L1747 - the working-mode assertion that moves with the code
  - git://24bb04c - the commit that removed the `--path` fence
  - npm://@anthropic-ai/claude-agent-sdk@^0.3.250 - `PermissionMode` has six members
---

## Objective

The six prose sites named in the plan match the code beside them again, with the permission-mode fix making the advertised list and the accepted list agree on six modes, and no other finding folded in.

## Files

- `UPDATE: packages/server/src/main.ts:95-98` - the `--path` USAGE row says where the catalogue looks and what the default is, and stops claiming a refusal.
- `UPDATE: packages/server/src/main.ts:151-156` - the parse comment loses the fence explanation.
- `UPDATE: docs/DAEMON.md:33-46` - the options table gains `--sessions <where>`, `--wire <file>` and `--version, -v`.
- `UPDATE: docs/AGENT.md:118-124` - the controls row names `setConfig(key, value)` and `settings()` and drops the four setters.
- `UPDATE: packages/sdk/src/host.ts:4546-4553` - the `resource*` comment says the write half is served behind `resourceRequest` and `-32009`.
- `UPDATE: packages/sdk/src/host.ts:5140-5147` - the `source` comment says `fork` and `sideChat` are served.
- `UPDATE: packages/agent-claude/src/claude.ts:125-146` - the advertised `permissionMode` enum, labels and descriptions gain `dontAsk`.
- `UPDATE: packages/agent-claude/src/session.ts:2190-2208` - the comment stops saying five values.
- `UPDATE: test/conformance.test.ts:663-667` - the expected enum gains `dontAsk`.
- `UPDATE: test/host.test.ts:1747` - the working-mode case also names `dontAsk`.

## Steps

1. `USAGE` in `main.ts`: change the `--path` row at 95 to 98 so it says the first path is the default and the catalogue is the union, matching `docs/DAEMON.md:74`, and remove the "refused rather than served" explanation from the parse comment at 151 to 156.
2. `docs/AGENT.md:122`: replace `setModel`, `setPermissionMode`, `setEffort` and `setOutputStyle` in the controls row with `setConfig(key, value)`, which `packages/sdk/src/types/session.ts:401` is the only setter for, and keep `settings()`.
3. `docs/DAEMON.md`: add the three missing rows to the options table at 33 to 46, taking the wording from `main.ts` USAGE at 109, 113 and 120 for `--sessions`, `--wire` and `--version`.
4. `packages/sdk/src/host.ts:4546-4553`: rewrite the `resource*` comment so it says the write half is served and gated by a `resourceRequest` grant, naming `-32009` and the served methods at 4837 to 4905.
5. `packages/sdk/src/host.ts:5140-5147`: rewrite the `source` comment so it says `fork` and `sideChat` are accepted, pointing at 5167 to 5188.
6. Permission modes: add `dontAsk` to the `permissionMode` enum at `claude.ts:130` with a label and a description, change the "five values" comment at `session.ts:2194` to six, and update `test/conformance.test.ts:665` and `test/host.test.ts:1747` so the advertised list and the accepted list agree.

## Validation

- `grep -n "is refused\|refused rather than served" packages/server/src/main.ts` returns no `--path` claim.
- `grep -n -- "--sessions\|--wire\|--version" docs/DAEMON.md` returns the three new rows.
- `grep -n "setModel\|setPermissionMode\|setEffort\|setOutputStyle" docs/AGENT.md` returns nothing.
- `grep -n "is not served" packages/sdk/src/host.ts` returns nothing for the two corrected comments.
- `grep -n "dontAsk" packages/agent-claude/src/claude.ts packages/agent-claude/src/session.ts test/conformance.test.ts test/host.test.ts` returns the four sites.
- `test/conformance.test.ts` and `test/host.test.ts` assert the six-mode enum and pass.
- `pnpm test` green; `pnpm typecheck` and `pnpm boundary` green.

## Resume

Done.
All six steps were taken against the current lines rather than the plan's numbers: the `--path` USAGE row and its parse comment lost the fence, the daemon options table gained `--sessions`, `--wire` and `--version`, the AGENT controls row names only `setConfig(key, value)` and `settings()`, the two host comments now say what the code serves, and the advertised permission-mode enum gained `dontAsk` with its label and description.
The two test assertions moved with the enum, and the permission-mode counts in the two comments beside them now say six.
`test/fixtures/wire.jsonl` was rewritten by `test/wire.test.ts` on the test run and carries the six-mode enum, which is a generated output and not a seventh finding.
