---
title: A computer is found by its label first
status: done
depends: []
layer: "computer"
refs:
  - "[code://packages/computer/src/runtime.ts#L1752-L1762](../../../../packages/computer/src/runtime.ts#L1752-L1762) - `containerOf` inspects the raw id first"
  - "[code://packages/computer/src/runtime.ts#L2164-L2168](../../../../packages/computer/src/runtime.ts#L2164-L2168) - `remove`, which then runs `rm -f` on what it found"
---

## Objective

`containerOf` finds a computer by this plugin's label and its `ahpd.name` first, and takes a raw id only for a container that carries this plugin's label.

## Files

- `UPDATE: packages/computer/src/runtime.ts:1752-1762` - the label lookup first; today `docker inspect <id>` is asked first and succeeds for any container, image or volume named that, so an unrelated container with the computer's name hides it, and `stop`, `restart` and `remove` (`rm -f`) act on the unrelated one.
- `UPDATE: packages/computer/test/` - the case below, with the scripted runtime the other runtime cases use.

## Steps

1. Failing case first: the scripted `docker` answers `inspect web` for an unlabelled container called `web`, and `ps --filter label=...` with the computer whose `ahpd.name` is `web` under another container name. `remove('web')` today runs `rm -f web`; after, it runs `rm -f` on the labelled one.

## Validation

- The case fails on `e1c4ccc` and passes after.
- `pnpm exec vitest run packages/computer/test/computer-*.test.ts`.

## Resume

Implemented. `containerOf` reads the record `docker inspect <id>` answers and takes that id only when the record is this host's - carrying this host's own label, or named by the record beside the configuration as one a connect adopted. A container that answers and is not this host's, and an id Docker does not know at all, are looked for by the name a create wrote, `ahpd.name`, and the name the listing gives that container is the answer. A container that is not this host's and no machine under that name answers `undefined`, which `inspect` reads as a machine that is not there, exactly as it reads a name Docker does not have; `containerOrFail` is the same lookup for the five verbs that run something - `stop`, `start`, `restart`, `remove` and `exec` - and refuses with the id rather than running at somebody else's container. An id Docker knows nothing of keeps the id, so the verb's own `No such container` is Docker's to say.

That split is what the whole-package run found: the first version threw out of `containerOf` for a name that is not this host's, and `computer-plugin.test.ts`'s `will not read, stop or destroy a container it did not make` answered that throw where a caller reading a URI gets `-32008`, because the provider asks `inspect` before it does anything. `undefined` from the lookup, and a refusal only in the verbs that act, keeps both true.

The case failed first with `rm -f web` run on an nginx container called `web` while the machine whose create name is `web` - Docker knows it as `ahpd-computer-1a2b3c4d` - was left alone. It passes now with `rm -f ahpd-computer-1a2b3c4d` and the nginx one still there.

The order inside is deliberately not "ask the label, then the id": a machine made under a name of its own is what almost every caller holds, and asking the label first would spend a second `docker` call on every `exec`, `stats` and `state` for it. The label still decides - no id is taken for a container that does not carry this host's label - and only a name the record cannot account for costs the extra call. That is a departure from the task's wording ("by this plugin's label and its `ahpd.name` first"), not from its rule, and the plan's row for it says the same thing either way.

Gates: `npx tsc -b` clean, `pnpm exec vitest run packages/computer/test/computer-*.test.ts` 17 files and 285 tests passed. The whole-package run is where the throw out of `containerOf` was caught, and it is also where `computer-uptime.test.ts`'s adopted-container case turned out to sit 0.1s under the 5s default; it now carries a 20s cap, which the file's own comment on it says why for.
