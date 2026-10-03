---
title: A profile may have its machine clone from origin, with a git credential named from the vault
status: todo
depends: [task-03-the-code-arrives-by-clone.md]
layer: "computer"
refs:
  - "[code://packages/computer/src/manifest.ts#L34-L100](../../../../packages/computer/src/manifest.ts#L34-L100) - `Profile`, which gains `code` and `gitCredential`"
  - "[code://packages/computer/src/plugin.ts#L103-L141](../../../../packages/computer/src/plugin.ts#L103-L141) - `profilesOf`, where a profile's fields are read"
  - "[code://.project/plans/vault/01-secrets-live-in-a-vault-p1-the-vault-and-its-local-file/task-04-a-plugin-option-names-a-secret.md](../../vault/01-secrets-live-in-a-vault-p1-the-vault-and-its-local-file/task-04-a-plugin-option-names-a-secret.md) - a plugin option written `{ \"$secret\" }` is the secret's value when `apply` runs"
---

## Objective

A profile on another Docker with `code: "clone"` has its machine clone the repository from its `origin` remote and check out the session's branch, using a git credential the profile names from the vault as `gitCredential: { "$secret": "<scope:name>" }`.
The default stays `code: "bundle"` (task 03); the way back is task 03's bundle out, the same for both.

## Files

- `UPDATE: packages/computer/src/manifest.ts:34-100` - `Profile.code?: 'bundle' | 'clone'` and `Profile.gitCredential?: string`, documented.
- `UPDATE: packages/computer/src/plugin.ts:103-141` - read both; `gitCredential` is `writeOnly` in the schema, as a need value is.
- `UPDATE: packages/computer/src/clone.ts` - `bringIn` gains the `clone` route beside `bundle`: the machine runs `git clone` of the repository's `origin` URL with the session's branch, the credential given by name through p1's route and read by an inline credential helper from the environment, never in argv or in the clone's config.
- `UPDATE: packages/computer/test/computer-disposable.test.ts` - the cases below.

## Steps

1. `code` is read in one place, `codeRouteOf(profile)`, which answers `bundle` when it is absent; the two routes share task 03's interface, so a third can be added.
2. The `clone` route needs the session's branch on `origin`: a branch origin does not have is refused with a sentence that names the branch and says `code: "bundle"` brings it without a push.
3. The credential reaches only the clone command, by name in its environment (p1's `byName`); the helper prints it to git and nothing else, and it is not kept in the machine's environment or its git config after the clone.
4. A `clone` profile with no `gitCredential` clones without one, for a public remote.
5. A `gitCredential` that is not a `$secret` reference is refused at load, so a token is not written into config in clear.

## Validation

- With the fake Docker, a `code: "clone"` profile's create runs `git clone <origin> --branch <branch>` inside and records no credential value in any argv; the credential is in that exec's environment only.
- A branch origin does not have is refused with the sentence.
- A profile with no `code` runs task 03's bundle route unchanged.
- By hand on dev86 in task 05, once each way.

## Resume
