---
title: The docs say a delete is permanent
status: done
depends: [task-02-claude-deletes-its-transcript.md, task-03-pi-cofold-and-acp-delete-theirs.md]
layer: "docs"
refs:
  - "[code://docs/AHP.md#L74](../../../../docs/AHP.md#L74) - the `disposeSession` row"
---

## Objective

`docs/AHP.md`'s `disposeSession` row says the backend's own copy is deleted, that a listed row can be deleted, and which agents cannot.

## Files

- `UPDATE: docs/AHP.md:74`.

## Steps

1. Extend the row: the agent deletes its copy (Claude's transcript, pi's file, cofold's record, an ACP server's session when it offers `session/delete`); a listed row is deleted the same way; it cannot be undone.

## Validation

- The row reads against task 01's behaviour.

## Resume

