import { appendFileSync } from 'node:fs';
import type { Plugin } from '@ahpd/sdk';

/**
 * A plugin that offers one kind of tunnel, and says each thing that happens to
 * it on one line of `AHPD_TUNNEL_LOG`.
 *
 * Nothing here opens a socket: the URL a kind reports is a made-up name under
 * `.example`, and what the test reads is the host's list, the route's `Host`
 * check and the order the calls arrive in. A tunnel that is stopped says so,
 * so a case can show the host took it down before the plugin heard `stopping`.
 */

export const name = 'tunnel-fixture';

/** One line, when a case asked for the file, so the order of calls is readable. */
const said = (line: string): void => {
  const path = process.env.AHPD_TUNNEL_LOG;
  if (path !== undefined) appendFileSync(path, `${line}\n`);
};

/** The address a tunnel of this kind answers at, from the id the host gave it. */
const urlOf = (id: string): string => `https://${id}.example/`;

export const apply: Plugin['apply'] = (host) => {
  host.on('stopping', () => { said('stopping'); });

  host.registerTunnelKind({
    name: 'fixture',
    title: 'Fixture tunnel',
    description: 'A tunnel that never leaves this machine.',
    schema: {
      type: 'object',
      properties: { port: { type: 'integer', title: 'Port' } },
      required: ['port'],
    },
    create: (tunnel, report) => {
      said(`create ${tunnel.id} ${String(tunnel.settings['port'])}`);
      report({ status: 'running', url: urlOf(tunnel.id) });
    },
    remove: (tunnel) => { said(`remove ${tunnel.id}`); },
    invoke: (verb, tunnel, report) => {
      said(`${verb} ${tunnel.id}`);
      if (verb === 'start') report({ status: 'running', url: urlOf(tunnel.id) });
      if (verb === 'stop') report({ status: 'stopped' });
    },
    system: (context) => ({ port: context.port }),
  });

  host.registerRoute(async (request) => {
    const seen = { path: new URL(request.url).pathname, host: request.headers.get('host') };
    return new Response(`${JSON.stringify(seen)}\n`, { status: 200, headers: { 'content-type': 'application/json' } });
  });
};
