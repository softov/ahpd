/**
 * What this plugin's page shows.
 *
 * A view is a small A2UI surface, so a client draws it with no code for this
 * plugin: a Card holding a Column. The Column's first Row holds the tunnel's
 * address and the relay state; below a Divider, each value has a Row of its
 * own, its label at the start and the value at the end. A value is data and
 * stays as it is; the words around it are the plugin's catalogs' to translate,
 * and each one is read under the id of the component it sits in.
 */

import type { PluginView, ViewComponent } from '@ahpd/sdk';

/** One tunnel, as the plugin shows it. */
export interface TunnelState {
  /** The tunnel's id, which is what a client derives its token from. */
  id: string;
  /** The port a client reaches the daemon at through the tunnel. */
  port: number;
  /** The URL that port answers at, when the service answered one. */
  url?: string;
  /** How many hosts are connected to the relay: 0 is a relay that is down. */
  hosts: number;
  /** How many clients are connected to the tunnel. */
  clients: number;
}

/**
 * The view of one state.
 *
 * The two relay states are two components rather than one, because the text is
 * a word and each word needs its own key in a catalog: one key cannot hold
 * both "up" and "down". The address is a Link once the service has a URL, and
 * a Text saying it has none before that, because a Link without an absolute
 * URL is one the sdk refuses. A label is a `caption`, and the relay state has
 * the `tone` of its state.
 */
export const tunnelView = (state: TunnelState): PluginView => {
  const address: ViewComponent = state.url === undefined
    ? { id: 'address', component: 'Text', text: 'The tunnel address is not ready' }
    : { id: 'address', component: 'Link', label: 'Open the tunnel', href: state.url };
  const relay: ViewComponent = state.hosts > 0
    ? { id: 'relay-up', component: 'Text', text: 'The relay is up', tone: 'success' }
    : { id: 'relay-down', component: 'Text', text: 'The relay is down', tone: 'danger' };
  /** One Row of a label and its value, the label at the start and the value at the end. */
  const line = (id: string, label: string, text: string): Record<string, ViewComponent> => ({
    [id]: { id, component: 'Row', justify: 'spaceBetween', align: 'center', children: [`${id}-label`, `${id}-value`] },
    [`${id}-label`]: { id: `${id}-label`, component: 'Text', variant: 'caption', text: label },
    [`${id}-value`]: { id: `${id}-value`, component: 'Text', text },
  });
  return {
    root: 'card',
    components: {
      card: { id: 'card', component: 'Card', child: 'body' },
      body: { id: 'body', component: 'Column', children: ['status', 'rule', 'tunnel', 'port', 'clients'] },
      status: { id: 'status', component: 'Row', justify: 'spaceBetween', align: 'center', children: ['address', relay.id] },
      address,
      [relay.id]: relay,
      rule: { id: 'rule', component: 'Divider' },
      ...line('tunnel', 'Tunnel', state.id),
      ...line('port', 'Port', String(state.port)),
      ...line('clients', 'Clients connected', String(state.clients)),
    },
  };
};

/** Whether two states draw the same view, which is what keeps a poll quiet. */
export const sameState = (one: TunnelState, other: TunnelState): boolean =>
  one.id === other.id
  && one.port === other.port
  && one.url === other.url
  && one.hosts === other.hosts
  && one.clients === other.clients;
