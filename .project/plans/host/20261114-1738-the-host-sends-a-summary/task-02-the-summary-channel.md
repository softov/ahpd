---
title: The summary channel
status: todo
depends: [task-01-a-records-channel-has-a-listing.md]
layer: sdk
refs:
  - "[code://packages/sdk/src/connectors/channel.ts#L669-L678](../../../../packages/sdk/src/connectors/channel.ts#L669-L678) - the once a second timer this channel copies"
  - "[code://packages/sdk/src/access/me.ts#L73-L77](../../../../packages/sdk/src/access/me.ts#L73-L77) - a grant with `authorize` that lets every connection in"
---

## Objective

`x-ahpd-summary://` answers each reader the summary of the areas they may open, and sends it again one second after a change.

## Files

- `CREATE: packages/sdk/src/summary/channel.ts` - the summary channel over a list of areas.
- `UPDATE: packages/sdk/src/resources/recordschannel.ts:443-460` - `servedRecords` takes any channel with a scheme, a channel and a bind.
- `UPDATE: packages/sdk/src/index.ts` - export the summary channel and its types.
- `CREATE: packages/sdk/test/summary-channel.test.ts` - cases for the summary.

## Steps

1. Give each area a name, its records channel, the field that holds its state, and whether it counts alerts.
2. Make an area entry from the channel URI, the total, the counts by state and the alert counts by level.
3. Leave out an area that the reader does not open and has no readable row in.
4. Answer the snapshot as `{ areas }` for the reader.
5. On a refresh of an area, mark it changed and start a one second timer if none runs.
6. When the timer ends, read the changed areas and send `x-ahpd-summary/changed` with `{ areas }` to each reader whose summary moved.
7. Forget a client's last summary when it leaves.
8. Write the test cases with fake timers.

## Validation

- `packages/sdk/test/summary-channel.test.ts`: the counts, the absent area and the rows of each reader.
- The same file: the one second batch, the constant stream, and no send when nothing moved.
- `pnpm typecheck` passes.

## Resume
