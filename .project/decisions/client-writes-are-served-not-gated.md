---
title: A client that may connect may write a file it may read
status: proposed
date: 2026-09-23
refs:
  - code://packages/sdk/src/host.ts#L4388-L4412 - `mayWrite` and `needsWrite`, the gate this decision removes
  - code://packages/sdk/src/host.ts#L5258-L5327 - the five resource handlers that call it
  - code://packages/sdk/src/host.ts#L5342-L5353 - `resourceRequest`, the only writer of `connection.grants`
  - code://packages/sdk/src/host.ts#L5406 - the same gate on a changeset operation that writes
  - file:///github/externals/vscode/src/vs/platform/agentHost/node/protocolServerHandler.ts#L1738-L1743 - the reference host answering `resourceRequest` with `{}` and enforcing nothing
  - file:///github/externals/vscode/src/vs/platform/agentHost/node/protocolServerHandler.ts#L1644-L1646 - the reference host's `resourceWrite`, which checks no grant
  - file:///github/externals/vscode/src/vs/platform/agentHost/common/agentHostFileSystemProvider.ts#L491-L504 - the client's `writeFile`, which maps `-32009` to `NoPermissions` and never retries
  - file:///github/externals/vscode/src/vs/platform/agentHost/common/agentHostFileSystemProvider.ts#L548-L560 - `requestResourceAccess`, the ask half, whose only callers in that revision are tests
  - git://832cf23c5 - the VS Code revision every reference above was read at
---

## Context

A VS Code window driving this host cannot save a file in a session workspace.
Saving goes through `agentHostFileSystemProvider.writeFile`, which sends `resourceWrite`, and this host refuses it `-32009` with `Write access to ... has not been granted` because the connection holds no grant.
The refusal carries the `resourceRequest` that would unlock it, which is the protocol's own affordance, and the client never sends it: `requestResourceAccess` exists to ask and retry, and nothing in that revision calls it but a test.
The reference host the protocol is written against does not gate client to server writes at all: its `resourceRequest` answers `{}` with a comment saying it does not enforce per-resource grants, and its `resourceWrite` checks nothing.
So the gate is not a rule this host is keeping against a client that forgot; it is a rule the reference never had, and the one client that can drive a host will not open it.
The gate also protects nothing: `resourceRequest` grants any `file://` URI to any connection that asks, and the connection token has already decided who may be here.

## Decision

Client to server resource writes are served without a prior grant: `resourceWrite`, `resourceDelete`, `resourceMkdir`, `resourceMove`, `resourceCopy` and the write half of `invokeChangesetOperation` act on any `file://` URI the store serves, exactly as the read half already does.
`resourceRequest` stays served and keeps answering `{}` for a `file:` URI, and the ask is still logged, but `mayWrite`, `needsWrite` and the per-connection `grants` set go, because a set nothing reads claims an enforcement that is not there.
The `-32009` a client-owned resource answers with is unchanged: this host still relays the owner's refusal verbatim, because that refusal is the owner's and not this gate.

## Consequences

A window can save, rename, create and delete files in a workspace this host serves, which is the interaction the host exists for.
The write half no longer offers a negotiation, so no refusal on this path carries a `data.request` to retry with; nothing in the reference client read one.
The safety of the write half is now exactly the connection boundary: loopback with no token is open, and `--connection-token` is what closes it.
`docs/AHP.md`'s `resourceWrite`, `resourceRequest` and `invokeChangesetOperation` rows, `README.md`'s Resources row, and the `-32009` cases in `test/writes.test.ts`, `test/host.test.ts` and `test/operations.test.ts` all move with it.

## Options

- **Keep the gate and pre-grant the served directories at `initialize`.** It fails the case that matters: a session's worktree lands beside its repository, outside every `--path`, and `--path` is a catalogue rather than a fence here, so a window still could not save in the worktree it is working in.
- **Keep the gate and have the host ask through the server-to-client `resourceRequest`.** That direction is the host asking a client about the client's own resource, which is the opposite of this, and there is no person at a daemon to answer it.
- **Keep the gate and enforce it only when a connection token was configured.** The default loopback daemon, which is the reported case, would still refuse every save, and the reference does not condition on a token.
