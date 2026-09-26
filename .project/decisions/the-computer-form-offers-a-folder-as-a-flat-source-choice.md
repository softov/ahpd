---
title: The computer form offers a folder through a flat source choice, not a oneOf
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/computer/src/manifest.ts#L188-L280](../../packages/computer/src/manifest.ts#L188-L280) - `MANIFEST_SCHEMA`, the flat properties a client draws the form from"
  - "[code://packages/computer/src/manifest.ts#L372-L404](../../packages/computer/src/manifest.ts#L372-L404) - `devcontainerOf`, which accepts only `{ folder }` today"
  - "[code://packages/computer/src/manifest.ts#L479-L481](../../packages/computer/src/manifest.ts#L479-L481) - the \"names both\" refusal"
  - "file:///github/ahpapp/src/computers.ts - `manifestFields` reads only `manifest.properties`; `manifestBody` sends strings and every untouched default"
  - "file:///github/ahpapp/.project/decisions/the-computer-form-is-drawn-from-the-manifest.md - one control per property"
---

## Context

Decision [a dev container is a computer, made from its devcontainer.json](a-dev-container-is-a-computer-made-from-its-devcontainer-json.md) says the computer form offers a folder as a source.
ahpapp draws the create form from the manifest's top-level `properties` only, one control per property: a row of choices for an `enum` with two or more values, a text field otherwise.
It draws no `oneOf`, no nested object and no field that depends on another, and it sends every value as a string, including the `default` of a field nobody touched.
The AHP protocol's own `ConfigPropertySchema` has no `oneOf` either; VS Code uses `oneOf` only as a titled single-select in elicitation forms.
A create body today names the folder as `{"devcontainer": {"folder": "/path"}}`, and `manifestOf` refuses a body that names an image beside it, which the form always does because `image` carries the host's default.

## Decision

The manifest publishes a flat `source` property, an `enum` of `image` and `devcontainer` with `x-choices` labels, and a flat string property for the dev container folder, and ahpapp draws both with no change of its own.
`manifestOf` accepts the folder as the string the form sends, beside the `{ folder }` object a body written by hand may still send.
The "names both" refusal does not fire for an `image` equal to the host's default, because that value is the form's untouched default and not a choice.
Source: Softov, 2026-09-26, asked "How should the form offer a folder? (a) a flat `source` enum plus a folder field in ahpd, which changes the body to a string and relaxes the image-conflict rule; (b) ahpapp learns `oneOf`; (c) the picker row only": "(a), in ahpd; no ahpapp change".

## Consequences

The form offers the folder with the controls it already has, and no client needs to learn a schema construct.
Every field is drawn whichever source is picked, so the image field stays visible when the folder is chosen; the host, not the form, decides which fields a source reads.
An `image` that differs from the default beside a folder is still refused, so a person who typed one is told.

## Options

- **A top-level `oneOf` of two object shapes.** Rejected: ahpapp cannot draw it, and teaching it would amend ahpapp's own decision for one field.
- **The picker row only.** Rejected: the earlier decision says the folder is offered in the form too.
