---
title: One ACP load, and each preset is an agent of its own
domain: acp
status: planned
priority: medium
created: 2026-09-26
revalidated: 2026-10-03
requires:
  - plans/acp/04-the-bridge-signs-in/plan.md
  - plans/claude/15-one-load-and-each-preset-is-a-variant/plan.md
changes: []
creates: []
decisions:
  - decisions/a-plugin-loads-once-and-each-preset-is-a-variant.md
  - decisions/agent-package-only-when-it-brings-a-runtime.md
refs:
  - "[code://packages/agent-acp/src/plugin.ts#L35-L87](../../../../packages/agent-acp/src/plugin.ts#L35-L87) - `optionsSchema`, `optionsOf` and `apply`: one load is one backend, written out by hand"
  - "[code://packages/agent-acp/src/types.ts#L46-L84](../../../../packages/agent-acp/src/types.ts#L46-L84) - `AcpOptions`, which stays one agent's options"
  - "[code://packages/agent-acp/package.json](../../../../packages/agent-acp/package.json) - the manifest's `ahpd.options`, where `command` is required today"
  - "[code://packages/agent-claude/src/plugin.ts#L89-L99](../../../../packages/agent-claude/src/plugin.ts#L89-L99) - `variantsOf`, the shape to mirror"
  - "[code://packages/agent-claude/src/plugin.ts#L123-L158](../../../../packages/agent-claude/src/plugin.ts#L123-L158) - `optionsOf` and `apply`: per-variant keys refused at top level, shared options, one `registerAgent` per variant"
  - "[code://packages/agent-acp/src/session.ts#L971-L1004](../../../../packages/agent-acp/src/session.ts#L971-L1004) - the sign-in acp/04 sends, and the sentence a session ends with when none was set"
  - "[code://packages/agent-acp/src/connection.ts#L108](../../../../packages/agent-acp/src/connection.ts#L108) - the child's environment, the daemon's with the spec's `env` over it"
  - "[code://packages/sdk/src/types/plugin.ts#L180](../../../../packages/sdk/src/types/plugin.ts#L180) - `secret(name, work?)`, how a plugin reads a `secretAtUse` value"
  - "[code://packages/computer/src/plugin.ts#L57-L61](../../../../packages/computer/src/plugin.ts#L57-L61) - `needValue`, the `secretAtUse` pattern"
  - "[code://docs/PLUGINS.md#L750-L799](../../../../docs/PLUGINS.md#L750-L799) - the ACP section, which says two specs are two backends and still shows `--experimental-acp`"
  - "[code://packages/agent-acp/README.md](../../../../packages/agent-acp/README.md) - the same two-spec example and the deprecated Gemini flag"
  - https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json - the launch commands the table was checked against
---

## Goal

`@ahpd/agent-acp` is written once in `plugins`, and its `presets` map says which ACP agents it serves.
Each key registers an agent of its own, with the key as provider id, as agent-claude's presets do.
A key that names a shipped preset, such as `gemini`, takes its command, arguments, name, the switch that stops it updating itself and the sign-in it needs; any field the preset writes wins.
A preset that cannot be resolved is skipped with a line naming it, and the others register.
A preset says how to run an agent on this host; what a machine needs to run it is added by container 05 p2 and p5.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Runtime path

```
config plugins[] -> server loadPlugins (one per name) -> agent-acp apply -> optionsOf (shipped row, then the preset over it, per key) -> registerAgent(acpAgent(...)) per preset -> root agents[] -> picker
```

### Gaps

- One load is one backend, and since claude/15 a plugin written twice fails the start, so the daemon serves one ACP server at most.
- Every spec is written out, and the docs' own example uses a deprecated Gemini flag.

## Decisions locked in

| Decision | Task |
| --- | --- |
| [A plugin is loaded once, and each of its presets is a variant registered as an agent of its own](../../../decisions/a-plugin-loads-once-and-each-preset-is-a-variant.md) | 01 |
| [A new `@ahpd/agent-*` package exists only when the target brings its own agent runtime](../../../decisions/agent-package-only-when-it-brings-a-runtime.md) | 01 |

| What | Source | Task |
| --- | --- | --- |
| agent-acp takes presets the way agent-claude does, one load and one agent per key | Softov, 2026-10-02, asked "Does agent-acp take the same presets shape in this plan?": "Claude now, ACP after" | 01 |
| The package ships presets for the known agents | Softov, 2026-10-03, asked "does the ACP presets plan ship presets for the known agents, or document examples?": "shipped presets" | 01 |
| Presets live in the acp domain; container 05 p2 and p5 add only machine needs | Softov, 2026-09-26, moving sign-in to acp, and the presets with it because they carry the sign-in | 01 |
| A preset that cannot be resolved, an unknown key with no `command` included, is skipped with one line naming `options.presets.<id>`; the others register | Softov, 2026-10-03, asked "which preset failures skip only that preset instead of failing the whole agent-claude plugin?": "Any preset failure" | 01 |
| A preset's `env` values are `secretAtUse`; the plugin reads a `$secret` there itself, and one it cannot read skips only that preset | Softov, 2026-10-03, asked "when a `$secret` in a plugin's options can't be read at load, what fails?": "Only its item" | 01 |
| A preset's `$secret` is read once at load in host scope; a `user:` or `team:` name skips that preset | (defaulted: mirrors claude/16, a preset is the daemon's, not a person's) | 01 |
| A provider id that clashes with another plugin's agent drops only that agent, as host/41 task 01 builds | Softov, 2026-10-03, asked "when one plugin's agent has the same provider id as another plugin's, what fails?": "Only that agent", applied in [host/41](../../host/41-a-failure-belongs-to-the-item-that-failed/plan.md) | - |
| A skipped preset is reported with `host.log`, and also with `host.problem` once host/41 task 03 lands | (defaulted: mirrors claude/16) | 01 |
| A key that names a shipped row takes that row; any other key takes the row its `base` names, or none, and then needs `command` | (defaulted: the key is the provider id, so a second account on one agent needs a way to name the row) | 01 |
| No shipped preset registers unless its key is written | (defaulted: an ACP agent's binary may not be installed; agent-claude's built-in is the one agent the package itself brings) | 01 |
| Top-level `command`, `args`, `env`, `cwd`, `provider`, `displayName`, `description`, `model` and `authenticate` fail the load naming `presets.<id>`; `hostTools` stays plugin-wide and a preset may set its own | (defaulted: mirrors agent-claude's refusal of per-variant keys at top level) | 01 |
| Presets that leave nothing to register fail the load, naming every skipped preset | (defaulted: mirrors claude/15 and claude/16) | 01 |
| A shipped sign-in that depends on a variable is decided after the preset's `env` is resolved: the daemon's environment, then the preset's `env`, then a `$secret` there once read | the plan review, 2026-10-03 | 01 |
| A hand-kept table for flags and switches; versions come from container 05 p3's `versions.json`, never from the preset | (defaulted: the registry has no config-dir or update-switch fields, and one place pins versions) | 01 |
| Only agents with an ACP server; Crush has none | the container research, 2026-09-26 | 01 |

## Proposed architecture

- **Data flow** - `optionsOf` reads `presets` key by key: the shipped row for the key or its `base`, the preset's own fields over it, `env` merged by key, `$secret` values read with `host.secret`, and the sign-in decided last. A preset that fails is logged and left out; `apply` calls `registerAgent(acpAgent(one))` for each that is left.
- **State flow** - `AcpOptions` stays one agent's options; the map lives only in the plugin entry.
- **Layer responsibilities** - `presets.ts`: the shipped table · `plugin.ts`: the schema, the merge and the skips. The server is unchanged; claude/15 built one load per name.
- **Source-of-truth files** - `packages/agent-acp/src/presets.ts` once task 01 makes it, and [`code://packages/agent-acp/src/plugin.ts`](../../../../packages/agent-acp/src/plugin.ts).

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - One load, a presets map, and the shipped table](task-01-the-preset-table.md) | todo | - |
| [02 - Docs](task-02-docs.md) | todo | 01 |

## Risks and tradeoffs

- A shipped preset goes stale when an agent renames a flag; each row carries its check date, and container 05 p3's bump job is where a version move is noticed.
- An existing config with a top-level `command` fails the load once this lands; the implemented note gives the rewritten block, as claude/15's did.
- A typo in a preset no longer stops the daemon; until host/41 prints skipped presets at start, it shows only as a log line and a missing picker entry.

## Resume state

- **Done so far:** nothing; the plan was rewritten on 2026-10-03 to the one-load presets shape.
- **Next action:** [task-01-the-preset-table.md](task-01-the-preset-table.md).
- **Watch out for:** container 05 p2 adds `machine` to a preset's options and p5 a `machine` block per shipped row (part, config dir, secrets, seeds); keep a row's shape open to that block.

## Final verification checklist

- [ ] `presets: { "copilot": {} }` alone starts a Copilot session.
- [ ] `presets: { "codex": {}, "gemini": {} }` shows two picker entries from one load.
- [ ] An unknown key with no `command` is skipped with one line, and the other presets register.
- [ ] `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass.
- [ ] `plans/index.md` updated.
