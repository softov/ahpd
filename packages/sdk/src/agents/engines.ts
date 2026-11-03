/**
 * `x-ahpd-engines`: the engines the plugins of a host register.
 *
 * One row for each engine, keyed by the engine's name, holding what a client needs
 * to offer it and to draw the form a person makes a record with: its title, its
 * description, its schema, and the plugin that registered it. The icons, the
 * templates, the host-only fields and the key variables are sent when the engine
 * has them. Nothing here is an agent; the records made from an engine are on
 * `x-ahpd-agents`.
 *
 * The channel is read-only, and reading it takes `agent:list`: a client that
 * may not see an agent is not shown the forms either. The engines exist only
 * after the plugins load, so the host reads them through a function and one is
 * listed as soon as it is registered, before any record exists.
 */

import type { Icon } from '@microsoft/agent-host-protocol';

import { withConnectorChoices } from '../connectors/fields.js';
import { recordsChannel, type RecordsChannel } from '../resources/recordschannel.js';
import type { ServedEngine } from '../types/agents.js';
import type { ConnectorRef } from '../types/connectors.js';
import type { Grant } from '../types/users.js';

/** The channel's scheme. */
const SCHEME = 'x-ahpd-engines';

/** What an engines channel is built from. */
export interface EnginesChannelOptions {
  /**
   * The engines the plugins registered, read at each call.
   *
   * The channel is built before the plugins load, so the fold's engines are
   * read through a function rather than handed in.
   */
  engines(): Record<string, ServedEngine>;
  /**
   * The connectors this host serves, read at each listing.
   *
   * A field of an engine's schema marked `x-ahpd-connector` is sent with the
   * host's connectors of its adapter as its choices, and marked to ask
   * `x-ahpd/completions` for the reader's own. Absent, the schema is sent as
   * the engine registered it.
   */
  connectors?(): readonly ConnectorRef[];
  /** The icons of the plugin with this name, sent for an engine that has none. */
  pluginIcons?(name: string): Icon[] | undefined;
  /** Where an engine that could not be listed is said. */
  onProblem?(message: string): void;
}

/** An engines channel, and the way to send its readers a change. */
export interface EnginesChannel {
  /** What `servedRecords` takes. */
  channel: RecordsChannel;
  /** Send every reader what the engines are now. */
  refresh(): Promise<void>;
}

/**
 * One engine as a client is shown it: everything but the `open` that builds a
 * backend, which is a function and does not serialize.
 *
 * The templates are sent whole, so the name, the description, the icon, the
 * model and the config a record starts from each reach a client. A list an engine
 * does not have carries no key rather than an empty one a client would have to
 * test. An engine with no icons is drawn with its plugin's. A field that names a
 * connector carries its choices when the host's connectors are known.
 */
const rowOf = (
  engine: ServedEngine,
  pluginIcons: Icon[] | undefined,
  connectors: readonly ConnectorRef[] | undefined,
): Record<string, unknown> => {
  const icons = engine.icons !== undefined && engine.icons.length > 0 ? engine.icons : pluginIcons;
  return {
    name: engine.name,
    title: engine.title,
    description: engine.description,
    schema: connectors === undefined ? engine.schema : withConnectorChoices(engine.schema, connectors, true),
    plugin: engine.by,
    ...(icons === undefined || icons.length === 0 ? {} : { icons }),
    ...(engine.templates === undefined || engine.templates.length === 0 ? {} : { templates: engine.templates }),
    ...(engine.hostOnly === undefined || engine.hostOnly.length === 0 ? {} : { hostOnly: engine.hostOnly }),
    ...(engine.keyVariables === undefined || engine.keyVariables.length === 0 ? {} : { keyVariables: engine.keyVariables }),
  };
};

export const enginesChannel = (options: EnginesChannelOptions): EnginesChannel => {
  const source = {
    ids: async (): Promise<string[]> => Object.keys(options.engines()).sort(),
    find: async (id: string): Promise<Record<string, unknown> | undefined> => {
      const engine = options.engines()[id];
      return engine === undefined ? undefined : rowOf(engine, options.pluginIcons?.(engine.by), options.connectors?.());
    },
  };

  const channel = recordsChannel(SCHEME, source, {
    grant: 'agent:list' as Grant,
    describe: () => ({ title: 'Engines', description: 'The engines this host serves.' }),
    ...(options.onProblem === undefined ? {} : { onProblem: options.onProblem }),
  });

  return { channel, refresh: channel.refresh };
};
