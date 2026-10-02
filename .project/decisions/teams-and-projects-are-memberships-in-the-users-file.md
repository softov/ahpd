---
title: Teams and projects are memberships in the users file, written team:project
status: accepted
date: 2026-10-01
refs:
  - "[code://packages/sdk/src/types/users.ts#L157-L162](../../packages/sdk/src/types/users.ts#L157-L162) - `UserFile`, which already holds roles beside people"
  - file:///github/ahp-review/prospect/ahp-user-rules.md - the usage rules, whose scopes these are
---

## Context

Usage is charged to a user, a team and a project, and none of the last two exists.
A person's teams and projects are not independent: someone may work on any project of one team and only one project of another.
A project is not a folder; it may span several repositories or none.

## Decision

A team and a project are named entries in the users file, beside roles.
A person holds `memberships`, each written `team:project`, `team:*` (any project of that team, which a request must then name) or `team` (team work with no project).
Roles stay permissions only; a membership grants nothing and only says what a person's work may be charged to.
Source: Softov, 2026-10-01: "backend:* -> team backend in any project; frontend:controllr -> team frontend project controllr"; then asked "Membership entries: which forms are allowed?": "team:project, team:*, team"; and "Where are teams, projects and memberships defined?": "In the users file".

## Consequences

One file is read on every question, as roles are, so a membership change lands on the next request.
A team and a project used together never form a pair the person does not belong to.

## Options

- **Separate team and project lists on the person**: rejected, they cannot say "any project of backend, only controllr of frontend".
- **Their own file and port**: rejected, one more store for what the users file already holds the shape of.
