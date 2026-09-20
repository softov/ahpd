---
title: The artifact tools answer the reference's status and id, and promote a reference in place
status: todo
depends: []
layer: packages/sdk
refs:
  - code://packages/sdk/src/artifacttools.ts#L173-L193 - the ADD run, including the "Already recorded" branch this task replaces
  - code://packages/sdk/src/artifacttools.ts#L207-L215 - the REMOVE run and its answer
  - code://packages/sdk/src/artifacttools.ts#L113-L121 - `valueOf` and `describe`, which the promoted match and the list keep using
  - code://test/artifacttools.test.ts#L63-L88 - the assertions on the old strings, which move
  - code://test/host.test.ts#L6293-L6306 - the recorded-artifact test, whose "Added reference: " assertion moves
  - file:///github/externals/vscode/src/vs/platform/agentHost/common/sessionArtifactCollection.ts#L149-L175 - `add` and `addOrPromoteArtifact`, the rule to copy
  - file:///github/externals/vscode/src/vs/platform/agentHost/node/shared/artifactServerTools.ts#L212-L237 - the answers to copy, status and id
---

## Objective

`add_artifact_or_reference` promotes a value the session already holds as a reference to an artifact in place with the id it had, every add and remove answer is `<status>: <id>`, and `list_artifacts_and_references` still describes its entries.

## Files

- `UPDATE: packages/sdk/src/artifacttools.ts:173-193` - the ADD run: call `recordArtifact` per item, answer `${status}: ${artifact.id}`, and drop `describe` from this path.
- `UPDATE: packages/sdk/src/artifacttools.ts:207-215` - the REMOVE run: answer `Removed artifact: ${gone.id}` or `Removed reference: ${gone.id}`.
- `UPDATE: packages/sdk/src/artifacttools.ts:113-121` - add the exported `recordArtifact(held, one, mintId)` beside `valueOf`, and keep `describe` for the list.
- `UPDATE: test/artifacttools.test.ts:63-88` - the added, promoted, duplicate and removed answers.
- `UPDATE: test/host.test.ts:6293-6306` - the `Added reference: ` assertion becomes the status and the id.

## Steps

1. `export interface Recorded { held: Artifact[]; artifact: Artifact; status: string }` in `artifacttools.ts`.
2. `export const recordArtifact = (held: Artifact[], one: Omit<Artifact, 'id'>, mintId: () => string): Recorded`: find `same` by `valueOf`; when there is none, answer the new entry with status `Added ${noun(one.isArtifact)}`, where `made = { id: mintId(), ...one }`.
3. When `same` exists and `same.isArtifact === false && one.isArtifact === true`, replace `same` in place with `{ id: same.id, ...one }` and answer `status: 'Promoted artifact'`; every other match, including an artifact arriving as a reference, is `status: 'Already recorded'` with `same` unchanged (decision 1 and decision 2's promotion).
4. The ADD run maps `wanted` through `recordArtifact`, pushing `${recorded.status}: ${recorded.artifact.id}` per item and calling `at.setArtifacts(recorded.held)` once at the end.
5. The REMOVE run answers `Removed artifact: ${gone.id}` or `Removed reference: ${gone.id}`.
6. Leave the LIST run on `describe`, since decision 1 keeps a list describing its entries.
7. Add the promotion case to `test/artifacttools.test.ts`: add a reference, add the same value as an artifact, and assert `Promoted artifact: <the id it had>` and one entry with `isArtifact: true`.

## Validation

- `test/artifacttools.test.ts`: `adds, says what it added, and says so once for the same thing twice` now expects `Added artifact: <id>` and `Already recorded: <id>`; a new case covers `Promoted artifact: <id>` with the id unchanged, and one covers an artifact re-added as a reference staying `Already recorded`; `lists with ids, and removes by one` expects `Removed artifact: one` and keeps the list's description.
- `test/host.test.ts`: the recorded-artifact suite expects `Added reference: <id>` from the tool.
- `pnpm vitest run test/artifacttools.test.ts` green.
- `pnpm test`, `pnpm typecheck` and `pnpm boundary` green.

## Resume

