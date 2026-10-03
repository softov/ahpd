---
title: The computer form offers a folder as a flat source choice
status: todo
depends: [task-01-made-from-a-folder.md]
layer: "computer"
refs:
  - "[code://packages/computer/src/manifest.ts#L209](../../../../packages/computer/src/manifest.ts#L209) - `MANIFEST_SCHEMA`, the flat properties the form is drawn from"
  - "[code://packages/computer/src/manifest.ts#L393](../../../../packages/computer/src/manifest.ts#L393) - `devcontainerOf`, which accepts only `{ folder }`"
  - "[code://packages/computer/src/manifest.ts#L501](../../../../packages/computer/src/manifest.ts#L501) - the \"names both\" refusal"
---

## Objective

The manifest schema offers a `source` choice (`image` or `devcontainer`), which it has not today, and a flat string field for the folder, so ahpapp draws it with no change of its own: its form reads only flat properties (`type`, `enum`, `x-choices`, `default`).
This applies [The computer form offers a folder as a flat source choice](../../../decisions/the-computer-form-offers-a-folder-as-a-flat-source-choice.md).

## Files

- `UPDATE: packages/computer/src/manifest.ts:209` - `source` (`enum` with `x-choices`, default `image`) and a string field for the folder; the key is not `folder`, which is plugin/16's host mount.
- `UPDATE: packages/computer/src/manifest.ts:393` - `devcontainerOf` accepts the string the form sends as well as `{ folder }`.
- `UPDATE: packages/computer/src/manifest.ts:501` - with `source: devcontainer`, an `image` equal to the host's default is the form's untouched default and is ignored; any other image is still refused.
- `UPDATE: packages/computer/test/computer-devcontainer.test.ts` - the cases below.

## Steps

1. The form sends every value as a string and an untouched field's `default`, so the body a form makes is the shape to accept.
2. Nothing in ahpapp changes.

## Validation

- A body `{ source: "devcontainer", <folder key>: "/w", image: "<default>" }`, as ahpapp sends it, makes a dev container; today it is refused, so the case fails.
- `{ source: "devcontainer", image: "other" }` is still refused with the "names both" sentence.

## Resume

Blocked on 2026-09-26 because ahpapp cannot draw a `oneOf`; Softov chose the flat source choice instead, so no ahpapp change is needed.
