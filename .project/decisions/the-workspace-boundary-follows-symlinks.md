---
title: The workspace boundary is checked on real paths, with symlinks resolved
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/agent-cofold/src/session.ts#L43-L46](../../packages/agent-cofold/src/session.ts#L43-L46) - `insideDirectory`, a string comparison of resolved paths"
  - "file:///github/cofold/packages/tools/src/paths.ts - `resolveWithin`, the same check in `@cofold/tools`"
  - "file:///github/cofold/packages/papo/src/agent.ts - papo's `inside`, which is `resolveWithin(...).inside`"
---

## Context

`insideDirectory` in ahpd and `resolveWithin` in `@cofold/tools` both decide inside or outside by comparing `path.resolve` strings, so neither follows a symlink.
With `ws/link` pointing at a folder outside the workspace, `write_file link/pwn.txt` under `acceptEdits` is judged inside, runs without asking, and writes the file outside the workspace.

## Decision

Both checks resolve symlinks with `realpath` before comparing: ahpd's `insideDirectory` and cofold's `resolveWithin`.
Source: Softov, 2026-09-26, asked "Should `inside` resolve symlinks (`realpath`)? (a) Yes, in ahpd's `insideDirectory`. (b) Yes, in cofold's `resolveWithin`. (c) Accept the gap.": "yes, both".

## Consequences

A path that does not exist yet is judged by the real path of its nearest existing ancestor with the rest appended, so a new file under a symlinked folder is judged where it will land.
The workspace itself is compared by its real path, so a workspace opened through a symlink still contains its own files.
The cofold half is a change to `/github/cofold`, published before ahpd can take it; ahpd's half fixes ahpd's policy on its own.

## Options

- **Accept the gap.** A symlink in a project is common, and `acceptEdits` would keep writing through it without asking.
- **Only one side.** ahpd alone leaves papo and the memory folder check open; cofold alone leaves ahpd's policy open until a release.
