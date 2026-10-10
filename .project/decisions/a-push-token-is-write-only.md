---
title: A push token is write-only
status: accepted
date: 2026-10-10
refs:
  - "[code://packages/push/src/provider.ts](../../packages/push/src/provider.ts) - `shownOf`, which `read` and `resolve` answer through"
---

## Context

A device's Expo token is a credential to that device's notifications.
A role that may read `push:` is not the device, and grants in ahpd are role-wide.

## Decision

A read of `push://devices/<id>` answers the device's platform, language and client, and never its token.
Replace and remove stay role-wide, like the rest of the host.
Softov, 2026-10-10, asked "How should a device record be protected?": token is write-only.

## Consequences

A client cannot read a token back, so a client that lost its own token registers again.
A role with `push:` write can still replace or remove another client's device.

## Options

- Only the client that registered a device may read, replace or remove it. Not chosen: no other scheme checks the client.
- Keep the token readable by any role with `push:` read. Not chosen: it hands the credential to every such role.
