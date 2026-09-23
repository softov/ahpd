---
title: Host - what exists today
domain: host
revalidated: 2026-09-19
---

The host is `packages/sdk` (`@ahpd/sdk`): `createHost` and the protocol surface it serves, the ports it is given rather than imports, the session and chat stores, the tools a session offers its agent, and the wire types every other package imports.
It has no runtime dependencies and one peer dependency, which `scripts/boundary.mjs` enforces, so nothing here reaches for a file, a process or a network by itself.

## Packages

- `code://packages/sdk` - entry point `src/index.ts`; the host itself `src/host.ts`; the socket `src/listen.ts`; the peer `src/rpc.ts`; the stores and ports `src/sessions.ts`, `src/resources.ts`, `src/terminals.ts`, `src/git.ts`, `src/github.ts`, `src/changes.ts`, `src/worktrees.ts`, `src/automations.ts`, `src/catalog.ts`, `src/scheduled.ts`, `src/cron.ts`, `src/debuglogs.ts`, `src/paging.ts`, `src/zip.ts`; the tools a session's agent is given `src/tools.ts`, `src/sessiontools.ts`, `src/artifacttools.ts`.

## Contracts

- `code://packages/sdk/src/types/host.ts` - the shapes a host, its ports and its clients agree on.
- `code://packages/sdk/src/types/session.ts` - `SessionState`, `ChatState` and the store every action is applied to.
- `code://packages/sdk/src/types/agent.ts` - the `Agent` interface a backend implements, from which this package imports no runtime value.
- `code://packages/sdk/src/types/index.ts` - what the package publishes.

## Runtime path

```
createHost({ agents, resources, terminals, git, github, worktrees, automations })
  -> listen() accepts a peer -> dispatch() answers a request or refuses it
  -> applyDispatch() folds an action into sessions and chats and moves serverSeq
  -> notifications reach the connections that subscribed, and a missing port answers -32601 through need()
```

## Tests

- `code://test/host.test.ts` - the host through a scenario client, and the main suite.
- `code://test/conformance.test.ts` - every emitted action replayed through the protocol package's own reducers.
- `code://test/wire.test.ts` - the declared surface checked against a JSON Schema generated from it.
- `code://test/sessiontools.test.ts`, `code://test/artifacttools.test.ts`, `code://test/pullrequest.test.ts`, `code://test/operations.test.ts` - the tools and the stores beside them.
- `code://test/scenario.ts` - the harness the rest drive.

## Known gaps

- The artifact tools answer with a description rather than the reference's status and id, and a reference is never promoted to an artifact in place; plan [01 - Artifact tools](01-artifact-tools/plan.md).
- The root config declares `defaultShell` and nothing else, so a window setting mapped to a host key has nothing to set; plan [02 - Session config and titles](02-session-config-and-titles/plan.md).
- `_meta.github` reports the pull requests a branch has and no baseline, so a client cannot tell the session's own from inherited ones; plan [03 - Pull request baseline](03-pull-request-baseline/plan.md).
- Nobody signs in unless a `users` file is configured: plan [06 - Users and permissions](06-users-and-permissions/plan.md) built the directory, the sign-in resource and the one gate, and a daemon with no file refuses nothing.
- A host-wide sign-in has no home in the protocol, so it rides on every agent's `protectedResources` and makes each one read as required; plan [08 - An issuer behind the `Users` port](08-an-issuer-behind-the-users-port/plan.md) gives the record a real issuer, and the modelling gap itself is recorded in `research/a-host-level-protected-resource.md`.
