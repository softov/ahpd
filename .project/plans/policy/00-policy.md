---
title: Policy - what exists today
domain: policy
revalidated: 2026-10-02
---

Policy is what decides which agents, computers and models a person may use, and how much of them.
Nothing of it exists yet: roles decide whether a person may act at all (`users.ts`), and usage is recorded (the usage domain) but never limited.
The rule shape is the draft at file:///github/ahp-review/prospect/ahp-user-rules.md.

## Packages

- [`code://packages/sdk`](../../../packages/sdk) - the host, its ports and gates; the policy port and the check would live here.
- [`code://packages/server`](../../../packages/server) - the daemon configuration and the default stores.

## Contracts

- [`code://packages/sdk/src/types/plugin.ts`](../../../packages/sdk/src/types/plugin.ts) - `PortKey` and the `register*` methods.
- [`code://packages/sdk/src/types/users.ts`](../../../packages/sdk/src/types/users.ts) - `Principal`: roles through `can`, memberships and the primary.
- [`code://packages/sdk/src/scopes.ts`](../../../packages/sdk/src/scopes.ts) - the team and project a request is charged to.

## Runtime path

```
createSession -> charge (scope) -> [no policy check]
sendMessage -> uncharged refusal -> [no policy check]
```

## Tests

- [`code://packages/sdk/test/people.test.ts`](../../../packages/sdk/test/people.test.ts) - the people schemes, the pattern a policy scheme follows.

## Known gaps

- No policy store, check, limit or charge rule.
