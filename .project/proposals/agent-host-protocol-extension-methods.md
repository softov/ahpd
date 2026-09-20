---
title: Extension methods have no convention a host that is not VS Code can follow
target: https://github.com/microsoft/agent-host-protocol
date: 2026-09-19
refs:
  - file:///github/externals/vscode/src/vs/platform/agentHost/common/agentHostExtensionProtocol.ts#L20-L40 - the extension method names, none of them in the protocol
  - file:///github/externals/vscode/src/vs/platform/agentHost/common/agentHostExtensionProtocol.ts#L75 - the capability helper a client gates one of them on
  - file:///github/externals/agent-host-protocol/docs/specification/lifecycle.md - the `_meta` paragraph, which is the only place extension capability is discussed
---

## Summary

VS Code's window and a host exchange a second JSON-RPC surface beside the protocol: `vscode/devContainers/{isDockerAvailable,connect,disconnect,relaySend}`, `vscode/removeSessionArtifact`, `vscode/createAgentHostDetachedWorktree` and the four methods around it, `vscode/requestWorkspaceTrust`, `vscode/collectAgentHostDebugLogs`, `vscode/getAgentHostSessionStateFile` and more.
Each is gated by a capability flag on `InitializeResult._meta`, and the protocol says nothing about any of it: no naming rule, no typed capability list, no way for a client to discover what a host answers beyond the protocol.

## What that costs an implementation that is not VS Code

A second host serves the `vscode/*` names, because the reference window is what reads them, and copies the `vscode.*` capability flags for the same reason.
That works exactly as far as imitation goes and no further: a capability of its own has nowhere to go that any client would look, and a client that does not serve one of these methods can only answer `-32601`, which is indistinguishable from a protocol method it has never heard of.
The namespace also reads as ownership: `vscode/*` appears to be Microsoft's private surface, so a different host has to decide whether copying it is compatibility or impersonation, and the specification offers no opinion.

## The asymmetry to note

`_meta` is where a host advertises that it speaks an extension, and `_meta` is documented as implementation-specific with a recommendation to use typed fields for interoperable behaviour.
An extension surface that interoperates by construction, in that both sides must know the names to use it, is therefore in the one place the specification says not to put interoperable things.

## What is being asked

One of three, in descending order of usefulness:

1. Describe the convention: a namespaced method prefix plus a typed capability list on `InitializeResult`, so an extension is discoverable rather than known by having read the other implementation.
2. State that the namespace is private to VS Code, and that interoperable features must be typed fields, so that a second implementation knows imitation is the only path and can plan for it.
3. Leave it as it is, and accept that the surface is defined by one implementation's source, which is what a second host and a second client both concluded while being written.
