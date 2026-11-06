---
title: The docs say how plugins and connectors are seen
status: done
depends: [task-03-shipped-plugins-declare-contracts.md, task-04-a-client-lists-the-plugins.md, task-08-a-webhook-endpoint-is-a-connector.md]
layer: "docs"
refs:
  - "[code://docs/plugins/PLUGINS.md](../../../../docs/plugins/PLUGINS.md) - the registration kinds and the `ahpd` field"
  - "[code://docs/plugins/WEBHOOKS.md](../../../../docs/plugins/WEBHOOKS.md) - how an endpoint is made today"
  - "[code://CHANGELOG.md](../../../../CHANGELOG.md) - the release notes"
---

## Objective

The docs say how a plugin declares its manifest, how a client sees plugins and connectors, and how a webhook endpoint is made now.

## Files

- `UPDATE: docs/plugins/PLUGINS.md` - the manifest fields, the contracts, `registerConnector` and the two channels.
- `UPDATE: docs/plugins/WEBHOOKS.md` - make an endpoint as a `webhook` connector.
- `UPDATE: CHANGELOG.md` - the break: old `webhooks/<id>.md` files are no longer read.
- `UPDATE: .project/plans/plugin/00-plugin.md` - check the glossary entries against what was built.
- `UPDATE: .project/plans/index.md` - the plan row.

## Steps

1. Add a manifest section to `PLUGINS.md`, with one package.json example and one module example.
2. List the contract keys, and say what a refused registration prints.
3. Add `registerConnector` to the list of registration kinds, with one kind example.
4. Describe `x-ahpd-plugins` and `x-ahpd-connectors`, with their methods and grants.
5. Rewrite how to make an endpoint in `WEBHOOKS.md`, with a `put` example.
6. Add the break to `CHANGELOG.md` first, with the steps to make each endpoint again.
7. Set this task and the plan row to `implemented`.

## Validation

- `pnpm -s docs:build` passes, if the repository has the script.
- Every example in the docs matches a test case of tasks 01 to 08.

## Resume

- **Done so far:** `PLUGINS.md` has a connector-kind section, and `## The manifest` is rewritten with one package.json example and one module example.
  `### The contracts` holds the key-to-method table and both refusal lines.
  `## What a client sees` describes `x-ahpd-plugins` and `x-ahpd-connectors`, with their methods and their grants.
  `WEBHOOKS.md` makes an endpoint a `webhook` connector: a JSON record, the field table, the vault names and the states.
  It has one `put` example for a bot endpoint, and one for an automation.
  `CHANGELOG.md` opens a `0.14.0 - unreleased` section whose `### Upgrading` is the break, with a `put` call that makes each endpoint again.
  `00-plugin.md` has a `connector kind` row in the registration kinds table, a plan 53 bullet, and `revalidated: 2026-10-21`; its glossary already said what was built.
  `index.md` has the plan 53 row at `active`, nine tasks implemented.
- **Next action:** none; the plan's final verification checklist is for Softov to run.
- **Open questions:** none.
- **Departures:**
  - The changelog entry is its own section, `0.14.0 - unreleased`, above `0.13.0`.
    The packages are still at 0.13.0, so that version is what the work is released as, not one cut here.
  - The `00-plugin.md` registration table gains a row, and the domain file gains a bullet for this plan.
    The glossary entries were checked and needed no change.
  - The plan's `status` moves from `draft` to `active`, not to `built`, because the final verification checklist is unchecked.
    The task statuses stay at `implemented`, as the plan's rule says.
- **Watch out for:** the docs say what a feature does; the reasons are in the plan's answers.
