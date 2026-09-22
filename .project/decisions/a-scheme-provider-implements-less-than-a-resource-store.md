---
title: A scheme provider implements less than a resource store
status: accepted
date: 2026-09-22
refs:
  - code://packages/sdk/src/types/resources.ts#L125-L183 - `ResourceStore`, whose four read methods are required
  - code://packages/sdk/src/host.ts#L4726-L4745 - the `@` completion, which asks for paths rather than URIs
  - code://packages/sdk/src/host.ts#L5183-L5215 - `createResourceWatch`, which needs `watch` and answers `-32601` without it
  - code://packages/sdk/src/host.ts#L5225-L5290 - the write half, where an absent method is `-32601`
  - code://.project/research/host-owned-uri-resources.md - the proposal that asked for a smaller contract rather than fake file semantics
---

## Context

`ResourceStore` requires `list`, `read`, `resolve` and `complete`, because it was written for a filesystem: `complete(typed, base, limit)` completes a path and `list` returns directory entries.
A provider for a scheme like `computer:` may serve `read` and `resolve` and have no directories, no paths and nothing to complete, so forcing the full interface would make it invent file semantics it does not have.
The write half already has the shape that fits: each method is optional and the host answers `-32601` for one that is absent, which the protocol's own client treats as a reason to degrade.
The `@` completion is a path question - it is rooted at the session's own directory and its answer is inserted as a path - so there is no URI in it to route by.

## Decision

A scheme provider implements a smaller contract than `ResourceStore`: `read` is required, `list`, `resolve` and `watch` are optional, and the write methods are the same optional set `ResourceStore` already has.
The host asks for each one through the same `need(method, name)` it uses for the write half, so a method a provider does not implement answers `-32601` rather than throwing or answering something invented.
`complete` is not part of the provider contract: path completion stays with the file store, and a provider that serves no paths is not asked a path question.
`file:` keeps using `ResourceStore` unchanged, because the file store implements all of it.

Source: (defaulted: a `computer:` provider has no path completion to offer, and the research asks for a smaller read-only contract rather than fake file semantics; the user may erase this).

## Consequences

A provider implements only what it serves, and what it leaves out is the whole of its answer about that operation.
`resourceList`, `resourceResolve` and `createResourceWatch` each have to handle a method that is not there, which is the work the smaller contract moves from every provider to the host's one routing step.
A future client that wants to browse a provider's URIs needs a completion call that takes a URI, which this plan does not add; the `@` menu is unchanged and remains a file menu.

## Options

- **Reuse `ResourceStore` for providers.** Rejected: it demands `complete`, `list` and `resolve` of a scheme that has none, so a provider would answer emptily or throw to satisfy an interface about files.
- **Make `ResourceStore`'s read methods optional instead of adding a second contract.** Rejected: `ResourceStore` is the type of `HostOptions.resources` and of the `Start.resources` a backend is handed, so every existing consumer would grow an absence check for methods the file store always has.
- **Give the provider contract a `complete` and route the `@` menu by scheme.** Rejected for now: the typed text is a path with no scheme in it, so routing it would mean guessing which provider a path belongs to; a real browser needs a URI-shaped call and is a client change.
