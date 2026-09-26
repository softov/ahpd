---
title: The computer form offers a folder as the source
status: todo
depends: [task-01-made-from-a-folder.md]
layer: "computer"
refs:
  - "[code://packages/computer/src/manifest.ts](../../../../packages/computer/src/manifest.ts) - the manifest the form is drawn from"
---

## Objective

The manifest schema a client draws the create form from offers a source choice, a profile or a folder with a `devcontainer.json`, so ahpapp shows it with no change of its own.

## Files

- `UPDATE: packages/computer/src/manifest.ts` - the schema.

## Steps

1. Check against ahpapp's decision `the-computer-form-is-drawn-from-the-manifest` that the form draws a `oneOf` source; if it cannot, say so in *Resume* and stop.

## Validation

- The schema test; by hand in ahpapp.

## Resume
