---
title: An update names the image
status: todo
depends: [task-01-a-container-daemon-writes-its-record.md]
layer: "server"
refs:
  - "[code://packages/server/src/selfupdate.ts#L172-L190](../../../../packages/server/src/selfupdate.ts#L172-L190) - `planUpdate`, where a refusal is decided before the install place is read"
  - "[code://packages/server/src/selfupdate.ts#L61-L69](../../../../packages/server/src/selfupdate.ts#L61-L69) - `refused`, the sentence for an install that cannot be replaced"
  - "[code://packages/server/test/host-update-method.test.ts](../../../../packages/server/test/host-update-method.test.ts) - the served update"
---

## Objective

`ahpd update` and a client's update of a container daemon refuse before npm runs.
The refusal says to pull the new image and start the container again.

## Files

- `UPDATE: packages/server/src/selfupdate.ts:172-190` - `planUpdate` refuses a record that names `container`, before `installPlace` runs.
- `UPDATE: packages/server/test/selfupdate-place.test.ts` - a case for the container refusal.
- `UPDATE: packages/server/test/host-update-method.test.ts` - the served update of a container daemon answers the same refusal.

## Steps

1. Add one exported sentence: `This ahpd is in a container image; pull the new image and start the container again, for example docker compose pull && docker compose up -d.`
2. Refuse in `planUpdate` when the record names `container`, after the version check and before `installPlace`.
3. Add a test that the refusal comes first, whatever `installPlace` would say.
4. Add a test that the served update answers the same sentence.

## Validation

- `packages/server/test/selfupdate-place.test.ts`: a `container` record refuses with the image sentence and reads no install place.
- `packages/server/test/host-update-method.test.ts`: the served update refuses with the same sentence.
- `pnpm test` passes.

## Resume

