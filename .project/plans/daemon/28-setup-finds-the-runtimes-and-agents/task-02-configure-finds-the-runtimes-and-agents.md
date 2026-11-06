---
title: Configure finds the runtimes and agents
status: done
depends: [task-01-the-sdk-lists-the-known-agents.md]
layer: server
refs:
  - "[code://packages/server/src/commands/configure.ts#L42-L46](../../../../packages/server/src/commands/configure.ts#L42-L46) - `BACKENDS`: the three native backends, whose questions stay"
  - "[code://packages/server/src/commands/configure.ts#L141-L148](../../../../packages/server/src/commands/configure.ts#L141-L148) - the backend loop that the agent questions follow"
  - "[code://packages/server/src/commands/configure.ts#L233-L239](../../../../packages/server/src/commands/configure.ts#L233-L239) - `installPlugins`, which installs `@ahpd/agent-acp` with the backends"
  - "[code://packages/server/src/install.ts#L338](../../../../packages/server/src/install.ts#L338) - `enableNames` keeps an entry that is already named, so the preset options survive the install"
  - "[code://packages/sdk/src/listen.ts#L27](../../../../packages/sdk/src/listen.ts#L27) - `runtime`: which runtime this process is on"
  - "[code://packages/server/package.json#L38-L40](../../../../packages/server/package.json#L38-L40) - `engines.node` is `>=22.1`"
  - "[code://packages/server/test/server-configure.test.ts#L103](../../../../packages/server/test/server-configure.test.ts#L103) - the fake terminal and runner that the new cases use"
  - "[code://docs/server/CONFIGURE.md#L3-L18](../../../../docs/server/CONFIGURE.md#L3-L18) - the First setup section and its answers table"
  - "[plan: daemon/29](../29-ahpd-doctor-says-what-is-wrong/plan.md) - its Agents check calls the same PATH lookup"
---

## Objective

`ahpd configure` prints one line each for Node, Bun and Deno, and a table of the agents that it found on PATH.
It asks one question per agent found, writes the ones taken under the `presets` of `@ahpd/agent-acp`, and lists the missing agents with their install lines.
The table shows each agent's version, and a `claude` or `pi` found on PATH shows under "Also found".

## Files

- `CREATE: packages/server/src/onpath.ts` - `onPath(command, path)`: the full path of a command on PATH, or nothing.
- `CREATE: packages/server/src/found.ts` - `findRuntimes` and `findAgents`, and the lines that configure prints from them.
- `UPDATE: packages/server/src/commands/configure.ts:42-46` - the stale comment above `BACKENDS` that says ACP has no presets.
- `UPDATE: packages/server/src/commands/configure.ts:141-148` - after the backend loop, the runtime lines, the agent table, one question per agent found, and the missing list.
- `UPDATE: packages/server/src/commands/configure.ts:233-239` - `@ahpd/agent-acp` joins `missing` when an agent was taken and the package is not installed.
- `CREATE: packages/server/test/onpath.test.ts` - the lookup in a temporary folder.
- `UPDATE: packages/server/test/server-configure.test.ts` - the new questions and what they write.
- `UPDATE: docs/server/CONFIGURE.md:3-18` - the agent questions and the missing list.

## Steps

1. Write the tests first, with a temporary folder of stub commands as PATH.
2. Write `onPath` in its own file, so that daemon/29 can import it.
3. In `onPath`, split PATH on `delimiter`, and on Windows try each `PATHEXT` extension.
4. Add `path` to `ConfigureOptions`, with `process.env.PATH` as the default, so a test gives its own folder.
5. Write `findRuntimes`, which gives the path and the version of `node`, `bun` and `deno`.
6. Get each version from `--version` through `options.run`.
7. Say that Node runs ahpd from 22.1, and that Bun and Deno run it.
8. On the Deno line, say that Deno needs each plugin as an `npm:` spec.
9. Write `findAgents`: for each row of `knownAgents`, the path from `onPath(row.command)`, or nothing.
10. In `findAgents`, read the person's agent-acp presets, and let a preset's `command`, `install` and `page` win over the row.
11. For each agent found, run `<path> --version` through `options.run`, with a limit of 3 seconds.
12. Show the first line of that output as the version, and the path only when it fails or times out.
13. Print the runtime lines and the agent table after the backend questions, with the plugin that runs each agent.
14. Under "Also found", print the path and version of `claude` and `pi` when they are on PATH.
15. Keep the three backend questions as they are, whatever "Also found" shows.
16. Ask `<name>?` for each agent found that is not already in `presets`, with Yes as the default.
17. Show an agent already in `presets` as configured, and ask nothing about it.
18. Write each agent taken as `presets.<id>: {}` in the `@ahpd/agent-acp` entry, as an object entry, and keep its other options.
19. Add `@ahpd/agent-acp` to `missing` when the package is not there, so `installPlugins` installs it after the write.
20. After the questions, print each agent not found with `installLine` for this system, or its page.
21. Ask nothing about an agent not found.
22. Ask no agent question and print no table when no terminal is open.
23. Update CONFIGURE.md, then run `pnpm boundary` and the server tests.
24. Set this task and the plan's Tasks list to `implemented`.

## Validation

- `onpath.test.ts`: `onPath` finds a command in the second PATH folder, and gives nothing for a missing one.
- `onpath.test.ts`: on POSIX, `onPath` skips a file that does not have the run bit.
- `onpath.test.ts`: on Windows, `gemini` finds `gemini.cmd` through `PATHEXT`.
- `server-configure.test.ts`: with a `gemini` stub on PATH, Enter writes `{ name: '@ahpd/agent-acp', options: { presets: { gemini: {} } } }` and installs `@ahpd/agent-acp`.
- `server-configure.test.ts`: No to Gemini writes no agent-acp entry and installs nothing for it.
- `server-configure.test.ts`: configure shows a preset that the file has as configured, asks nothing about it, and keeps its options.
- `server-configure.test.ts`: with an empty PATH, the output lists each agent with its install line.
- `server-configure.test.ts`: with an empty PATH, the questions are the ones of today.
- `server-configure.test.ts`: the runtime lines name the versions from the fake runner.
- `server-configure.test.ts`: the agent table shows the version that the fake runner gives for `gemini --version`.
- `server-configure.test.ts`: when `gemini --version` fails or passes 3 seconds, the row shows the path and no version.
- `server-configure.test.ts`: with `claude` on PATH, "Also found" shows it, and the backend questions are the ones of today.
- `server-configure.test.ts`: a preset that writes `install` for a missing agent shows that line, not the row's line.
- `server-configure.test.ts`: on `win32`, a row with only a `linux` line and a page shows the page.
- `server-configure.test.ts`: the Node line for Node 20 says that ahpd does not run on it.
- `pnpm boundary` and `pnpm test` pass.
- By hand: on a machine with `gemini` on PATH, configure offers Gemini, and `ahpd` then lists the Gemini agent.

## Resume

- **Done so far:** steps 1 to 23, 2026-10-19. `packages/server/src/onpath.ts` answers the full path of a command, with `PATHEXT` on Windows and the run bit elsewhere. `packages/server/src/found.ts` holds `findRuntimes`, `findAgents`, `findAlso` and the line builders. The version probe goes through `Runner` with `{ timeoutMs: 3000, capture: true }`. A failure or timeout shows the path. `configure.ts` prints the runtime lines and the agent table after the backend questions. It asks one question per found agent not already in `presets`, and a Yes writes `presets.<id>: {}` with the entry's other options kept. It prints "Also found" for `claude` and `pi`, and lists the missing agents with `installLine` or the page. `@ahpd/agent-acp` joins `missing` when an agent was taken. The new tests pass, and so do `pnpm boundary`, `pnpm -s build` and `pnpm -s typecheck`.
- **Next action:** none. The by-hand check with `gemini` on PATH is left for a machine that has it.
- **Open questions:** none.
- **Watch out for:** `Runner` gained optional `RunOptions` (`timeoutMs`, `capture`) in `install.ts`, which the task's file list did not name. Without them `--version` could neither be read nor stopped. In a test, `configure` must be given `path`. The real `process.env.PATH` can hold an agent and add a question the case did not answer.
