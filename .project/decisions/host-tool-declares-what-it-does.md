---
title: A host tool says what running it does, so a policy can ask about it
status: accepted
date: 2026-09-20
refs:
  - code://packages/sdk/src/types/host.ts#L279-L332 - `HostTool`, which gains the hint
  - code://packages/agent-cofold/src/tools.ts - where a bound tool is wrapped, and where the hint reaches facio
  - file:///github/cofold/packages/agents/src/types/tool.ts - `ToolEffects`, the same four flags
  - file:///github/cofold/packages/agents/src/policy/rules.ts - the default that asks when a tool is destructive
  - code://.project/plans/plugin/04-agent-cofold-extras/plan.md - where this is implemented
---

## Context

A `HostTool` is a tool the host contributes, and the protocol has no place to say what running it does to the world.
A backend that runs one therefore cannot tell a read from a delete, and the only prompt for a person is the tool's own name and description.
facio models exactly this: `ToolEffects` is `reads`, `writes`, `network` and `destructive`, and its default policy asks a person when `destructive` is true.
Because a host tool carries none of that, `@ahpd/agent-cofold` cannot let facio's default ask about a host tool, so a daemon configured only from a JSON file - which cannot carry a policy function - can never raise an approval for one.

## Decision

`HostTool` gains an optional `effects` of the four booleans, `reads`, `writes`, `network` and `destructive`, with nothing set when a tool does not say.
The facio bridge passes it through to `createTool`, so a tool marked `destructive` is asked about by facio's own default policy and no policy function is needed.
There is no policy object in configuration and no second policy language: the hint is the host's claim about its own tool, and what a policy does with it stays the policy's business.

## Consequences

A daemon configured only from a file can have a destructive host tool gated, because the hint travels with the tool rather than with a callback.
A tool that says nothing behaves exactly as it does today, so every existing tool is unaffected.
The four flags are facio's spelling, so the bridge needs no translation and another backend may ignore them or read them its own way.
The flags are a claim and not a guarantee: a tool that lies about being destructive is asked about no more than it says, which is the same trust a tool already has to be run at all.

## Options

- **A single `destructive` boolean.**
  Rejected: `writes` and `network` are what a changeset or a network policy would key on, facio already models all four, and four booleans are one field either way.
- **A policy object in the configuration file.**
  Rejected: it is a policy language to document, validate and version, and the decision that a policy is a function is already made.
- **Keep the policy seam only, and require an embedder.**
  Rejected: a daemon is configured by a person with a JSON file, and a capability only an embedder can reach is one the daemon does not have.
