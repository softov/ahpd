---
title: A backend that runs nested names the plugin the inner host loads
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/sdk/src/types/agent.ts#L356](../../packages/sdk/src/types/agent.ts#L356) - `runsNested`, a boolean today"
  - "[code://packages/sdk/src/nested.ts#L98](../../packages/sdk/src/nested.ts#L98) - the plugin derived as `@ahpd/agent-<provider>`"
  - "[code://packages/agent-cofold/src/agent.ts#L371](../../packages/agent-cofold/src/agent.ts#L371) - cofold's provider name, configurable"
---

## Context

The proxy asks the inner host to load `@ahpd/agent-<provider>`, derived from the outer provider name.
cofold's provider name is an option, so a cofold registered as `cofold-work` makes the inner host look for `@ahpd/agent-cofold-work`, a package that does not exist.

## Decision

`runsNested` becomes `{ plugin }`: a backend that runs nested names the plugin package the inner host loads, and the `@ahpd/agent-<provider>` convention goes.
Source: Softov, 2026-09-26, asked "Which plugin the inner host loads: the backend declares its package (for example `runsNested: { plugin }`), or the `@ahpd/agent-<provider>` convention stays, which breaks for a renamed provider?": "Backend declares it".

## Consequences

A renamed provider still loads the right package, because the package is the backend's to name, not the provider's.
`runsNested: true` is no longer a valid value; plugin load validation checks the object, and the host chooses the proxy when `runsNested` is present.
cofold declares `runsNested: { plugin: '@ahpd/agent-cofold' }`.

## Options

- **Keep the `@ahpd/agent-<provider>` convention.** Nothing to declare, and it breaks for every renamed provider and for a backend published under another scope.
