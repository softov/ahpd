---
title: The comments in this plan's code document
status: done
depends: [task-18-every-command-reaches-it-by-docker-exec.md]
layer: "sdk | computer"
refs:
  - "[code://packages/sdk/src/computers.ts#L4-L26](../../../../packages/sdk/src/computers.ts#L4-L26) - `refuseComputer`'s comment, \"exactly one of those today\" at :9"
  - "[code://packages/sdk/src/computers.ts#L34-L47](../../../../packages/sdk/src/computers.ts#L34-L47) - `computerSource`, \"`disposable:<profile>` today, `devcontainer://<folder>` after it\" at :38-39"
  - "[code://packages/sdk/src/computers.ts#L56-L62](../../../../packages/sdk/src/computers.ts#L56-L62) - `openComputer`, \"a disposable profile today and a folder's dev container after it\" at :60"
---

## Objective

The comments this plan touched say what each declaration is; history belongs in the decisions.

## Files

- `UPDATE: packages/sdk/src/computers.ts:9`, `:38-39`, `:60` - each names the sources and backends as they are, with no "today" and no "after it".
- `UPDATE: packages/computer/src/devcontainer.ts`, `packages/computer/src/runtime.ts`, `packages/computer/src/plugin.ts` - any comment from this plan that says what used to be, read after task 18 has rewritten the reach comments.

## Validation

- `rg -n "today|after it|used to|no longer" packages/sdk/src/computers.ts packages/computer/src` finds no comment that narrates.
- `pnpm typecheck` green.

## Resume

Implemented on 2026-10-03.

Files changed:

- `packages/sdk/src/computers.ts` - the three comments the task names. `refuseComputer` names `@ahpd/agent-acp` as the backend that honours the port, `computerSource` names `disposable:<profile>` and `devcontainer://<folder>` as the sources that are not an existing machine, and `openComputer` names a disposable profile and a folder's dev container as the two kinds of source it serves. None of the three says a thing is true only for now.
- `packages/computer/src/devcontainer.ts` - the module header says "every command in there" rather than "every command after it", which is the same sentence without the word that reads as history.
- `packages/computer/src/plugin.ts` - the `runtime` schema field says docker is the only runtime rather than the only one today; the uptime comment says a stretch is written whole once a machine has stopped rather than once it is no longer up.
- `packages/computer/src/runtime.ts` - the `profile` field no longer marks `host` as the only recipe read back today; the override config's comment says it is gone once the `up` answers; the name comment says a container carrying no such label keeps the name a listing reads for it, rather than a container made before the label existed.
- `packages/computer/src/provider.ts` - `stateOf`'s comment says `docker`'s status is a longer vocabulary than the three states rather than that it used to answer it.

Validation: `rg -n "today|after it|used to|no longer" packages/sdk/src/computers.ts packages/computer/src` finds one line, and it is not a comment - `plugin.ts:556`'s log line, `removed the disposable machine <id>, <n>ms after its last session`, which says when a machine was disposed of and is worded the way the message reads. `pnpm exec tsc --noEmit` green.

Notes and open questions:

- `packages/computer/src/provider.ts` is not in the task's Files list, and its comment is one no task in this plan wrote: `git diff` shows the change this plan made to that file is the two provider options and their three call sites. It is rewritten because the task's own Validation greps the whole of `packages/computer/src` and the sentence there narrated exactly as much as the ones the list names. Nothing else in that file changed.
- `runtime.ts:951` said "the CLI names a container after its folder", which is not history at all but does contain the substring `after it`. It now reads "for its folder", which is the same statement.
- No comment in `packages/computer/src` still describes the `devcontainer exec` route task 18 replaced: `rg -n "devcontainer exec" packages/computer/src` finds nothing.

### The fix turn of 2026-10-05

Comments cleaned up after this task: the `container/05-p1` task citations on `execArgv` (`devcontainer.ts`) and on the override config (`runtime.ts`), the task 13 citation in the fake Docker's `exec`, and two task citations in `computer-devcontainer.test.ts`; the `overrideOf` comment no longer narrates `--remote-env`; every comment citing the superseded decision `a-dev-container-is-made-by-the-dev-container-cli` (`devcontainer.ts`, `plugin.ts` twice, `runtime.ts`, `packages/sdk/src/types/containers.ts`, `packages/sdk/src/host/handshake.ts`) now cites `a-dev-container-is-reached-by-docker-exec`. The override comment also said a vault value was not written to the file, which the code does not do; it now says a vault value is among what it holds.
