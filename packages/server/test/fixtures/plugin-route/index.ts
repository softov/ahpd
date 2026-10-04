import type { Plugin } from '@ahpd/sdk';

/**
 * A plugin that serves a route of its own, and announces a host of its own.
 *
 * Both halves are what a webhook or a tunnel plugin needs and what this plan
 * has to be checked against. The name is scoped on purpose, so the fixture
 * exercises the encoding: it is served under `/plugins/%40ahpd/plugin-route/`,
 * and no name is refused for holding `@` and `/`.
 *
 * The `say` line is the tunnel's: a plugin that made this daemon reachable
 * somewhere else names that address in the announcement, and the daemon reads
 * the host out of it rather than being told about it twice.
 */

export const name = '@ahpd/plugin-route';

/** The host the line below names, as a caller reaches the tunnel. */
export const TUNNEL_HOST = 'fixture-tunnel.example.com';

export const apply: Plugin['apply'] = (host) => {
  host.say(`tunnel fixture-tunnel (https://${TUNNEL_HOST}/), port 443`);

  host.registerRoute(async (request) => {
    const path = new URL(request.url).pathname;
    // A handler that fails is a failed request and not a failed listener: the
    // daemon has to keep serving, and the log has to name this plugin.
    if (path.endsWith('/boom')) throw new Error('the fixture was asked to fail');
    const said = {
      path,
      method: request.method,
      host: request.headers.get('host'),
      origin: request.headers.get('origin'),
      contentType: request.headers.get('content-type'),
      body: await request.text(),
    };
    return new Response(`${JSON.stringify(said)}\n`, { status: 200, headers: { 'content-type': 'application/json' } });
  });
};