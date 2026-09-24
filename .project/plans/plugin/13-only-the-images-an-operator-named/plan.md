---
title: Only the images an operator named
domain: plugin
status: built
priority: medium
created: 2026-09-24
requires:
  - plans/plugin/10-a-computer-a-person-manages/plan.md
refs:
  - "[code://packages/computer/src/manifest.ts](../../../../packages/computer/src/manifest.ts) - `manifestOf`, where the image is resolved and the dash check lives, and `MANIFEST_SCHEMA`, which advertises the field"
  - "[code://packages/computer/src/tools.ts](../../../../packages/computer/src/tools.ts) - `request_disposable_computer`, which builds a machine without a manifest and needs the same refusal"
  - "[code://packages/computer/src/plugin.ts](../../../../packages/computer/src/plugin.ts) - where the option is read, beside `mounts` and `profiles`"
  - "[code://packages/computer/src/provider.ts](../../../../packages/computer/src/provider.ts) - the three places `profiles` is threaded, which this follows"
  - "[code://docs/COMPUTER.md](../../../../docs/COMPUTER.md) - \"What a body may not say\", where this belongs"
---

## Goal

A deployment can say which images a machine may be made from, and anything else is refused with the allowed set named. Absent the option, any image is allowed, which is what every host does today.

## Why

`computer:write` lets a person name any image, and an image is code that runs on this host's Docker with whatever the profile mounts into it. A host that shares an agent configuration into its machines is a host where the image is the thing being trusted. `bodyMounts` decided what a machine may *see*; this decides what it may *be*.

## Decisions

| # | Decision | Why |
| --- | --- | --- |
| 1 | The option's presence is the switch, not a boolean | An `images` list that is absent allows anything, so nothing breaks for a host that never thought about it. Naming a set is the operator opting in. |
| 2 | The set is the option plus the default image plus every profile's image | A profile names an image because a machine is meant to be made from it; making the operator repeat it in two places is a trap. |
| 3 | Matching is component-wise, never a string prefix | A string prefix of `ghcr.io/acme` also matches `ghcr.io/acme-evil/backdoor`. Components are what the grammar has, so they are what a pattern matches. |
| 4 | Both sides normalise through Docker's own rules | `node:22`, `library/node:22`, `docker.io/library/node:22` and `index.docker.io/library/node:22` are one image - verified locally, same digest. Without folding them an operator's list refuses spellings of what it allows, which is how a feature gets turned off. |
| 5 | A pattern with no tag means any tag | Docker defaults a missing tag to `latest`; an operator writing `node` means the image, not one tag of it. |
| 6 | A `*` inside a component is refused at load | `node:22-*` is where the subtle holes live and nobody has asked for it. Refused with a sentence rather than silently read as a literal. |

## The matching rules

A reference is a registry, path components, and a tag or a digest. A pattern parses the same way. `*` matches one whole component; `**` matches any depth.

| Pattern | Allows | Refuses |
| --- | --- | --- |
| `node:22` | exactly that, in any of its four spellings | any other tag |
| `node:*` | any tag of `node` | `nodejs/node`, `node-evil/x` |
| `ghcr.io/acme/*:*` | any repo directly under `acme` | `ghcr.io/acme-evil/x` |
| `ghcr.io/acme/**` | any depth under `acme` | anything outside it |
| `*` | anything | nothing; the same as no option |

A digest reference matches on its repository, so `node@sha256:...` satisfies `node:*`.

## Tasks

| Task | Status | Notes |
| --- | --- | --- |
| 01 Parse and normalise a reference | done | `reference.ts` in the computer package: split into registry, path, tag, digest, and fold the Docker Hub aliases and the implicit `library/`. Pure, and the unit tests live on it. |
| 02 Match a pattern against a reference | done | Component-wise, with `*` and `**`. A pattern with a `*` inside a component throws, so a bad option is a startup error rather than a silent literal. |
| 03 The `images` option, resolved into a set | done | Read in `plugin.ts` with `words()`; the set is the option plus `defaults.image` plus each profile's image, deduped, order preserved. Threaded through `provider.ts` the way `profiles` is. |
| 04 Refuse in `manifestOf` | done | Beside the dash check, with the allowed set in the sentence. |
| 05 Refuse in `tools.ts` | done | `request_disposable_computer` builds a machine with no manifest, so it never sees 04. The dash check had this exact hole. |
| 06 Publish the set as an `enum` | done | Only where every entry is literal: a set with a wildcard in it is not a list of choices, and a client drawing a picker from `node:*` would offer that string. The app needs no change either way - `manifestFields` reads `enum`, and `app/computers.tsx` already draws a picker for more than one value. |
| 07 Docs | done | Under "What a body may not say" in `docs/COMPUTER.md`, beside the dash paragraph. |

## Verification

- The counterexamples are the test table: `acme-evil` against `acme/*`, the four spellings of `node:22`, a digest against a tag pattern, and a pattern with no wildcard behaving as an exact match.
- An absent option still allows anything, which is the case every existing host is in.
- Against real Docker: a refused image makes no container, and an allowed one still makes a machine.
