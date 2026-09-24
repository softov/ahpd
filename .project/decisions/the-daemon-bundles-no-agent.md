---
title: The daemon bundles no agent, and Claude arrives as a plugin
status: accepted
date: 2026-09-24
refs:
  - code://packages/server/src/main.ts - the `base` that no longer names a backend, and the refusal that replaces it
  - code://packages/agent-claude/src/plugin.ts - the entry that makes the Claude package loadable
  - code://packages/server/src/plugins.ts - the loader that resolves a named package and folds what it registers
  - code://.project/decisions/agent-package-only-when-it-brings-a-runtime.md - which backends are packages at all
  - code://docs/PLUGINS.md - what an operator reads to name one
---

## Context

`@ahpd/server` was a thin wrapper over two libraries, and one of them was a backend: `base.agents` was the literal `[claude({ paths: options.paths })]`, and `@ahpd/agent-claude` was a dependency of the daemon package.

Everything else a host can be given had already moved out from under that shape. A plugin contributes a backend, a port, a tool, a resource scheme and a session setting, and `foldHostOptions` folds a plugin's contributions into whatever the daemon built. `@ahpd/agent-acp` and `@ahpd/agent-cofold` are loaded that way and are not in the daemon's manifest. Claude was the one backend that arrived by being compiled in, which made it the only one that could not be left out, upgraded on its own, or replaced without a fork.

It also made the daemon's dependency tree the Claude Agent SDK's. A deployment serving ACP or cofold and nothing else still installed a harness it never started, and the package that implements the protocol was, in practice, a package that runs Claude.

## Decision

The daemon bundles no backend. `base.agents` is `[]`, `@ahpd/agent-claude` is no longer a dependency of `@ahpd/server`, and every agent a host serves is a plugin's.

`@ahpd/agent-claude` gains the plugin entry the other agent packages already have: `name`, `title` and `apply`, exported from `index.ts`, with an `ahpd` block in its manifest and `@ahpd/sdk` moved from a dependency to a peer so the loader's range check has something to read. `paths` defaults to the host's, so the ordinary install names the package and nothing else.

A daemon whose configuration contributed no backend refuses to start. It exits 1 with a line naming the key to edit and a package to put in it, rather than accepting clients it could never answer.

## Consequences

Installing the daemon is no longer installing an agent. The first run is two steps: `npm i -g @ahpd/server`, then `npm i @ahpd/agent-claude` in the configuration directory and a `plugins` entry naming it. That is friction the old shape did not have, and it is the cost of the backend being replaceable.

The Claude backend releases on its own. A harness change is a `@ahpd/agent-claude` version an operator installs, not an `@ahpd/server` version they have to take everything else with.

The library path is unchanged. `createHost({ path, agents: [claude({ paths })] })` is what it always was, because `claude()` is still the export and the plugin entry only wraps it.

Every test that starts a real daemon has to name a backend, and the one that did - the dev container relay - now names `test/fixtures/plugin-echo`.

`agents: []` is a configuration that reaches `createHost`, which refuses it too. The daemon checks first so the sentence a person reads is about a configuration file rather than about a `HostOptions` they never wrote.

## Options

- **Keep Claude compiled in and let a plugin add others.** Rejected: it is the shape being removed. One backend that cannot be left out is a dependency every deployment pays for, and it keeps the protocol package and the Claude harness in one release.
- **Bundle Claude but let a flag turn it off.** Rejected: the dependency stays, so the install cost and the coupled release stay with it, and the flag is a second way to say what `plugins` already says.
- **Start with no backend and serve an empty `agents` list.** Rejected: a host that accepts a client, advertises nothing it can run, and fails on `createSession` is a worse answer than a startup that stops and names the fix.
- **Ship a configuration file on install that names `@ahpd/agent-claude`.** Not rejected forever: it would restore the one-step first run without restoring the dependency, and it is a question about what `ahpd` writes on a first run rather than about what it bundles.
