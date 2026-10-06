---
title: Every file URI the host reads is decoded
status: done
depends: [task-04-one-file-uri-reader-and-one-writer.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/sessionmethods.ts#L234](../../../../packages/sdk/src/host/sessionmethods.ts#L234) - one of five strips in this file (234, 490, 680, 793, 893)"
  - "[code://packages/sdk/src/host/chatactions.ts#L180](../../../../packages/sdk/src/host/chatactions.ts#L180) - one of three (180, 339, 747)"
  - "[code://packages/sdk/src/host/terminals.ts#L266](../../../../packages/sdk/src/host/terminals.ts#L266) - a terminal's `cwd`"
  - "[code://packages/sdk/src/host/lifecycle.ts#L711](../../../../packages/sdk/src/host/lifecycle.ts#L711) - a session's first working directory"
  - "[code://packages/sdk/src/host/tooling.ts#L325](../../../../packages/sdk/src/host/tooling.ts#L325) - a moving chat's directory"
  - "[code://packages/sdk/src/host/vscodemethods.ts#L242](../../../../packages/sdk/src/host/vscodemethods.ts#L242) - a scope"
  - "[code://packages/sdk/src/host/changesets.ts#L39](../../../../packages/sdk/src/host/changesets.ts#L39) - a changeset's directory"
  - "[code://packages/sdk/src/host/facts.ts#L241](../../../../packages/sdk/src/host/facts.ts#L241) - a strip by slicing"
  - "[code://packages/sdk/src/automations.ts#L170](../../../../packages/sdk/src/automations.ts#L170) - an automation's working directory"
  - "[code://packages/sdk/src/sessiontools.ts#L158](../../../../packages/sdk/src/sessiontools.ts#L158) - `bare`, which strips and lowercases"
  - "[code://packages/sdk/src/sessiontools.ts#L297-L298](../../../../packages/sdk/src/sessiontools.ts#L297-L298) - a third `pathOf`, by slicing"
  - "[code://packages/sdk/src/terminals.ts#L122-L130](../../../../packages/sdk/src/terminals.ts#L122-L130) - a shell's OSC 7, read and sent on as `file://${path}`"
---

## Objective

Every place the host turns a `file:` URI into a path reads it through `localPath`, and every place it turns a path it read that way back into a URI uses `uriOf`, so a folder named `my dir` is `my dir` everywhere.

## Files

- `UPDATE: packages/sdk/src/host/sessionmethods.ts:234,490,680,793,893` - `localPath(...)` for each strip.
- `UPDATE: packages/sdk/src/host/chatactions.ts:180,339,747` - the same.
- `UPDATE: packages/sdk/src/host/lifecycle.ts:711`, `host/tooling.ts:325`, `host/vscodemethods.ts:242`, `host/terminals.ts:266`, `host/changesets.ts:39`, `host/facts.ts:241` - the same; `vscodemethods.ts` keeps its trailing-slash trim.
- `UPDATE: packages/sdk/src/automations.ts:170` - the same.
- `UPDATE: packages/sdk/src/sessiontools.ts:158,297-298` - `bare` decodes before it trims and lowercases; `pathOf` decodes before it trims.
- `UPDATE: packages/sdk/src/terminals.ts:126-129` - the OSC 7 path is `localPath(body)` and the emitted `cwd` is `uriOf(path)`.
- `UPDATE: packages/sdk/test/host-terminals.test.ts`, `packages/sdk/test/sessiontools.test.ts` - the cases below.

## Steps

1. Replace each strip one for one; nothing else on those lines moves.
2. Where a path read this way is turned back into a URI on the same line or the next, use `uriOf`.
3. `rg -nF "replace(/^file:" packages/sdk/src` and `rg -n "'file://'.length" packages/sdk/src` both find nothing when done.

## Validation

- Written first and seen failing (the shell starts in `/tmp/<dir>/my%20dir`, which does not exist): in `host-terminals.test.ts`, `createTerminal` with `cwd: uriOf('<tmp>/my dir')` starts in `<tmp>/my dir`.
- Written first and seen failing: in `sessiontools.test.ts`, beside `matches a workspace by project name, project URI, or directory` (line 122), an encoded URI matches a session whose working directory has a space.
- Written first and seen failing: an OSC 7 of `file://host/tmp/my%20dir` emits `terminal/cwdChanged` with `cwd` `file:///tmp/my%20dir` and the terminal's held directory is `/tmp/my dir`.
- The rest of `packages/sdk` stays green.
- `pnpm exec tsc --noEmit`, `pnpm test packages/sdk`.

## Resume
