---
title: A model record whose harness named no model is written with an empty name
status: accepted
date: 2026-10-02
refs:
  - "[code://packages/sdk/src/meter.ts](../../packages/sdk/src/meter.ts) - the agent meter, which writes `name: ''`"
  - "[code://packages/sdk/src/types/usage.ts](../../packages/sdk/src/types/usage.ts) - `ModelCall.name`, which is required"
---

## Context

`ModelCall.name` is required, and the agent meter takes it from the report, else from the model the turn asked for.
An ACP turn where nobody picked a model has neither, yet it still reports tokens and cost.

## Decision

The meter writes such a record with `model.name: ''`, meaning the harness never said which model ran.
Source: Softov, 2026-10-02, asked "an ACP turn where nobody picked a model reports no model name, but `ModelCall.name` is required. What should the agent meter write?": "Write name ''".

## Consequences

Tokens, cost and pools stay exact, so totals agree with what the harness reported.
A reader of the store groups an empty name as an unknown model.

## Options

- **The agent's name**: rejected, it puts a value that is not a model in the model field.
- **`name` optional**: rejected, it changes the record shape usage/01 settled and the proxy also writes.
- **Drop the record**: rejected, it loses the turn's tokens and money.
