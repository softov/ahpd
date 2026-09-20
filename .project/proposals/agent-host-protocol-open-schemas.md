---
title: The shipped JSON Schemas close no object, so an invented key validates clean
target: https://github.com/microsoft/agent-host-protocol
date: 2026-09-19
refs:
  - file:///github/externals/agent-host-protocol/schema/state.schema.json - 66 `additionalProperties` entries, all `true`
  - file:///github/externals/agent-host-protocol/schema/commands.schema.json - 128 entries, all `true`
  - file:///github/ahpd/tools/schema.mjs - a downstream host generating a strict schema from the declarations to compensate
---

## Summary

The five schemas published in `schema/` describe every declared property and close none of them.
Across the set there are 481 `additionalProperties` entries and not one is `false`, so a document carrying an undeclared property validates against the schema that exists to catch exactly that.

The counts, from `@microsoft/agent-host-protocol` 0.9.0:

| Schema | `additionalProperties` entries | `false` |
| --- | --- | --- |
| `actions.schema.json` | 90 | 0 |
| `commands.schema.json` | 128 | 0 |
| `errors.schema.json` | 127 | 0 |
| `notifications.schema.json` | 70 | 0 |
| `state.schema.json` | 66 | 0 |

## Why it matters

A validator built on these schemas cannot fail for the mistake it is most likely to be pointed at.
A host can put a private key on the wire and every check passes: our own host sent an undeclared `SessionState.model` for a while, and the schema was silent about it, which is why `tools/schema.mjs` in that repository now generates its own strict schema from the package declarations with every object closed.
A second implementation, `ahpc`, does the same thing for the same reason and checks real captures against the result.

That work is duplicated, and it exists only because the published artifact is a description of the happy path.

## The tension this runs into

`_meta` is meant to be an open map, and closing objects indiscriminately would make the schemas wrong in the other direction.
So the fix is not "add `additionalProperties: false` everywhere" but "close what the declaration closes, and leave open what the protocol means to be open", which is a distinction the schemas currently do not draw at all.
Closing every declared object and keeping the documented open maps, `_meta` among them, would make the published schema as strict as the types already are.

## What is being asked

Ship a strict variant, or make the generator that produces these files emit `additionalProperties: false` wherever the declaration is a closed shape.
If the looseness is deliberate, a sentence in the README saying so would help, because as it stands a reader has to diff the schema against the types to discover that it checks nothing extra.
