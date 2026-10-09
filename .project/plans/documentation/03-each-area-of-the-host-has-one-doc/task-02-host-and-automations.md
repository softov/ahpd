---
title: The host and automations have their own docs
status: done
depends: []
layer: "docs"
refs:
  - "[code://packages/server/src/rootconfig.ts](../../../../packages/server/src/rootconfig.ts) - root config"
  - "[code://packages/sdk/src/host/automations.ts](../../../../packages/sdk/src/host/automations.ts) - automations"
---

## Objective

`docs/HOST.md` says what the host is: the root resource, its config keys with each option, the schemes it serves, and what it announces. `docs/AUTOMATIONS.md` says what an automation is: triggers, trigger types from plugins, runs, owners, and the commands. DAEMON.md keeps running the daemon.

## Files

- `CREATE: docs/HOST.md`, `CREATE: docs/AUTOMATIONS.md`.
- `UPDATE: docs/DAEMON.md` - "Automations" moves to AUTOMATIONS.md; the root config half of "Configuration" moves to HOST.md.

## Steps

1. Read the sources in Files and the area's code; list its terms, config keys, commands and grants.
2. Write each doc in the plan's shape, checking every claim against its code.
3. Move the named sections; leave one line and a link where each was.
4. Run `rg -n "DAEMON.md#|USERS.md#|AHP.md#" .` and fix each link that moved.
5. Find the area's decisions with `rg -ln "code://packages/<area path>" .project/decisions/` and link the ones a reader needs for why.

## Validation

- Each claim names a file it was read in; read by hand against that file.
- Softov reads the diff before commit.

## Resume

Two docs are written.

`docs/HOST.md`, 169 lines: what the host is and its terms one line each; the root resource and its state fields, its four `_meta` keys and the methods declared on the channel; what the host announces (the `agents` fields, `ahpd.grants`); what it serves (its own `file:` scheme, and every other scheme as a provider's); the configuration keys, a table of nineteen with a paragraph each for the ones that need it, including `mcpServers` with its JSON shape; root config, the five host keys and the daemon's eight plus `plugins.<name>`, the live-versus-`restartNeeded` split and the `<set>` masking; the four commands; the grants table; and what to read next.

`docs/AUTOMATIONS.md`, 231 lines: what an automation is and its terms; the three kinds of trigger, with the cron rules written out; the eight session events; the rule's four parts and a worked example; the five `watch` presets; runs and their lifecycle; the pinned case; the four overlap modes; the six wake placeholders and the summary block; the owner; what stops a wake; the two config keys; the commands; the grants; and what to read next.

Moved out of `docs/DAEMON.md`, each leaving a stub heading and a link:

- `## Automations` (130 lines) to AUTOMATIONS.md. DAEMON.md keeps the `### --automations, and what memory costs` flag subsection, because it is about the flag as typed.
- The per-key prose of `## Configuration` (`users`, `resource`, `issuer`, `trustToken`, `advancedTools`, `deltaWindowMs`, `http`, `usage`, `policies`, `mcpServers`) to HOST.md's configuration keys, rewritten as one table plus paragraphs. DAEMON.md keeps the file mechanics: two files and the merge order, the anchors for relative paths, the flags-as-keys example, the schema check, and `ahpd config`.
- `### What a client can configure` to `HOST.md#root-config` (that heading is "Root config" now).
- The `usage:`-scheme paragraph, which had been left orphaned under Configuration. It moved into HOST.md beside the `usage` key, since that key is what configures the store the scheme reads from.

Links fixed in `docs/DAEMON.md`: two `[Automations](#automations)` links (the `--unowned-automations` options row and the closing line of the `--automations` subsection) now point at AUTOMATIONS.md.

Found: `docs/AHP.md` line 308 has `automationRun/cancelRequested` as ✅ with the note "A request the store answers, because only it knows whether the run has got far enough to be stopped", but `packages/sdk/src/host/actions.ts:484-487` refuses it outright: `no('A run here is a session, and disposing it is how it stops')`. The doc says what the code does (refused) and the `automation:cancel` grant is still asked before the refusal, since it is in `ACTION_NEEDS` in `packages/sdk/src/host/gate.ts`. The AHP.md row is not edited by this task, which keeps wire rows where they are.

Drift: as task 01, the `#L<n>` anchors in `.project/plans/**` below the removed lines have moved; none pointed into a moved section.
