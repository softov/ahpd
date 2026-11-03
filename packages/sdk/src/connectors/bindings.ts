/**
 * The `connectors` key of a session's config: an alias for a connector.
 *
 * A binding is `{ work: "connectors://resend/account-123" }`, the shape plan
 * 118 settled on: the alias is the name a model says, and the connector is
 * what the host resolves it to. So the connector's id never reaches the model,
 * and two sessions can name one connector differently.
 *
 * `connectors://<adapter>/<id>` is the form a resource URI takes: the adapter
 * names the kind of connector, and the id names one of them. Both are record
 * slugs, which is the shape an adapter's name and a connector's id already
 * have.
 */

import { INVALID_PARAMS, RpcError } from '../rpc.js';
import { sameOwnerOrHost } from './fields.js';
import { isRecordSlug } from '../resources/records.js';
import type { ConnectorRef } from '../types/connectors.js';
import type { Owner } from '../types/usage.js';

/** The key in a session's config that names its connectors. */
export const BINDINGS_KEY = 'connectors';

/** The scheme every binding value starts with. */
export const BINDINGS_SCHEME = 'connectors://';

/** One binding: the alias a model names, and the connector it stands for. */
export interface Binding {
  /** The alias, which is a lowercase slug and the model's name for it. */
  alias: string;
  /** The adapter the connector is one of. */
  adapter: string;
  /** The connector's id. */
  id: string;
}

/**
 * The adapter and id one value names, or nothing where it names none.
 *
 * Anything that is not the scheme followed by two record slugs is skipped
 * rather than refused. A binding map is read live, on every tool list and
 * every call, so a value that is not a binding is a binding that is not
 * there - and refusing the whole map would take the good aliases with it.
 */
export const bindingTarget = (value: unknown): { adapter: string; id: string } | undefined => {
  if (typeof value !== 'string' || !value.startsWith(BINDINGS_SCHEME)) return undefined;
  const parts = value.slice(BINDINGS_SCHEME.length).split('/');
  if (parts.length !== 2) return undefined;
  const [adapter, id] = parts as [string, string];
  return isRecordSlug(adapter) && isRecordSlug(id) ? { adapter, id } : undefined;
};

/**
 * One config's bindings, in the order its aliases were declared.
 *
 * An alias that is not a lowercase slug is skipped too: an alias is what a
 * model says, and a name it cannot spell is a name it cannot use. Nothing here
 * decides who may use a connector, which the connectors channel checks on
 * every call.
 */
export const bindingsOf = (config: Record<string, unknown> | undefined): Binding[] => {
  if (config === undefined) return [];
  const held = config[BINDINGS_KEY];
  if (typeof held !== 'object' || held === null || Array.isArray(held)) return [];
  const out: Binding[] = [];
  for (const [alias, value] of Object.entries(held as Record<string, unknown>)) {
    if (!isRecordSlug(alias)) continue;
    const target = bindingTarget(value);
    if (target === undefined) continue;
    out.push({ alias, ...target });
  }
  return out;
};

/**
 * Refuse a binding map that names a connector its owner may not read.
 *
 * The check an automation's save makes, asked when a session starts instead:
 * the connector has to be one this host serves, of the adapter the URI names,
 * and one the owner may read - its own, or the host's, by `sameOwnerOrHost`.
 * A value that is not a binding is skipped here as it is skipped by
 * `bindingsOf`, so a start is refused for a binding it would actually use and
 * not for a key nothing will read.
 *
 * `refs` is what `ConnectorsChannel.refs` answers, and nothing on a host that
 * serves no connector - which checks nothing, as `checkReferences` does.
 */
export const checkBindings = (
  held: unknown,
  owner: Owner | undefined,
  refs: readonly ConnectorRef[] | undefined,
): void => {
  if (refs === undefined) return;
  if (typeof held !== 'object' || held === null || Array.isArray(held)) return;
  for (const [alias, value] of Object.entries(held as Record<string, unknown>)) {
    const target = bindingTarget(value);
    if (target === undefined) continue;
    const found = refs.find((one) => one.id === target.id && one.adapter === target.adapter);
    if (found === undefined) {
      throw new RpcError(INVALID_PARAMS, `${alias} names ${target.id}, and this host serves no ${target.adapter} connector with that id`);
    }
    if (!sameOwnerOrHost(found.owner, owner)) {
      throw new RpcError(INVALID_PARAMS, `${alias} names ${target.id}, which belongs to ${found.owner ?? 'nobody'}, so this session may not use it`);
    }
  }
};
