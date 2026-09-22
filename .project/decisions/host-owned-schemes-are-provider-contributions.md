---
title: A host-owned URI scheme is a provider a plugin contributes
status: accepted
date: 2026-09-23
refs:
  - code://packages/sdk/src/types/plugin.ts#L83-L130 - the contribution surface the new method joins
  - code://packages/sdk/src/types/plugin.ts#L163-L187 - `Contribution`, which gains the keyed bucket
  - code://packages/sdk/src/plugins.ts#L78-L156 - `foldHostOptions`, where the keyed operation is folded
  - code://packages/sdk/src/host.ts#L5024-L5041 - the list and read handlers, which call the one store today
  - code://packages/sdk/src/host.ts#L7160-L7194 - the client relay, which runs before any handler
  - code://packages/sdk/src/resources.ts#L48-L58 - `why`, which already explains a foreign scheme as somebody else's
  - code://.project/research/host-owned-uri-resources.md - the proposal this answers
---

## Context

A plugin that wants to serve one host-owned URI scheme beside files has one slot to do it in, `HostOptions.resources`, and taking it means giving the file store up: `registerResources(store, 'replace')` overwrites what the daemon put there.
Wrapping the file store is possible and is what such a plugin has to do today, which makes every provider a filesystem proxy and stops two plugins that each want a scheme from coexisting.
The research document asks whether a `computer:` resource can be served without replacing the filesystem store, and proposes a contribution keyed by scheme.
The smaller alternative it also names, a read-only `computer_status` server tool and no resource change, gives a client no URI to browse, and the master that would answer that tool is not in this repository either, so it is not the self-contained step this one is.

## Decision

A plugin contributes one host-owned URI scheme with `registerResourceProvider(scheme, provider)`, and the host routes a resource command by the scheme in the URI: `file:` keeps the store in `HostOptions.resources`, a registered scheme goes to its provider, and a client-published URI is still relayed to its client before any handler sees it.
The providers are collected under `HostOptions.resourceProviders`, keyed by scheme, so `registerResources` and the file store keep their present meaning and nothing that works today moves.
A scheme another plugin already registered, and a reserved one (`file`, and anything on `ahp-`), is refused when the plugin is applied.

Source: the user, 2026-09-23, asked which route the plan should take and answered "The provider mechanism".

## Consequences

Two plugins can each own a scheme, and neither has to wrap the filesystem store or know that it exists.
`createHost` gains one routing step every resource command goes through, which is the cost: the handlers no longer call a single store, and the client-relay precedence at `:7191` has to stay ahead of them.
A URI nobody registered answers the sentence `fileResources` already writes for a foreign scheme, so it reads as somebody else's rather than as a bad path.
Discovery does not follow from this: a client still has to be told which URI to ask for, which the research names and this decision does not solve.

## Options

- **Let a plugin replace the file store and wrap it.** It works today, and it is rejected as the only route rather than as a technique: two plugins that each want a scheme cannot both have one, and every provider author reimplements the file half they are wrapping.
- **A read-only `computer_status` server tool and no resource change.** Rejected as the first step here: it answers an agent on demand and gives a client nothing to browse, and the master it would call is not in this repository, so it is not self-contained.
- **One store interface with many schemes inside it, routed by the plugin.** Rejected: the plugin would own the routing, so the host could not report an unknown scheme, refuse a reserved one, or keep the client relay ahead of it.
