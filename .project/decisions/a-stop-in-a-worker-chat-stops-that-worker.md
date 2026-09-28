---
title: A stop in a worker chat stops that worker, and an option makes it stop the session
status: accepted
date: 2026-09-28
refs:
  - "[code://packages/sdk/src/host.ts#L8835-L8847](../../packages/sdk/src/host.ts#L8835-L8847) - a worker chat's `chat/turnCancelled`, which cancels the lead turn today"
  - "[code://packages/agent-claude/src/session.ts#L2514](../../packages/agent-claude/src/session.ts#L2514) - `task_started`, which names the task a worker runs as"
  - npm://@anthropic-ai/claude-agent-sdk@0.3.278 - `Query.stopTask(taskId)`, which stops one task and emits its `task_notification` as `stopped`
---

## Context

claude/04 task 17 made a stop given in a subagent's chat cancel the lead turn, because the backend had no way to stop one worker.
Softov stopped inside a subagent in ahpapp and the main session stopped, and said it could be configurable.
The Claude SDK can stop one task with `stopTask(taskId)`, and a worker's `task_started` names its task id.

## Decision

A stop given in a worker chat stops only that worker, through the backend's own per-worker stop, and the lead turn goes on.
An agent-claude option makes a worker chat's stop cancel the lead turn instead, as it does today.
A stop in the lead chat is unchanged.
Source: Softov, 2026-09-28, asked "What should a stop in a worker chat do?": "Worker, configurable (Recommended)", the option described as "Stops only that worker via stopTask by default; an agent-claude option makes it stop the session instead. The lead chat's own stop is unchanged."

## Consequences

A person can stop a runaway subagent without losing the turn that started it, and the lead model sees the worker's call end as stopped.
The host needs a way to ask a backend to stop one worker, and a backend without one keeps the lead-turn stop.
The claude/04 row that routes a worker chat's `chat/turnCancelled` to the lead turn is now the option's behaviour, not the default.

## Options

- **Stop the session, configurable.** Today's behaviour stays the default, which is what surprised Softov.
- **Stop the worker, with no option.** Simpler, but a person who wants one Stop to halt everything from any chat has no way to ask for it.
