---
title: Agents run from their parts and keep their own state, and the host's binary and home become opt-ins
domain: container
status: planned
priority: high
created: 2026-09-26
revalidated: 2026-10-03
requires:
  - plans/container/05-an-agent-in-a-machine-p2-an-acp-agent-says-what-its-machine-needs/plan.md
  - plans/container/05-an-agent-in-a-machine-p4-a-part-is-mounted-into-a-machine/plan.md
  - plans/container/05-an-agent-in-a-machine-p6-an-agents-configuration-lives-in-a-volume/plan.md
  - plans/claude/15-one-load-and-each-preset-is-a-variant/plan.md
  - plans/plugin/15-an-agent-says-what-a-machine-needs/plan.md
  - plans/container/05-an-agent-in-a-machine-p3-parts-are-built-from-one-versions-file/plan.md
  - plans/container/04-a-cofold-session-in-a-computer/plan.md
  - plans/acp/05-presets/plan.md
changes: []
creates: []
decisions:
  - decisions/a-nested-host-is-used-only-where-a-command-cannot-reach-the-agent.md
  - decisions/a-part-is-mounted-from-its-image-and-a-volume-is-the-fallback.md
  - decisions/a-plugin-loads-once-and-each-preset-is-a-variant.md
  - decisions/cofold-config-reaches-a-machine-by-a-path-variable.md
refs:
  - "[code://packages/agent-claude/src/claude.ts#L373-L398](../../../../packages/agent-claude/src/claude.ts#L373-L398) - Claude's needs: config dir, `.claude.json`, and the host's binary"
  - "[code://packages/agent-claude/src/claude.ts#L390-L396](../../../../packages/agent-claude/src/claude.ts#L390-L396) - the host binary mount, made whatever the options say"
  - "[code://packages/agent-claude/src/claude.ts#L78-L96](../../../../packages/agent-claude/src/claude.ts#L78-L96) - `computerExecutable`, the CLI's path inside a machine, and `computerConfigDir`"
  - "[code://packages/agent-claude/src/claude.ts#L129-L130](../../../../packages/agent-claude/src/claude.ts#L129-L130) - both read, `claude` and `/ahpd/claude` by default"
  - "[code://packages/agent-claude/src/claude.ts#L15-L29](../../../../packages/agent-claude/src/claude.ts#L15-L29) - `claudeExecutablePath`, the host binary"
  - "[code://packages/agent-claude/src/plugin.ts#L136-L152](../../../../packages/agent-claude/src/plugin.ts#L136-L152) - the options every variant of one load shares, `computerExecutable` and `computerConfigDir` among them"
  - "[code://packages/agent-claude/src/session.ts#L2201-L2207](../../../../packages/agent-claude/src/session.ts#L2201-L2207) - the env a CLI in a machine gets: the daemon's `CLAUDE_*` and `ANTHROPIC_*`"
  - "[code://packages/agent-claude/src/session.ts#L2252-L2253](../../../../packages/agent-claude/src/session.ts#L2252-L2253) - a variant's `env` laid after it, which replaces that filtered env with the daemon's whole one"
  - "[code://packages/agent-cofold/src/agent.ts#L561-L572](../../../../packages/agent-cofold/src/agent.ts#L561-L572) - cofold's needs: its config file at the host's own path"
  - "[code://packages/agent-cofold/src/agent.ts#L640-L646](../../../../packages/agent-cofold/src/agent.ts#L640-L646) - cofold's `runsNested`"
  - "[code://packages/agent-pi/src/agent.ts#L39-L156](../../../../packages/agent-pi/src/agent.ts#L39-L156) - `piAgent`: no `runsNested`, no `machine()`, so a pi session on a computer is refused today"
  - "[code://packages/sdk/src/host.ts#L5321-L5330](../../../../packages/sdk/src/host.ts#L5321-L5330) - the host asks the session's own provider for `machine()`, so each variant answers for itself"
  - "[code://packages/computer/src/plugin.ts#L43](../../../../packages/computer/src/plugin.ts#L43) - `host: ['ahpd']`, found on the machine's `PATH`"
  - "[code://packages/computer/src/manifest.ts#L64-L73](../../../../packages/computer/src/manifest.ts#L64-L73) - a profile's `host`"
---

## Goal

Claude, each ACP agent with a preset, and the nested hosts that cofold and pi run in, run from their parts, so a machine made from any glibc image runs them with nothing installed and nothing of the host's binaries mounted.
Each of them keeps its configuration in a state volume seeded from a few host files, and signs in with a secret that does not refresh.
Mounting the host's `claude` and the host's `~/.claude` stay, as options a person turns on.
Each preset is a variant registered as its own agent, so each answers its own `machine()`, and a Claude variant pointed at another endpoint gets its own environment in its machine and not the daemon's.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg "computerExecutable" packages/agent-claude/src` - it is the CLI's path inside a machine (`claude.ts:86`, read at `claude.ts:129`), so a value `"host"` would be read as a program called `host`.
- `rg "runsNested|machine" packages/agent-pi/src` - nothing.
- `rg "harnessConfigPath" packages/agent-cofold/src` - cofold mounts its configuration at the host's own path; the fixed target is plugin/15 task 06, not yet built.

### Runtime path

```
claude.machine() -> [changes] claudePart { part: 'claude' } instead of claudeExecutable, unless the host binary is asked for
ACP preset.machine -> [new] { part: '<agent>' }
cofold.machine() -> [new] ahpdPart { part: 'ahpd' } -> nested() runs `ahpd` from /opt/ahpd/ahpd/bin on PATH
pi -> [new] runsNested + ahpdPart, and @ahpd/agent-pi installed in the ahpd part
claude / presets / cofold / pi -> [new] a state need with seeds, host mounts marked when: 'host', secrets as env needs
```

### Gaps

- Claude's binary is the host's, mounted on every machine whatever the options say.
- A cofold machine's image must carry ahpd and its plugins.
- Claude's machine mounts the host's `~/.claude`, sign-in included.
- `@ahpd/agent-pi` cannot enter a machine at all.
- A Claude variant with an `env`, or a session with a pushed credential, hands the daemon's whole environment, `HOME` and `PATH` included, to the CLI in a machine, because what is laid after the filtered env replaces it.
- agent-acp has no presets yet; acp/05, rewritten as the ACP presets plan, gives it them.

## Decisions locked in

| Decision | Task |
| --- | --- |
| [A nested host is used only for a backend that runs nested and for a machine on another host](../../../decisions/a-nested-host-is-used-only-where-a-command-cannot-reach-the-agent.md) | 03, 06 |
| [A part is mounted from its own image, and a volume filled from that image is the fallback](../../../decisions/a-part-is-mounted-from-its-image-and-a-volume-is-the-fallback.md) | 01, 02, 03 |
| [A plugin is loaded once, and each of its presets is a variant registered as an agent of its own](../../../decisions/a-plugin-loads-once-and-each-preset-is-a-variant.md) | 02, 04, 09 |
| [Cofold's configuration reaches a machine at a fixed target, named by a path variable](../../../decisions/cofold-config-reaches-a-machine-by-a-path-variable.md) | 05 |

| What | Source | Task |
| --- | --- | --- |
| The host binary mount stays as an opt-in on `@ahpd/agent-claude`, and the part is the default | the proposal Softov asked to plan, 2026-09-26: the host mount becomes an opt-in | 01 |
| The `computerConfigDir: false` route, which mounts only the executable, mounts only the part | follows from the option's meaning | 01 |
| Claude seeds `settings.json`, `CLAUDE.md`, `skills/`, `agents/`, `commands/`, and `.claude.json` with `mcpServers` alone; never `.credentials.json` | the proposal Softov asked to plan, 2026-09-26 | 04 |
| `@ahpd/agent-pi` gets into a machine the way cofold does, in this plan | Softov, 2026-09-26, asked "How should @ahpd/agent-pi get into a machine?", answered "Add tasks to p5" | 06, 07 |
| Claude in a state volume signs in with `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` from the variant's own `env`, passed per exec | the proposal: a token from `claude setup-token` does not refresh | 04, 09 |
| A secret comes from the vault as `{ "$secret": "<scope:name>" }`, or from the daemon's environment as `{ "fromEnv": "NAME" }` in a plugin option; a login file is never seeded | Softov, 2026-10-02, asked "What does the vault unlock first?": "Options and machines" | 04, 05, 07 |
| Inside a machine a Claude variant's exec env is built from that variant's preset `env` alone, a pushed credential and `CLAUDE_CONFIG_DIR`; Claude's secret env goes per exec only, never as container env, and the daemon's `ANTHROPIC_*` and `CLAUDE_CODE_OAUTH_TOKEN` cross only when the variant names them | (defaulted: `docker exec` cannot unset a container-level variable, so a key set on the container, or forwarded from the daemon, reaches every variant on the machine, the OpenRouter one included) | 04, 09 |
| A `$secret` in a variant's `env` fails only that session's start | Softov, 2026-10-03, asked "when a `$secret` in a plugin's options can't be read at load, what fails?": "Only its item" | 09 |
| The ahpd part's plugins are installed into `/opt/ahpd/ahpd/plugins` and found through `AHPD_PLUGIN_ROOT` | [p3 task 02](../05-an-agent-in-a-machine-p3-parts-are-built-from-one-versions-file/task-02-a-part-image-per-kind.md) | 03, 06 |
| For now a new plugin-wide option `computerCli: "part" \| "host"`, `"part"` by default and shared by every variant like `computerExecutable`, turns the host binary mount on | Softov, 2026-10-03, asked "what turns the host binary mount on?": "a new plugin-wide option `computerCli: "part" \| "host"`, part default" | 01 |
| For now the secrets are per variant: each variant signs in with what its own `env` names, and nothing of one variant's reaches another | Softov, 2026-10-03, asked "does a Claude variant on another endpoint still get the two secret env needs?": "per variant; a variant whose env names either declares none" | 04, 09 |
| For now every Claude variant of one load shares one state at `computerConfigDir` (`/ahpd/claude`), and identical needs collapse to one at create | Softov, 2026-10-03, asked in `container/05-p6` "where does each variant's state go?": "Share; dedupe identical needs" | 04 |
| For now the ACP presets plan (acp/05, once rewritten) ships presets for the known agents, so a part's name and config dir are written once; task 02 fills a `machine` block per shipped preset | Softov, 2026-10-03, asked "does the ACP presets plan ship presets for the known agents, or document examples?": "shipped presets" | 02 |

## Proposed architecture

- **Layer responsibilities** - `@ahpd/agent-claude`: its part, its state, the host-binary opt-in and the variant's env in a machine · `@ahpd/agent-acp`: presets name parts and state · `@ahpd/agent-cofold` and `@ahpd/agent-pi`: running nested, the ahpd part and their state.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - Claude runs from its part](task-01-claude-runs-from-its-part.md) | todo | p4 task 01 |
| [02 - ACP presets carry their machine](task-02-acp-presets-name-their-parts.md) | todo | acp 05 (the ACP presets plan) |
| [03 - A cofold machine runs ahpd from its part](task-03-a-cofold-machine-runs-ahpd-from-its-part.md) | todo | p3 task 02 |
| [04 - Claude keeps its state in a volume](task-04-claude-keeps-its-state-in-a-volume.md) | todo | 01, container/05-p6 task 05 |
| [05 - ACP presets and cofold declare their state](task-05-acp-and-cofold-declare-their-state.md) | todo | 02, 03 |
| [06 - pi runs nested from the ahpd part](task-06-pi-runs-nested.md) | todo | 03, p3 task 02, container 04 task 17 |
| [07 - pi declares its state](task-07-pi-declares-its-state.md) | todo | 06 |
| [08 - Docs](task-08-docs.md) | todo | 04, 05, 07, 09 |
| [09 - A Claude variant's env reaches its machine without the daemon's](task-09-a-claude-variants-env-reaches-its-machine.md) | todo | - |

## Risks and tradeoffs

- A Claude session in a machine now runs the pinned version, not the host's - the docs say so, and the host-binary opt-in gives the old behaviour.
- A Claude profile made before this now needs a token - a profile with `state: "host"` keeps working unchanged, and the refusal names both routes.

## Resume state

- **Done so far:** nothing; revalidated against main 2026-10-02, after claude/15 landed.
- **Next action:** task 09, which needs nothing else; then 01 after p4 task 01 and once its open question is answered, and 03 after p3 task 02; then 04, 06 and 07; 02 and 05 wait for acp/05, rewritten as the ACP presets plan.
- **Open question (ask before task 01):** with `computerCli: "part"` the default, a host that cannot build the `claude` part (offline, or the build fails) refuses every Claude machine - (a) keep the part strict, so the machine is refused with a sentence naming the part, or (b) fall back to the host binary mount with a log line saying so?
- **Open question (ask before task 07):** pi's settings may name a provider key variable of their own, beyond pi's provider list - (a) declare only the provider list's variables, and a custom name is the profile's to add as a need, or (b) read the host's pi settings at load and declare each variable they name as well?
- **Watch out for:**
  - container 04's fix tasks change the nested start; land them first.
  - Two Claude variants on one profile share one state volume; main already makes one mount of identical mounts (`oneMountEach`), and `container/05-p6` task 05 collapses the identical state and env needs.
  - plugin/15 task 06 moves cofold's configuration to its fixed target; task 05 builds on it.
  - The pi plans (`pi/01` to `pi/09`) change `@ahpd/agent-pi` too; tasks 06 and 07 touch only its agent object and its plugin list.
  - A resumed pi session in a machine reads its transcript through the inner host, so the open problem that a pi transcript opens empty for a session its process did not watch applies there.
  - acp/05's one-preset-per-load shape is not the one task 02 fills; task 02 waits for its rewrite.

## Final verification checklist

- [ ] A disposable Claude session in `debian:bookworm-slim` answers a turn with no host binary and no host home mounted, signed in by `CLAUDE_CODE_OAUTH_TOKEN`.
- [ ] A Claude variant with its own endpoint answers a turn in a machine, and `env` inside shows its keys and not the host's `HOME`.
- [ ] A profile naming the built-in Claude and a variant makes one machine with one state volume at `/ahpd/claude`.
- [ ] `computerCli: "host"` makes today's machine with the host binary mounted.
- [ ] A Codex preset in a disposable machine answers a turn.
- [ ] A cofold session in a machine made from `debian:bookworm-slim` answers a turn.
- [ ] A pi session in a machine made from `debian:bookworm-slim` answers a turn, with its settings from the state volume and its key by name.
- [ ] `pnpm test`, `pnpm typecheck` green.
- [ ] `docs/COMPUTER.md`, `plans/index.md` updated.
