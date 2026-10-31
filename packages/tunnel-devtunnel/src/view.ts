/**
 * What this plugin's page shows.
 *
 * A view is a small A2UI surface, so a client draws it with no code for this
 * plugin: a Card holding a Column, and in the Column the tunnel's address and
 * one line for each value. A value is data and stays as it is; the words
 * around it are the plugin's catalogs' to translate, and each one is read
 * under the id of the component it sits in.
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
 * URL is one the sdk refuses.
 */
export const tunnelView = (state: TunnelState): PluginView => {
  const address: ViewComponent = state.url === undefined
    ? { id: 'address', component: 'Text', text: 'The tunnel address is not ready' }
    : { id: 'address', component: 'Link', label: 'Open the tunnel', href: state.url };
  const relay: ViewComponent = state.hosts > 0
    ? { id: 'relay-up', component: 'Text', text: 'The relay is up' }
    : { id: 'relay-down', component: 'Text', text: 'The relay is down' };
  return {
    root: 'card',
    components: {
      card: { id: 'card', component: 'Card', child: 'body' },
      body: {
        id: 'body',
        component: 'Column',
        children: ['address', 'tunnel-label', 'tunnel', 'port-label', 'port', relay.id, 'clients-label', 'clients'],
      },
      address,
      'tunnel-label': { id: 'tunnel-label', component: 'Text', text: 'Tunnel' },
      tunnel: { id: 'tunnel', component: 'Text', text: state.id },
      'port-label': { id: 'port-label', component: 'Text', text: 'Port' },
      port: { id: 'port', component: 'Text', text: String(state.port) },
      [relay.id]: relay,
      'clients-label': { id: 'clients-label', component: 'Text', text: 'Clients connected' },
      clients: { id: 'clients', component: 'Text', text: String(state.clients) },
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
