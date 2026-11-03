/**
 * A schema field that names a connector: the check a save makes, the choices a
 * client is sent, and the command that answers a reader's own.
 *
 * A field is marked `x-ahpd-connector`, whose value is the adapter's name or
 * `{ adapter }`. A list field may mark its `items` instead, and each entry of
 * the list is then one id. The value a record keeps is the connector's id.
 *
 * Three saves read the mark: an agent put, an automation save and a tunnel
 * save. Each one asks `connectorRefusal` and says the refusal in its own
 * words. A schema the host sends a client goes through `withConnectorChoices`,
 * which puts the host's connectors of the adapter in `enum` and their titles
 * in `enumLabels`. Where a reader may also use connectors of their own, the
 * field is marked `enumDynamic`, as the protocol marks a session setting with
 * live choices, and `x-ahpd-completions` names the command and the ref the
 * client sends back to ask for the rest.
 */

import { bag } from '../utils/values.js';
import type { ConnectorOwner, ConnectorRef } from '../types/connectors.js';
import type { PluginMethod } from '../types/plugin.js';
import type { Grant } from '../types/users.js';
import type { Owner } from '../types/usage.js';

/** The mark on a schema field that names a connector. */
export const CONNECTOR_MARK = 'x-ahpd-connector';

/** The command a client asks for a stamped field's choices, and the key the stamp is under. */
export const COMPLETIONS_COMMAND = 'x-ahpd/completions';
export const COMPLETIONS_MARK = 'x-ahpd-completions';

/** The start of a ref that names the connectors of one adapter. */
const CONNECTOR_REF = 'connector:';

/** The adapter a schema node's mark names, or nothing for a node it does not mark. */
export const markedAdapter = (node: unknown): string | undefined => {
  const wanted = bag(node)[CONNECTOR_MARK];
  const adapter = typeof wanted === 'string' ? wanted : bag(wanted)['adapter'];
  return typeof adapter === 'string' && adapter !== '' ? adapter : undefined;
};

/**
 * Whether a connector may be the one a record of `owner` names.
 *
 * The same owner, or the connector is the host's, which everyone it serves may
 * use. A record owned by `root:<host>` is the host's own and compares as the
 * host rather than as a fifth kind of owner, and a record nobody owns is host
 * work too - it reaches the host's connectors and none of a person's. A
 * `project:` owner is not the host: it reaches the host's connectors and
 * nothing else.
 */
export const sameOwnerOrHost = (connector: ConnectorOwner | undefined, owner: Owner | undefined): boolean => {
  if (connector === undefined) return false;
  if (connector === 'host') return true;
  if (owner === undefined || owner.startsWith('root:')) return false;
  return connector === owner;
};

/** One value a save may not keep, and why. */
export interface ConnectorRefusal {
  /** The schema field that holds it. */
  field: string;
  /** The id it names. */
  id: string;
  /** The adapter the field's mark asks for. */
  adapter: string;
  /** The connector with that id and adapter, when there is one and its owner is the wrong one. */
  found?: ConnectorRef;
}

/**
 * The first value of `config` a record of `owner` may not keep, or nothing.
 *
 * Each field the schema marks, and each list whose items it marks, names
 * connectors of the adapter the mark says. Each has to be one of `served` of
 * that adapter, and one `sameOwnerOrHost` lets the owner use. A value of
 * another type is the schema's own refusal, and an empty one names nothing,
 * so neither is checked here.
 */
export const connectorRefusal = (
  config: Record<string, unknown>,
  schema: Record<string, unknown>,
  served: readonly ConnectorRef[],
  owner: Owner | undefined,
): ConnectorRefusal | undefined => {
  for (const [field, property] of Object.entries(bag(schema['properties']))) {
    const one = markedAdapter(property);
    const adapter = one ?? markedAdapter(bag(property)['items']);
    if (adapter === undefined) continue;
    const value = config[field];
    const ids = one !== undefined ? [value] : Array.isArray(value) ? value : [];
    for (const id of ids) {
      if (typeof id !== 'string' || id === '') continue;
      const found = served.find((ref) => ref.id === id && ref.adapter === adapter);
      if (found === undefined) return { field, id, adapter };
      if (!sameOwnerOrHost(found.owner, owner)) return { field, id, adapter, found };
    }
  }
  return undefined;
};

/** The ref a client sends back to ask for one adapter's connectors. */
const refOf = (adapter: string): string => `${CONNECTOR_REF}${adapter}`;

/** One marked node with the host's connectors of its adapter as its choices. */
const withChoices = (node: unknown, adapter: string, served: readonly ConnectorRef[], ask: boolean): Record<string, unknown> => {
  const out: Record<string, unknown> = { ...bag(node) };
  const host = served.filter((ref) => ref.adapter === adapter && ref.owner === 'host');
  if (host.length > 0) {
    out['enum'] = host.map((ref) => ref.id);
    out['enumLabels'] = host.map((ref) => ref.title ?? ref.id);
  }
  if (ask) {
    out['enumDynamic'] = true;
    out[COMPLETIONS_MARK] = { command: COMPLETIONS_COMMAND, ref: refOf(adapter) };
  }
  return out;
};

/**
 * A copy of `schema` whose marked fields carry their choices.
 *
 * `enum` holds the host's connectors of the field's adapter, which every
 * reader may use, and `enumLabels` their titles, or the id of one with no
 * title. A field with no such connector gets no `enum`. With `ask`, the field
 * is also marked `enumDynamic` and stamped with the command and ref that
 * answer the reader's own: under `enumDynamic` the protocol reads `enum` as
 * the first choices and not the whole list. A schema with no marked field is
 * answered as it came.
 */
export const withConnectorChoices = (
  schema: Record<string, unknown>,
  served: readonly ConnectorRef[],
  ask: boolean,
): Record<string, unknown> => {
  const properties = bag(schema['properties']);
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [field, property] of Object.entries(properties)) {
    const one = markedAdapter(property);
    const items = bag(property)['items'];
    const each = one === undefined ? markedAdapter(items) : undefined;
    if (one !== undefined) {
      next[field] = withChoices(property, one, served, ask);
      changed = true;
    } else if (each !== undefined) {
      next[field] = { ...bag(property), items: withChoices(items, each, served, ask) };
      changed = true;
    } else {
      next[field] = property;
    }
  }
  return changed ? { ...schema, properties: next } : schema;
};

/** What the completions command reads. */
export interface CompletionsOptions {
  /** Every stored connector, read at each call. */
  connectors(): readonly ConnectorRef[];
}

/**
 * `x-ahpd/completions`: the choices of a field the host stamped, for the caller.
 *
 * Takes `{ ref, query? }`, where `ref` is the one the stamp carries. A
 * `connector:<adapter>` ref answers the connectors of that adapter the
 * caller's owner may use by `sameOwnerOrHost`: the host's and the caller's
 * own. A query keeps the ones whose id or title holds it, in any case. A ref
 * this host does not know answers an empty list, as a picker that cannot be
 * filled is an empty picker.
 *
 * The grant is `connector:list`, which a person who may make a connector
 * holds, and `connector:all` is let in too.
 */
export const completionsCommand = (options: CompletionsOptions): PluginMethod => ({
  grant: 'connector:list' as Grant,
  authorize: async (_params, reader) => reader.can('connector:all' as Grant),
  handle: (params, _reader, _client, owner) => {
    const ref = typeof params['ref'] === 'string' ? params['ref'] : '';
    if (!ref.startsWith(CONNECTOR_REF)) return { items: [] };
    const adapter = ref.slice(CONNECTOR_REF.length);
    const query = typeof params['query'] === 'string' ? params['query'].toLowerCase() : '';
    const items = options.connectors()
      .filter((one) => one.adapter === adapter && sameOwnerOrHost(one.owner, owner))
      .filter((one) => query === '' || one.id.toLowerCase().includes(query) || (one.title ?? '').toLowerCase().includes(query))
      .map((one) => ({ value: one.id, label: one.title ?? one.id }));
    return { items };
  },
  describe: () => ({ title: 'List choices', description: 'Lists the choices of a field the host marked.' }),
});
