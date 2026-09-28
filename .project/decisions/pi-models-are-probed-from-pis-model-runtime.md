---
title: pi's models are probed from pi's model runtime, before any session opens
status: accepted
date: 2026-09-28
refs:
  - "[code://packages/agent-pi/src/agent.ts#L95-L105](../../packages/agent-pi/src/agent.ts#L95-L105) - `probe`, which answers no models"
  - "[code://packages/sdk/src/host.ts#L2135-L2150](../../packages/sdk/src/host.ts#L2135-L2150) - the host probes every agent at boot and keeps a non-empty model list"
  - "[code://packages/sdk/src/host.ts#L2050-L2067](../../packages/sdk/src/host.ts#L2050-L2067) - `learnModels`, which a session's handshake calls later"
  - npm://@earendil-works/pi-coding-agent@^0.87.1 - `createAgentSessionServices` builds `ModelRuntime.create({ authPath, modelsPath })` from the agent directory, in `dist/core/agent-session-services.js`
---

## Context

A client draws its model picker from the models the host holds for an agent.
agent-pi's `probe` answers none, because pi's model list was thought to come from a runtime built with a session.
So the picker is empty until a pi session has run a turn, and empty again after every restart.
pi builds its `ModelRuntime` from the agent directory's `auth.json` and `models.json`, and only a project's own extensions add providers per directory.

## Decision

agent-pi's `probe` builds pi's `ModelRuntime` from the agent directory, as pi's own services do, and answers its available models.
A session's handshake still refreshes the list, which is where a project extension's providers arrive.

Source: Softov, 2026-09-28, asked how the probe should answer pi's models before any session: "Probe reads pi's ModelRuntime".

## Consequences

The picker has pi's models at boot and after a restart.
A provider only a project extension registers appears once a session in that project opens.
The probe reads pi's credentials file at boot.

## Options

- **Keep the probe empty**: the list is always exactly a session's, but the picker is empty until a turn has run.
