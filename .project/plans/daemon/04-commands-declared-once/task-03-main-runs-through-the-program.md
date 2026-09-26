---
title: main.ts runs through the terminal program
status: implemented
depends: [task-02-the-commands-are-declared.md]
layer: "server"
refs:
  - file:///github/cofold/packages/terminal/src/program.ts - `Program`
  - "[code://packages/server/src/main.ts](../../../../packages/server/src/main.ts) - the entry"
---

## Objective

`main.ts` hands `argv` to `@cofold/terminal`'s `Program` over the registry, and the hand-written parser and verb branches are gone.

## Files

- `UPDATE: packages/server/src/main.ts` - the entry, down to the program and the daemon's own run.

## Steps

1. Replace the parser and the verb branches with the program.
2. Keep `--stdio` from writing anything but frames to stdout.

## Validation

- Every test from task 01 passes unchanged.
- `ahpd --help`, `ahpd completion bash`, `ahpd status --json` by hand.

## Resume

Done: `main.ts` builds one `Program` over `cliRegistry()` and runs through `runEntry`; the hand-written parser and verb branches are gone.
The one compatibility seam is the word the foreground run is given when a line has no command (counted with `@cofold/commands`' own `tokenize`), and `-v` is mapped to `--version`.
`liveHelp` appends the foreground run's help to program help, so `ahpd --help` still shows every daemon flag.
`--help`, `plugin --help`, `completion bash` and `status --json` were run by hand; `--stdio` writes an empty stdout with stdin closed.
The task 01 cases pass unchanged.
Found in review, and fixed in later tasks: a global before `start` orphans the daemon (task 05), `-v` and `--help` are read in value position and the bare run's flags do not complete (task 09), and the help lost sentences and shows `ahpd run` (task 07).
