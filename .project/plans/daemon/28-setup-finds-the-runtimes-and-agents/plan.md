---
title: Setup finds the runtimes and agents
domain: daemon
status: built
priority: medium
created: 2026-10-15
revalidated: 2026-10-19
refs:
  - "[code://packages/server/src/commands/configure.ts#L42-L46](../../../../packages/server/src/commands/configure.ts#L42-L46) - `BACKENDS`: configure asks about Claude, cofold and pi only"
  - "[code://packages/agent-acp/src/presets.ts#L85-L213](../../../../packages/agent-acp/src/presets.ts#L85-L213) - the ACP presets, each with the command it runs"
  - "[code://packages/server/src/plugins.ts#L111-L113](../../../../packages/server/src/plugins.ts#L111-L113) - the daemon already knows Deno's limits for plugins"
  - "[research: how one-line installers work](../../../research/one-line-installers.md) - what installers check before they install"
---

## Goal

`ahpd configure`, and the install script before it, report what this machine has: Node, Bun and Deno, and the agent CLIs that ahpd can run. Configure then offers each agent it found, so a person with Gemini or Codex on PATH gets it without reading the ACP page.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "BACKENDS" packages/server/src` - one list of three packages, in `configure.ts`.
- `rg -n "command:" packages/agent-acp/src/presets.ts` - 13 presets: codex, gemini, copilot, opencode, kilo, goose, pi, dsh, devin, cursor, amp, qwen, and the default.

### Runtime path

```
ahpd configure -> look up each command on PATH -> list what was found -> one question per agent found -> plugins and presets written to config.json
```

### Gaps

- Configure does not offer `@ahpd/agent-acp`, so an ACP agent is set up by hand.
- Nothing reports which runtimes are installed or their versions.
- `Not found: a list of the agent commands that the server can read - searched presets.ts exports in packages/server/src.`

## Answers

| What | Source | Task |
| --- | --- | --- |
| `@ahpd/sdk` exports the list as `knownAgents`, and `presets.ts` takes each row's `name` and `command` from it | Softov, 2026-10-19, chose the recommended answer for "Where should the list of known agents live, so that configure can show it?" - "knownAgents in sdk" | 01 |
| Each row keeps its install lines by hand, per system, as `install: { all, linux, darwin, win32 }`, each optional, and a `page` with the vendor's install page for a system with no line | Softov, 2026-10-19, to "How does configure tell a person to install an agent it did not find?" - "a line per agent", and he asked for "commands like install on windows, on mac os, and linux" | 01 |
| A person fixes a row in `config.json`: the preset of `@ahpd/agent-acp` gains `install` and `page`, and a person's value wins over the row, as the run fields do today | Softov, 2026-10-19, to "Who makes the fix to an agent's row without a code change?" - "person, in config" | 01, 02 |
| Configure shows a `claude` or `pi` found on PATH under "Also found", as information, and the backend questions stay as they are | Softov, 2026-10-19, to "When `claude` or `pi` is on PATH, should configure change its backend questions?" - "Show as information" | 02 |
| Configure runs `<command> --version` on each agent it found, with a limit of 3 seconds, and shows the first line; a failure or a timeout shows the path only | Softov, 2026-10-19, to "Should configure show the version of each agent it finds?" - "Run --version" | 02 |
| Configure shows an agent already in `presets` as configured and asks nothing about it | Softov, 2026-10-19, chose the recommended answer for "An agent that already has a preset in config.json. What does configure show for it?" | 02 |
| Task 03 changes `install.ps1` the same way as `install.sh` | Softov, 2026-10-19, chose the recommended answer for "Does task 03 change install.ps1 the same way?" | 03 |
| Configure lists the agents that are not installed, with the command to install each, and asks no question for them | Softov, 2026-10-15, to "Does ahpd configure also list agents that are not installed?" - "List with install command" | - |

## Proposed architecture

- **Data flow** - `@ahpd/sdk` exports each agent's id, name, command, install lines and install page, and `@ahpd/agent-acp` takes its names and commands from it. Configure reads the person's presets over the rows, then looks up each command on PATH.
  It prints a table: found, the version from `--version`, and configured or not. `claude` and `pi` show under "Also found".
- **Questions** - one per agent found, with Enter taking it. An ACP agent writes `@ahpd/agent-acp` with that preset under `presets`.
- **Missing agents** - a list after the questions, each with the install line for this system, or the install page.
- **Runtimes** - one line each for Node, Bun and Deno, with the version, and whether ahpd runs on it.
- **The install script** - it prints the same runtime lines before it installs, so a person sees why it stopped.
- **Source-of-truth files** - [`code://packages/server/src/commands/configure.ts`](../../../../packages/server/src/commands/configure.ts)

## Tasks

| # | Task | Status |
| --- | --- | --- |
| 01 | [The sdk lists the known agents](task-01-the-sdk-lists-the-known-agents.md) | implemented |
| 02 | [Configure finds the runtimes and agents](task-02-configure-finds-the-runtimes-and-agents.md) | implemented |
| 03 | [The install script prints the runtime lines](task-03-the-install-script-prints-the-runtime-lines.md) | implemented |

Task 01 moves from agent-acp to the sdk, because `pnpm boundary` does not let `@ahpd/server` import `@ahpd/agent-acp`.

## Risks and tradeoffs

- A command on PATH may not be the agent - Configure asks before it writes, and a wrong command fails that agent's turns only.
- The server imports a backend - It reads a list of names and commands, not the backend; `pnpm boundary` decides where the list lives.
- A new ACP agent needs a code change before configure lists it - A person's preset with a `command` runs it. Configure offers only the rows in `knownAgents`. Softov, 2026-10-19: "code will need to be changed to add the new one... but its acceptable for now."

## Resume state

- **Done so far:** the proposal, 2026-10-15. The tasks and the answers, 2026-10-19. Tasks 01 and 02 were implemented on 2026-10-19. The sdk lists the known agents with their install lines. Configure finds the runtimes and agents, asks about each agent it found, and lists the missing ones. Task 03 was implemented on 2026-10-19: both install scripts print the Node, Bun and Deno lines before the runtime check, and INSTALL.md names them.
- **Next action:** none. The plan is built, and `implemented.md` says what exists.
- **Open questions:** none.
- **Watch out for:** [daemon/29](../29-ahpd-doctor-says-what-is-wrong/plan.md) uses the PATH lookup, so keep it a function of its own. `codex` has no ACP mode; its preset runs `codex-acp`. Look up the preset's command, not the product name. The version probe needs `Runner` to capture stdout and kill after 3 seconds; both are optional arguments on the runner, added in task 02.

## Final verification checklist

- [ ] On a machine with `gemini` on PATH, configure offers Gemini and writes the preset.
