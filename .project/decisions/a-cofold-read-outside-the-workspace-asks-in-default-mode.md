---
title: In the default mode a cofold read outside the workspace asks first
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/agent-cofold/src/session.ts#L440-L445](../../packages/agent-cofold/src/session.ts#L440-L445) - the session's policy, `policyOf(mode, { inside, isEdit })`"
  - "file:///github/cofold/packages/agents/src/policy/modes.ts - `askOnEffects`, which allows any tool that only reads"
  - "file:///github/cofold/packages/tools/src/files.ts - `read_file`, `list_files` and `search_files`, whose rules say reads may go anywhere"
  - "[code://.project/decisions/permission-modes-live-in-the-harness.md](permission-modes-live-in-the-harness.md) - the modes have one definition, in `@cofold/agents`"
---

## Context

cofold's `default` mode is `askOnEffects`, which asks only for a tool that writes, destroys or reaches the network.
`read_file`, `list_files` and `search_files` declare `effects: { reads: true }` and resolve any absolute path, so a model reads a file anywhere on the daemon's machine without a prompt.
A read of `~/.config/cofold/config.json` (the provider keys) or `~/.ssh/id_ed25519` from a session whose workspace is a project folder completes in `default` with nothing asked.

## Decision

In the `default` permission mode, a tool that reads and names a path (`path`, or `cwd` for `list_files`) that `rules.inside` says is outside the workspace asks first, the way an edit does.
A read inside the workspace, or one that names no path, still runs without asking.
Source: Softov, 2026-09-26, asked "Should reads outside the workspace ask in `default`? (a) Keep cofold's \"reads go anywhere\". (b) Ask for reads outside the workspace, in ahpd's `decide` or as a cofold policy change. (c) Deny a set of known secret paths.": "ask".
It is enforced in `askOnEffects` in `@cofold/agents`, because [the modes have one definition, in the harness](permission-modes-live-in-the-harness.md) and the host already supplies `inside`, so `acceptEdits` and `plan` ask too, `dontAsk` refuses, and papo gets the rule.
Source for the layer: Softov confirmed, 2026-09-26.

## Consequences

Every mode that falls back to `askOnEffects` treats an outside read the same way: `default`, `acceptEdits` and `plan` ask, and `dontAsk` refuses; `auto` and `bypassPermissions` do not change.
papo gets the same rule, since it shares `policyOf`.
`memory_read` resolves against the memory folder and refuses a path outside it, so it is left to that check; ahpd's `inside` would call its relative path inside the workspace in any case.
The change is made in `/github/cofold` and reaches ahpd with a new `@cofold/agents` release.

## Options

- **Reads go anywhere.** cofold's rule as it stands, which lets a model read the daemon's secrets without anybody seeing a prompt.
- **Deny known secret paths.** A list that is never complete and that refuses a read a person may want to allow.
- **Ask from ahpd's own policy wrapper.** Faster to ship, but a second definition of a mode beside the harness's.
