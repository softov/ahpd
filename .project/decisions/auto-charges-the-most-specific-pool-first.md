---
title: A user with no charge rule is charged to the most specific pool first
status: accepted
date: 2026-10-02
refs:
  - "[code://packages/sdk/src/types/usage.ts](../../packages/sdk/src/types/usage.ts) - the pools a record is charged to: `user:`, `team:<t>`, `project:<t>:<p>`, `root:<host>`"
---

## Context

A charge rule says which pools pay for a person's work and in what order.
Most people will have none, and `auto` is what they get.

## Decision

`auto` walks the pools from the most specific to the least: the user, the project, the team, then everyone, and any one pool that allows the work is enough.
Source: Softov, 2026-10-02, asked "what does a user's `auto` charge order mean, when they have no charge rule of their own?": "Most specific first".

## Consequences

A person's own allowance is spent before their project's, and a team's before the host's.
A team cannot set an order for its people without giving each a charge rule.

## Options

- **The primary team's charge rule**: rejected, it ties a person's order to one team when work names a team per request.
