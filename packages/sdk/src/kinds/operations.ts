/**
 * The operations a channel lists in its state, and the one command that runs them.
 *
 * A channel whose state carries `operations` offers what a client may do to it,
 * as a changeset's state does: each operation has an `id`, a `label`, the grant
 * a caller needs, the `scopes` it takes and, where it asks for one, an `input`
 * JSON Schema. A tunnel list offers the host's four kinds of operation beside
 * the ones each kind declares, and a computer list may offer its own.
 *
 * One command serves every channel that has operations: `x-ahpd/invokeOperation`
 * takes `{ channel, operationId, target?, input? }`. It copies
 * `invokeChangesetOperation`'s checks - the operation has to be one the channel
 * lists *now*, an operation on one record takes `target: { id }`, a `list`
 * operation takes no target - and adds the two a tunnel needs: the `input` is
 * checked against the operation's own schema, and the operation's status is set
 * while it runs, so every subscriber sees the call.
 *
 * The command's own grant is `operation:invoke`, and a caller who holds the
 * operation's grant is let in without it: a person who may change the tunnels
 * may run a change to one, and needs no second grant to do it. Each operation
 * still needs its own grant, so `operation:invoke` alone runs none of them.
 *
 * The command never runs an operation itself. It finds the channel, checks what
 * the call says, and hands the operation to the channel, which answers with the
 * record, or `{}` for an operation that removed it.
 */

import { refusalReason } from '../host/gate.js';
import { HOST_CATALOGS, translated, type Catalogs } from '../i18n.js';
import { INTERNAL_ERROR, INVALID_PARAMS, RpcError } from '../rpc.js';
import type { Operation } from '../types/kinds.js';
import type { RecordsChannel } from '../resources/recordschannel.js';
import type { ChannelHandle, PluginMethod } from '../types/plugin.js';
import type { Grant, Principal } from '../types/users.js';

/**
 * Where one operation's text is: the field path before `label`,
 * `description` or `confirmation`, and the catalogs read for it, first first.
 */
export interface OperationText {
  path: readonly string[];
  catalogs: readonly (Catalogs | undefined)[];
}

/**
 * The operations as a reader in `locale` reads them.
 *
 * Each label, description and confirmation is looked up at its field path, and
 * keeps its English where no catalog has it. A field an operation does not
 * have stays absent. No locale is English, as for every other text.
 */
export const operationsIn = (
  operations: readonly Operation[],
  locale: string | undefined,
  textOf: (operation: Operation) => OperationText,
): Operation[] => {
  if (locale === undefined) return [...operations];
  return operations.map((operation) => {
    const { path, catalogs } = textOf(operation);
    const text = (field: string, english: string): string => translated([...path, field], english, locale, ...catalogs);
    return {
      ...operation,
      ...(operation.label === undefined ? {} : { label: text('label', operation.label) }),
      ...(operation.description === undefined ? {} : { description: text('description', operation.description) }),
      ...(operation.confirmation === undefined ? {} : { confirmation: text('confirmation', operation.confirmation) }),
    };
  });
};

/**
 * The text of one of the host's own operations: `operations.<row>.<name>` in
 * the host's catalogs, where `<name>` is the id after its kind, so a tunnel's
 * `devtunnel/remove` reads `operations.tunnel.remove`.
 */
export const hostOperationText = (row: string) => (operation: Operation): OperationText => ({
  path: ['operations', row, operation.id.slice(operation.id.lastIndexOf('/') + 1)],
  catalogs: [HOST_CATALOGS],
});

/**
 * A records channel whose snapshot lists its operations beside the records, in
 * the reader's locale, as the tunnel and client lists do. A client draws a
 * row's buttons from this list, and the row's `operations` names which apply.
 */
export const withOperations = (
  records: RecordsChannel,
  operations: () => Operation[],
  textOf: (operation: Operation) => OperationText,
): RecordsChannel => {
  let handle: ChannelHandle | undefined;
  return {
    ...records,
    channel: {
      ...records.channel,
      snapshot: async (asked, reader, client) => {
        const state = await records.channel.snapshot(asked, reader, client) as Record<string, unknown>;
        return { ...state, operations: operationsIn(operations(), handle?.localeOf?.(client), textOf) };
      },
    },
    bind: (given) => {
      handle = given;
      records.bind(given);
    },
  };
};

/** The grant the one command needs, and the name it is served under. */
export const OPERATION_COMMAND = 'x-ahpd/invokeOperation';
export const OPERATION_GRANT = 'operation:invoke' as Grant;

/**
 * One channel that lists operations, as the command reads it.
 *
 * The host keeps who may run what: `begin` and `settle` are where a list
 * operation's status lives, and a tunnel operation's `operation` field, so a
 * caller is never told more than the channel's readers are.
 */
export interface OperationChannel {
  /** The channel URI the state is read at, such as `x-ahpd-tunnels://`. */
  uri: string;
  /** Every operation the channel offers now, each with its status. */
  operations(): Operation[];
  /** Say one operation has started, on a record or on the list when there is none. */
  begin(operationId: string, target: string | undefined): void;
  /** Say one operation is done, or failed with its error. */
  settle(operationId: string, target: string | undefined, error?: string): void;
  /**
   * Whether one record offers an operation now, as its `operations` says.
   *
   * Asked after the target is read and before the input is checked or the call
   * begins. Absent, a channel takes every operation it lists on any target.
   */
  offers?(target: string, operationId: string): boolean | Promise<boolean>;
  /** Do what the operation says, and answer the caller with the record or `{}`. */
  run(
    operation: Operation,
    target: string | undefined,
    input: Record<string, unknown> | undefined,
    reader: Principal | undefined,
  ): Promise<unknown>;
}

/** How the command finds a channel and checks what it was sent. */
export interface InvokeOperationOptions {
  /** Every channel that offers operations, by URI, read at each call. */
  channels(): Record<string, OperationChannel>;
  /**
   * Check one value against an operation's schema, throwing the first finding.
   *
   * Taken as an option rather than imported: the sdk takes no third-party
   * runtime, and the schema checker the daemon uses belongs to the server.
   */
  check(value: unknown, schema: Record<string, unknown>, label: string): void;
  /** Where a failed operation is said, as one line. */
  onProblem?(message: string): void;
}

/**
 * The target an operation takes, or a refusal saying which scope it has.
 *
 * Every scope but `list` names one thing, so any of them takes `target: { id }`
 * and no scope is special-cased here: a `tunnel` operation and a `client` one
 * are checked the same way, and the refusal says which it was.
 */
const targetOf = (operation: Operation, asked: unknown): string | undefined => {
  const scope = operation.scopes.find((one) => one !== 'list');
  if (asked === undefined) {
    if (scope !== undefined) throw new RpcError(INVALID_PARAMS, `${operation.id} runs on one ${scope}, so it needs target.id`);
    return undefined;
  }
  if (scope === undefined) throw new RpcError(INVALID_PARAMS, `${operation.id} runs on the list, so it takes no target`);
  const raw = typeof asked === 'object' && asked !== null && !Array.isArray(asked)
    ? asked as Record<string, unknown>
    : undefined;
  const id = raw?.id;
  if (typeof id !== 'string' || id === '') {
    throw new RpcError(INVALID_PARAMS, `${operation.id} runs on one ${scope}, so it takes target: { id }`);
  }
  return id;
};

/** The input an operation takes, checked against its schema, or a refusal. */
const inputOf = (
  operation: Operation,
  asked: unknown,
  check: InvokeOperationOptions['check'],
): Record<string, unknown> | undefined => {
  if (asked === undefined) {
    // A schema's own required fields are asked of a form with nothing filled in.
    if (operation.input !== undefined) check({}, operation.input, `${operation.id}'s input`);
    return undefined;
  }
  if (typeof asked !== 'object' || asked === null || Array.isArray(asked)) {
    throw new RpcError(INVALID_PARAMS, `${operation.id} takes input as a JSON object`);
  }
  const input = asked as Record<string, unknown>;
  if (operation.input !== undefined) check(input, operation.input, `${operation.id}'s input`);
  return input;
};

/**
 * The `x-ahpd/invokeOperation` command over the channels that offer operations.
 *
 * The command is synchronous in what it refuses: the channel, the operation and
 * the target are all read before anything runs. The operation's own work is
 * awaited, and its status is `running` from the moment it starts to the moment
 * it answers, or to `error` with its message when it throws.
 */
export const invokeOperation = (options: InvokeOperationOptions): PluginMethod => ({
  grant: OPERATION_GRANT,
  authorize: async (params, reader) => {
    const uri = typeof params.channel === 'string' ? params.channel : '';
    const channel = options.channels()[uri];
    if (channel === undefined) return false;
    const operationId = typeof params.operationId === 'string' ? params.operationId : '';
    const offered = channel.operations().find((one) => one.id === operationId);
    return offered !== undefined && reader.can(offered.grant as Grant);
  },
  describe: () => ({
    title: 'Invoke an operation',
    description: 'Runs one operation a channel offers now, with the input it asks for.',
  }),
  handle: async (params, reader) => {
    const uri = typeof params.channel === 'string' ? params.channel : '';
    const channel = options.channels()[uri];
    if (channel === undefined) throw new RpcError(-32001, `No channel with operations at ${uri}`);
    const operationId = typeof params.operationId === 'string' ? params.operationId : '';
    const operation = channel.operations().find((one) => one.id === operationId);
    if (operation === undefined) {
      throw new RpcError(INVALID_PARAMS, `No operation called ${operationId} on ${uri}; one the list offers now can be run`);
    }
    // The gate admitted the command; the operation is checked here. No reader
    // is the root connection, or a host with no users directory.
    const grant = operation.grant as Grant;
    if (reader !== undefined && !reader.can(grant)) throw new RpcError(-32009, refusalReason(reader.id, grant), {});
    const target = targetOf(operation, params.target);
    if (target !== undefined && channel.offers !== undefined && !(await channel.offers(target, operationId))) {
      throw new RpcError(INVALID_PARAMS, `${operationId} is not offered on ${target} now`);
    }
    const input = inputOf(operation, params.input, options.check);
    channel.begin(operationId, target);
    try {
      const answer = await channel.run(operation, target, input, reader);
      channel.settle(operationId, target);
      return answer;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      channel.settle(operationId, target, message);
      options.onProblem?.(`${operationId} on ${uri} failed: ${message}`);
      // With the channel's code and data when it chose them: a refusal a
      // client branches on is more than its message.
      const chosen = error as { code?: unknown; data?: unknown };
      if (typeof chosen.code === 'number') throw new RpcError(chosen.code, message, chosen.data);
      throw new RpcError(INTERNAL_ERROR, message);
    }
  },
});
