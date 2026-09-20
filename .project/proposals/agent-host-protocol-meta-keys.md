---
title: Well-known `_meta` keys carry behaviour the spec says belongs in typed fields
target: https://github.com/microsoft/agent-host-protocol
date: 2026-09-19
refs:
  - https://github.com/microsoft/agent-host-protocol/blob/main/docs/specification/lifecycle.md - `_meta` is called opaque, and typed fields are named as the place for interoperable behaviour
  - file:///github/externals/vscode/src/vs/platform/agentHost/common/state/sessionState.ts#L1682-L1684 - `initialPullRequestUrls` and `associatedPullRequestUrls`, defined here and nowhere in the protocol
  - file:///github/externals/vscode/src/vs/sessions/services/sessions/common/session.ts#L400 - a client rule that depends on those two keys
---

## Summary

`_meta` is documented as an opaque, implementation-specific map, and the same paragraph says that capabilities needed for interoperable behaviour should be added as typed `InitializeResult` fields instead.
Several keys are nonetheless load-bearing across implementations, and nothing in the repository lists them, so a second host or client can only find them by reading VS Code.

## The keys that behave as contract

- `_meta['agentHost/sessionArtifacts']` on a session and its row: the artifacts and references a session recorded, which a window draws as pills beside the input and can remove one by one. A host that does not emit this shape is not drawn at all. A client reads the capability as `supportsAgentHostArtifactRemoval` and the entries as a list of `{ id, type, label, isArtifact, link?, uri? }`, where the id is stable per entry whatever `isArtifact` says. VS Code reads it at `baseAgentHostSessionsProvider.ts:1217,4857`.
- `_meta.github` on a session: `pullRequestUrls`, `pullRequestBranchName`, `pullRequestState`, `pullRequestStateUrl`, `owner` and `repo`. The reference client now also separates a session's own pull requests from inherited ones, and for that it uses two more keys that appear nowhere in the protocol, `initialPullRequestUrls` and `associatedPullRequestUrls` (`sessionState.ts:1682-1684`, consumed at `sessions/services/sessions/common/session.ts:400`). A host that omits them makes every pull request that came with the checkout read as the session's own, and nothing on the wire says so.
- `_meta.toolKind` on a tool call: `terminal`, `read`, `search` or `subagent`, the hint that routes a call to the renderer that knows how to draw it. When a host omits it, VS Code derives it from Copilot's own permission payload, which is not a fallback a non-Copilot host has.
- `_meta.progressMessage` on a running tool call: the line a client shows while the call is in flight, meaningful only while the status is `running`.
- `_meta.kind` on a `SystemNotificationResponsePart`: `responseRoundEnded` and its siblings. The state-model guide says a host MAY attach a machine-readable descriptor and clients MAY inspect well-known keys, but the set itself is defined only in VS Code (`common/meta/agentSystemNotificationMeta.ts:25`).
- `_meta.copilotUsage`, `_meta.cost` and `_meta.autoModeResolved` on a usage report: per-turn cost, credits and the model automatic routing picked. The guide already offers a `pricing` key as its example of a well-known usage key, so these are the de-facto shape of that idea.
- Capability flags on `InitializeResult._meta`: `vscode.removeSessionArtifact`, `vscode.detachedWorktrees`, `vscode.devContainers` and `vscode.getAgentHostSessionStateFile.chat`. Each gates requests a client only makes when the flag is present, which makes them part of how two implementations negotiate.

## Why this is worth a page

Every key above had to be reverse-engineered from VS Code's source while writing a second host and a second client against the published package.
For two of them, a conformance case is the only documentation that exists anywhere, and a conformance case is not a specification: it says what one implementation did once, not what another is obliged to do.

## What is being asked

Either promote the interoperable keys to typed fields, which is what the lifecycle page already recommends, or publish them as a registry under `docs/`, one row each with its shape, its meaning and whether a host may omit it.
A third option, which would be enough for a client implementer, is to state plainly that these keys are VS Code's and are not part of the protocol, so that a second implementation knows it is choosing to imitate rather than comply.

The distinction that matters is between a key a client may read for a nicer picture and a key a client must read to be correct.
`initialPullRequestUrls` is the second kind, and today it is invisible.
