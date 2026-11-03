---
title: An absolute path after @ is read as relative
status: open
date: 2026-11-03
severity: minor
blocks: []
refs:
  - "[code://packages/sdk/src/resources/resources.ts#L239-L251](../../packages/sdk/src/resources/resources.ts#L239-L251) - `complete` joins the typed path onto `base`"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L568-L584](../../packages/sdk/src/host/sessionmethods.ts#L568-L584) - `files`, which builds the item and its attachment uri from `base`"
  - git://feb72387 - main when the problem was read
---

## Symptom

Softov saw it in a session composer on 2026-11-03.
The session folder is `/github/ahpd`.

- `@/` lists the entries of `/github/ahpd`, each as `@/<name>`.
- `@/github/ahpd/.project/review/` lists nothing.

## Cause

`complete` calls `join(base, inside)` on every typed path.
`join` does not treat an absolute `inside` as a root, so `/github/ahpd/` becomes `/github/ahpd/github/ahpd/`.
`files` then builds the attachment uri as `${base}/${path}`, which has the same fault.

## Impact

A person cannot cite a file by its absolute path with `@` or `#` in a session.

## Workaround

Type the path relative to the session folder.

## Fix

- In `complete`, look in `inside` itself when it is absolute, as `/x/` or `C:/x/`.
- In `files`, build the attachment uri from the absolute path when `path` is absolute.
- `list` checks the allowed roots, so an absolute path reaches no more than `resourceList` does.
