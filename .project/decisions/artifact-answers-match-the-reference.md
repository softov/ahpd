---
title: Artifact tool answers are the reference's, status and id only
status: accepted
date: 2026-09-19
refs:
  - code://packages/sdk/src/artifacttools.ts#L178-L196 - the answers as they are written today, which name the entry
  - src/vs/platform/agentHost/node/shared/artifactServerTools.ts#L210-L240 - the reference answers, which name the status and the id, inside the clone
---

## Context

The three artifact tools were taken from the reference host deliberately, names and input schemas included, so that a skill or a prompt written for VS Code's host works against this one unchanged.
Their answers had drifted: the reference returns `Added artifact: <id>`, `Promoted artifact: <id>`, `Already recorded: <id>` and so on, and this host returns the id with the entry's type, label and value spelled out, because it answered with `describe(entry)`.
That is the text a model reads back, so the same call reads differently depending on which host is underneath it, which is the one thing taking the names was meant to prevent.

Asked on 2026-09-19 what the tools should return, the answer was: "Match the reference exactly: `<status>: <id>`."

## Decision

Every artifact tool answer is a status and an id, exactly as the reference writes it: `Added artifact`, `Added reference`, `Promoted artifact`, `Already recorded`, `Removed artifact`, `Removed reference`, each followed by `: <id>`.
The entry's type, label and value stop being part of an answer, and `list_artifacts_and_references` keeps describing entries because that is what a list is for.

## Consequences

A skill that reads an answer can read it on both hosts, and an answer no longer carries a value that may contain a newline or a path a model would rather not repeat.
Anything here that asserted on the old strings moves, and a person reading a transcript sees an id where they used to see what was recorded, which is a deliberate loss of comfort for parity.

## Options

Keeping the descriptive answers and only adding promotion was rejected: it fixes the state transition and leaves the two hosts answering the same call differently.
Returning an id for promotion and descriptions elsewhere was rejected: it is the smallest diff and the hardest contract to state in one sentence, which is what a tool contract has to be.
