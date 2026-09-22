---
title: One computer: provider, one package, the runtime chosen by option
status: accepted
date: 2026-09-22
refs:
  - code://packages/sdk/src/plugins.ts#L52-L62 - `reservedScheme` and the per-plugin duplicate check
  - code://packages/sdk/src/plugins.ts#L120-L135 - the fold's cross-plugin conflict, which is why two packages cannot share a scheme
  - code://packages/sdk/src/types/resources.ts#L186-L211 - `ResourceProvider`, the contract a runtime implements behind
  - code://.project/plans/plugin/08-resource-providers/plan.md - the scheme this provides
  - code://docs/COMPUTER.md - the operator's half, which stays
---

## Context

The scheme is `computer:`, and a host serves one provider per scheme: `registerResourceProvider` refuses a duplicate inside a plugin and the fold reports one across plugins, so two packages that both wanted `computer:` would leave one of them unable to load.
The offered names were `@ahpd/computer-docker` and a later `@ahpd/computer-kvm`, which reads like the neighbouring agent packages - and those split two ways, which is the point.
`@ahpd/agent-claude` is named for one runtime and does not converge: a second Claude would be a second package.
`@ahpd/agent-acp` converges: it speaks one protocol, so `copilot --acp`, `codex-acp`, `gemini --experimental-acp` and `@deepseek-ai/dsh-acp` are four configuration lines rather than four packages, because they answer the same protocol.
Containers and virtual machines converge the same way at the height of `computer:`: both can be listed, described, run in and thrown away, which is the whole of what the scheme says. So the runtime is configuration, as the command is for the ACP bridge, and `capabilities` is where a client learns what the runtime behind this host can do.
What does not converge is a scheme per runtime: `docker://` and `kvm://` would coexist, and a client would have to know which runtime made a machine before it could name it, which is what `computer:` exists to avoid.

## Decision

The provider is one package, `@ahpd/computer`, and the runtime is an option: `runtime: 'docker'` today, with `kvm` as a later value that a machine may be asked for per call.
`computer://<id>` names a machine whatever made it, and the provider routes by the id it minted rather than by a scheme per runtime.
A runtime that ever deserves a package of its own takes a scheme of its own, because that is the host's rule and not a preference.

Source: the user, 2026-09-22, asked whether it should be one package per runtime and answered "I want 1 also as option".

## Consequences

One install serves every runtime, and a client that browses `computer://` sees one set of machines rather than one per scheme.
The package carries the code for each runtime it supports, which is the cost; a runtime whose dependencies are large should be loaded only when its option is used.
Adding a runtime is an option value and a module, not a release of its own, and the `capabilities` resource is where a client learns which values this host accepts.

## Options

- **One package per runtime, `@ahpd/computer-docker` and `@ahpd/computer-kvm`.** Rejected: the host refuses a duplicate scheme, so the second would not load; giving each its own scheme abandons the abstraction the research asked for.
- **One package with no runtime option, Docker only.** Rejected as the shape rather than the start: it is the same package, and leaving the runtime hard-coded is a rename of every call site the day KVM arrives.
- **A runtime registry in the SDK, with packages registering into it.** Rejected: it puts a host's machine concerns into the library that implements the protocol, and the provider contract already lives there without knowing what a container is.
