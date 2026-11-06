import { isRecord, recordsChannel } from '@ahpd/sdk';
import type { RecordsChannel } from '@ahpd/sdk';
import { claimedOf } from './runtime.js';
import type { ComputerRuntime } from './runtime.js';

/**
 * The `x-ahpd-computers://` channel: every machine with its state, kept current.
 *
 * A subscribe answers `{ records }`, each entry `{ id, record }` where the
 * record is `{ state, status }`: `state` is what `computer://<id>/state` reads,
 * where the runtime gives one, and `status` is what `computer://<id>/status`
 * reads. `added`, `changed` and
 * `removed` follow it, as every records channel sends them. A subscription to
 * `x-ahpd-computers://?owner=me` is the caller's own machines.
 *
 * The runtime is the record of truth and has no event stream, so the channel
 * hears what `refresh` is called for: the changes this plugin makes, and a
 * pass every `CATALOGUE_PASS_MS` for the changes made outside it.
 */

/** The channel's scheme. */
export const COMPUTERS_SCHEME = 'x-ahpd-computers';

/**
 * How often the channel is read again for the changes made outside this
 * plugin: VS Code's periodic pass over a catalogue whose source can change
 * without telling it, five minutes.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostCatalogReconciliationService.ts#L22
 */
export const CATALOGUE_PASS_MS = 5 * 60 * 1000;

/**
 * The channel over this runtime, which reading needs `computer:read` for.
 *
 * `onProblem` hears a refresh that could not read the runtime.
 */
export const computerCatalogue = (
  runtime: Pick<ComputerRuntime, 'list' | 'inspect' | 'state'>,
  onProblem?: (line: string) => void,
): RecordsChannel =>
  recordsChannel(COMPUTERS_SCHEME, {
    ids: async () => (await runtime.list()).map((one) => one.id),
    find: async (id) => {
      const status = await runtime.inspect(id);
      if (status === undefined) return undefined;
      /*
       * The state is the runtime's own answer rather than a word read out of
       * the record beside it: a client round-trips this one, and a runtime
       * whose machine carries no Docker record answers it too. A runtime that
       * gives none leaves it out.
       */
      const state = await runtime.state(id);
      return { ...(state === undefined ? {} : { state }), status };
    },
  }, {
    grant: 'computer:read',
    /*
     * Whose a machine is, read off the record the channel already holds.
     *
     * The status is the machine's own `inspect`, which is where its owner label
     * lives, so a subscription asking for `?owner=me` narrows to the caller's
     * machines without asking the runtime a second time.
     */
    ownerOf: (_id, record) => (isRecord(record.status) ? claimedOf(record.status).owner : undefined),
    describe: () => ({ title: 'Computers', description: 'Every machine this host serves, with its state.' }),
    ...(onProblem === undefined ? {} : { onProblem }),
  });
