---
title: Read-only needs reach a dev container through an override config's mounts
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/computer/src/runtime.ts#L419-L425](../../packages/computer/src/runtime.ts#L419-L425) - `cliMount`, which appends `,readonly`"
  - "[code://packages/agent-claude/src/claude.ts#L398-L404](../../packages/agent-claude/src/claude.ts#L398-L404) - Claude's `claudeExecutable` need, `readOnly: true`"
  - "[code://packages/agent-cofold/src/agent.ts#L551-L558](../../packages/agent-cofold/src/agent.ts#L551-L558) - cofold's `cofoldConfig` need, `readOnly: true`"
  - "file:///usr/local/lib/node_modules/@devcontainers/cli/dist/spec-node/devContainersSpecCLI.js - the CLI's `--mount` check"
---

## Context

An agent's read-only need is passed to `devcontainer up` as `--mount type=bind,source=...,target=...,readonly`.
The Dev Container CLI 0.89.0 checks every `--mount` against `type=<bind|volume>,source=<source>,target=<target>[,external=<true|false>]` and refuses anything else: "Unmatched argument format: mount must match type=<bind|volume>,source=<source>,target=<target>[,external=<true|false>]".
Claude and cofold both declare read-only needs, so a dev container made for either session fails at `up`.
A `devcontainer.json`'s own `mounts` entries are Docker mount strings and take `readonly`.

## Decision

Read-only needs reach a dev container through an override config: the folder's `devcontainer.json` with the needs added to its `mounts`, passed to the CLI as `--override-config` on `up` and on every `exec`.
Source: Softov, 2026-09-26, asked "How should read-only needs be delivered through the CLI? (a) bind them read-write; (b) keep them read-only by some other route than `--mount` (e.g. an override-config `mounts` entry); (c) refuse such a need for dev containers": "through an override config's `mounts`".

## Consequences

A need keeps its `readOnly` in a dev container as it does in a machine made from an image.
The override replaces the folder's file for the CLI, so it is the folder's file with additions, and any path in it that the CLI resolves relative to the config file must still point where it did.
`exec` must name the same override, so the CLI reads the same `remoteUser` and `remoteEnv` it made the container with.

## Options

- **Bind read-only needs read-write.** Rejected: an agent's executable and configuration become writable from inside the container.
- **Refuse a read-only need for a dev container.** Rejected: Claude and cofold could then never run in one.
