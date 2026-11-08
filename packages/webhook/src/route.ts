import { routePrefix } from '@ahpd/sdk';
import { challenge, deliveryOf, omitted, proves, shown, validation, WEBHOOK_TOLERANCE_IN_SECONDS, wwwAuthenticate } from './auth.js';
import { allows, answer, dataOf, readCall } from './call.js';
import type { Call } from './call.js';
import type { ConnectorOwner } from '@ahpd/sdk';
import type { Endpoint } from './record.js';
import type { Route } from '@ahpd/sdk';

/** The plugin's id, which is also the prefix its route is served under. */
export const NAME = 'webhook';

/** The path every endpoint is under, as the listener passes it: `/plugins/webhook/`. */
export const PREFIX = routePrefix(NAME);

export { answer };

/** What one target does with a call that passed its proof. */
export type Target = (endpoint: Endpoint, call: Call) => Promise<Response>;

/** What the route reads and calls, so a test gives each one. */
export interface WebhookSeams {
  /** The endpoint an open `webhook` connector of this id answers for, or nothing when none does. */
  endpoint(id: string): Endpoint | undefined | Promise<Endpoint | undefined>;
  /** What a call to a bot endpoint does. */
  bot?: Target;
  /** Start the automation a connector names, with the call's event data and the connector's owner. */
  run?: (automation: string, data: Record<string, unknown>, owner?: ConnectorOwner) => void;
  /** Fire the `webhook` trigger, with the call's event data and the connector's owner. */
  fire?: (data: Record<string, unknown>, owner?: ConnectorOwner) => void;
  /** The most of a body this route reads, in bytes. */
  maxBodyBytes?: number;
  /** The host's clock, in milliseconds, for a timestamped scheme. Absent, `Date.now`. */
  now?: () => number;
}

/**
 * The one route the plugin serves: `POST /plugins/webhook/<endpoint>`.
 *
 * The route finds the open endpoint, and takes a `GET` only on a `meta`
 * connector, which needs one to confirm its URL. The call is read once - the
 * body up to the limit, the headers, the query without `token` - and a
 * sender's URL check is answered before anything else: Meta's `GET` with its
 * `hub.verify_token`, Graph's `validationToken`. Then the proof the
 * connector's `auth` scheme names is checked over those bytes; a call that
 * does not prove itself answers 401. A Slack `url_verification` call is
 * answered with its challenge once its signature passed. A proved call has the
 * connector's `match` applied, then reaches its target: its bot, the
 * automation it names, or the `webhook` trigger. A connector that was never
 * opened, or was closed, answers 404 like an id nobody made.
 *
 * The body is read before the proof is checked, because a signature is over
 * the bytes; the limit is what bounds a caller who has no proof, so a caller
 * cannot make this process hold a body larger than the plugin's option.
 *
 * A 405 names the methods the endpoint takes in `Allow`, and a 401 carries its
 * challenge, as HTTP has each carry one (RFC 9110 sections 15.5.6 and 11.6.1).
 * A proved delivery whose sender id was taken already, GitHub's or Standard
 * Webhooks', is the same event sent again: it answers 202 `{ duplicate: true }`
 * and reaches no target. An id is kept for the five minutes Standard Webhooks
 * gives as its example, which is its tolerance too, and an id whose call was
 * answered with anything but a 2xx is let go, since its sender sends it again.
 */
export function webhookRoute(seams: WebhookSeams): Route {
  /** The delivery ids taken, by endpoint and id, with when each stops counting. */
  const delivered = new Map<string, number>();
  return async (request) => {
    const path = new URL(request.url).pathname;
    const rest = path.startsWith(PREFIX) ? path.slice(PREFIX.length) : '';
    if (rest === '' || rest.includes('/')) return answer(404, { message: 'No webhook endpoint is at this path.' });

    let id: string;
    try {
      id = decodeURIComponent(rest);
    }
    catch {
      return answer(404, { message: 'No webhook endpoint is at this path.' });
    }
    const endpoint = await seams.endpoint(id);
    if (endpoint === undefined) return answer(404, { message: 'No webhook endpoint is at this path.' });

    // Only Meta checks a URL with GET; every other connector takes POST alone.
    const method = request.method;
    const meta = (endpoint.auth ?? 'bearer') === 'meta';
    if (method !== 'POST' && !(method === 'GET' && meta)) {
      const refused = answer(405, { message: meta ? 'A Meta webhook takes POST, or GET to confirm its URL.' : 'A webhook takes POST only.' });
      refused.headers.set('allow', meta ? 'GET, POST' : 'POST');
      return refused;
    }

    const read = await readCall(request, seams.maxBodyBytes);
    if ('refused' in read) return read.refused;

    const asked = validation(endpoint, read.call);
    if (asked !== undefined) return asked;

    const now = seams.now?.() ?? Date.now();
    if (!proves(endpoint, read.call, now)) {
      const refused = answer(401, { message: 'The call is not proved with the endpoint secret.' });
      refused.headers.set('www-authenticate', wwwAuthenticate(endpoint, read.call));
      return refused;
    }

    const confirmed = challenge(endpoint, read.call);
    if (confirmed !== undefined) return confirmed;

    for (const [key, until] of delivered) if (until <= now) delivered.delete(key);
    const delivery = deliveryOf(endpoint, read.call);
    const key = delivery === undefined ? undefined : `${endpoint.id}\n${delivery}`;
    if (key !== undefined && delivered.has(key)) return answer(202, { duplicate: true });
    if (key !== undefined) delivered.set(key, now + WEBHOOK_TOLERANCE_IN_SECONDS * 1000);
    const answered = await reached(endpoint, read.call);
    if (key !== undefined && (answered.status < 200 || answered.status > 299)) delivered.delete(key);
    return answered;
  };

  /** What a proved call's target answers it with: its bot, its automation, or the `webhook` trigger. */
  async function reached(endpoint: Endpoint, call: Call): Promise<Response> {
    const data = dataOf({ ...call, body: shown(endpoint, call.body) }, endpoint.id, omitted(endpoint));
    if (endpoint.match !== undefined && !allows(endpoint.match, data)) {
      // A sender retries a non-2xx answer, and a call this connector does not
      // take is not a delivery that failed.
      return answer(202, { skipped: true });
    }

    if (endpoint.bot !== undefined) {
      if (seams.bot === undefined) return answer(501, { message: 'This plugin cannot serve this endpoint yet.' });
      return await seams.bot(endpoint, call);
    }

    if (endpoint.automation !== undefined) {
      if (seams.run === undefined) return answer(501, { message: 'This plugin cannot serve this endpoint yet.' });
      seams.run(endpoint.automation, data, endpoint.owner);
      return answer(202, { endpoint: endpoint.id, automation: endpoint.automation });
    }

    if (seams.fire === undefined) return answer(501, { message: 'This plugin cannot serve this endpoint yet.' });
    seams.fire(data, endpoint.owner);
    return answer(202, { endpoint: endpoint.id });
  }
}
