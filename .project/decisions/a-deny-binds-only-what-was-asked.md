---
title: A deny binds only when everything it names was asked, while an allow skips what was not asked
status: accepted
date: 2026-10-02
refs:
  - "[code://packages/sdk/src/decide.ts](../../packages/sdk/src/decide.ts) - `matched`, where a row is held against what a request named"
  - "file:///github/ahp-review/prospect/ahp-user-rules.md - examples 15 and 21"
---

## Context

A session is created before anybody names a model, so its check asks about the harness and the machine only.
An allow row that names a model has to be a candidate there, or nobody could start a harness whose policy lists its models (example 15).
Read the same way, a deny row naming a harness and a model (`A5`: any agent with `anthropic/fable-5`) refuses the whole session, so a person kept off one model cannot start the harness at all.

## Decision

A value type a row names and the request did not is skipped for an allow and fails the match for a deny.
An allow is a candidate on what was asked; a deny is a candidate only when every value type it names was asked, so `A5` refuses the turn on that model and not the session.
Source: Softov, 2026-10-02, asked "How should a deny row treat a value the request has not named yet?": "Deny needs it asked".

## Consequences

The two effects read a row differently, and a reader of `matched` has to know that.
A deny meant to refuse a session outright names only what a session is asked about: the harness and the machine.

## Options

- Skip an unasked value for both effects: `A5` refuses at creation, and a deny that refuses a turn has to name the model alone.
