---
title: The computer form offers a folder as a flat source choice
status: implemented
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

Implemented on 2026-10-03.

Files changed:

- `packages/computer/src/manifest.ts` - `MANIFEST_SCHEMA` publishes `source` (an `enum` of `image` and `devcontainer` with `x-choices`, default `image`) right after `runtime`, and a flat `devcontainer` string field right after `image`. The key is not `folder`, which stays the host path mounted inside the machine and stays gated by `bodyMounts`. `devcontainerOf` accepts the plain string a form sends beside the `{ folder }` object a body written by hand may send, and a blank string is the field nobody filled in rather than a refusal. The "names both" refusal no longer fires for an `image` equal to `defaults.image`.
- `packages/computer/test/computer-devcontainer.test.ts` - the form's own body makes a container.
- `packages/computer/test/computer.test.ts` - the two schema key lists in "says in capabilities what a create body may contain".

What the tests cover: a body of exactly the shape ahpapp sends (every field a string, `image` carrying the host's untouched default, blank `cpus`/`memory`/`workdir`) reaches `up` with the folder and the two id labels; `source` is published with the default and `devcontainer` as a string field; an `image` somebody typed beside the folder is still refused with "names both"; and, from the review, `source: "image"` beside a folder makes an image machine and never asks the CLI, `source: "devcontainer"` with no folder is refused, and a source the host does not know is refused.

Notes and open questions:

- `source` was published and not read, which the review of this task found. It is read now: when a body carries `source`, `image` reads only the image fields and the folder beside it is ignored, `devcontainer` requires the folder and refuses a body that has none, and any other value is refused with the enum's own sentence. A body with no `source` behaves as it did. So the open question above is closed rather than deferred.
- The review also asked for the `devcontainer: false` case to publish no source fields at all, which is [task 08](task-08-only-allowed-folders-and-an-off-switch-for-every-route.md)'s off switch rather than this task's form, and is recorded in that task's Resume.
- `pnpm exec tsc --noEmit`, `pnpm boundary` and `pnpm test` green after the change (2489 tests).

### The fix turn of 2026-10-05

No code changed for this task on 2026-10-05; the hard-wrapped notes above were unwrapped.
