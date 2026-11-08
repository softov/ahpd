/**
 * How a caller proves itself, one check for each scheme.
 *
 * Every check is over what arrived rather than over what was parsed: a
 * signature is computed from the raw bytes, which is why the route reads the
 * body before it checks the proof and why the limit on the body is what bounds
 * a caller with no proof.
 *
 * A timestamped scheme refuses a call more than five minutes from the host's
 * clock, which is the tolerance Stripe, Slack and Standard Webhooks document,
 * and every value is compared in a time that does not depend on the value.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { bearerChallenge } from '@ahpd/sdk';
import { answer } from './call.js';
import type { Call } from './call.js';
import type { Endpoint } from './record.js';

/**
 * How far a timestamped call may be from the host's clock, in seconds: the
 * tolerance, named as Standard Webhooks' reference library names it.
 * https://github.com/standard-webhooks/standard-webhooks/blob/main/libraries/javascript/src/index.ts
 */
export const WEBHOOK_TOLERANCE_IN_SECONDS = 5 * 60;

/** Two strings are equal, in a time that does not depend on where they differ. */
const same = (given: string, kept: string): boolean => timingSafeEqual(
  createHash('sha256').update(given).digest(),
  createHash('sha256').update(kept).digest(),
);

/** One header of a call, lowercased, or nothing. */
const headerOf = (call: Call, name: string): string | undefined => call.headers[name.toLowerCase()];

/** The bytes a scheme signs: its own prefix, then the body exactly as it arrived. */
const signed = (call: Call, prefix = ''): Buffer => Buffer.concat([Buffer.from(prefix, 'utf8'), call.raw]);

/** A body as a record of fields, or nothing when it is not one. */
const bagOf = (value: unknown): Record<string, unknown> | undefined => (
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
);

/** A plain-text answer, which a handshake expects. */
const plain = (text: string): Response => new Response(text, {
  status: 200,
  headers: { 'content-type': 'text/plain; charset=utf-8' },
});

/** An HMAC of `data` with `secret`, as hex or base64. */
const mac = (algorithm: string, secret: string, data: Buffer, encoding: string): string => {
  const digest = createHmac(algorithm, secret).update(data).digest();
  return encoding === 'base64' ? digest.toString('base64') : digest.toString('hex');
};

/** Whether a seconds timestamp is inside the tolerance of `now`. */
const withinTolerance = (seconds: number, now: number): boolean => Number.isFinite(seconds)
  && Math.abs(Math.floor(now / 1000) - seconds) <= WEBHOOK_TOLERANCE_IN_SECONDS;

/** The `Authorization: Bearer <token>` token, or nothing. */
const bearerOf = (call: Call): string | undefined => {
  const header = headerOf(call, 'authorization');
  if (header === undefined) return undefined;
  return /^Bearer\s+(\S+)\s*$/iu.exec(header)?.[1];
};

/** A `Stripe-Signature` header's values, by the name before their `=`. */
const stripeParts = (header: string): Map<string, string[]> => {
  const parts = new Map<string, string[]>();
  for (const one of header.split(',')) {
    const at = one.indexOf('=');
    if (at < 1) continue;
    const name = one.slice(0, at).trim();
    const value = one.slice(at + 1).trim();
    parts.set(name, [...(parts.get(name) ?? []), value]);
  }
  return parts;
};

/** Whether any of the values equals the expected one. */
const anyIs = (values: string[], expected: string): boolean => values.some((one) => same(one, expected));

/**
 * The Standard Webhooks key: the `whsec_` prefix dropped when it is there, and
 * the rest decoded from base64, as the reference library decodes a secret
 * whether or not it carries the prefix. A secret that does not decode, or
 * decodes to nothing, is a secret the library refuses, and it holds no key.
 * https://github.com/standard-webhooks/standard-webhooks/blob/main/libraries/javascript/src/index.ts
 */
const standardKey = (secret: string): Buffer | undefined => {
  const encoded = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
  const key = Buffer.from(encoded, 'base64');
  return key.length > 0 && key.toString('base64') === encoded ? key : undefined;
};

/**
 * The key a message this host sends for one endpoint is signed with, as
 * Standard Webhooks' reference library keys its producer: a `standard`
 * endpoint's secret decoded as that scheme's key, and any other endpoint's
 * secret as its characters, the library's `raw` format.
 * https://github.com/standard-webhooks/standard-webhooks/blob/main/libraries/javascript/src/index.ts
 */
export const signingKey = (endpoint: Endpoint): Buffer | undefined => (endpoint.auth === 'standard'
  ? standardKey(endpoint.secret)
  : Buffer.from(Uint8Array.from(endpoint.secret, (character) => character.charCodeAt(0))));

/**
 * The `webhook-signature` of one message, as the reference library's `sign`
 * makes it: `v1,` and the base64 HMAC-SHA256 of `<id>.<timestamp>.<payload>`.
 * https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md
 */
export const signatureOf = (key: Buffer, id: string, timestamp: number, payload: string): string =>
  `v1,${createHmac('sha256', key).update(`${id}.${String(timestamp)}.${payload}`).digest('base64')}`;

/** Whether the GitHub and Meta signature over the raw body is the one the header carries. */
const hubSignature = (endpoint: Endpoint, call: Call): boolean => {
  const value = headerOf(call, 'x-hub-signature-256');
  if (value === undefined) return false;
  return same(value, `sha256=${mac('sha256', endpoint.secret, signed(call), 'hex')}`);
};

/** One scheme's check over the call. */
const CHECKS: Record<string, (endpoint: Endpoint, call: Call, now: number) => boolean> = {
  bearer: (endpoint, call) => {
    const token = bearerOf(call);
    return token !== undefined && same(token, endpoint.secret);
  },

  header: (endpoint, call) => {
    const value = headerOf(call, endpoint.header ?? '');
    return value !== undefined && same(value, endpoint.secret);
  },

  query: (endpoint, call) => call.token !== undefined && same(call.token, endpoint.secret),

  hmac: (endpoint, call) => {
    const value = headerOf(call, endpoint.header ?? '');
    if (value === undefined) return false;
    const expected = `${endpoint.prefix ?? ''}${mac(endpoint.algorithm ?? 'sha256', endpoint.secret, signed(call), endpoint.encoding ?? 'hex')}`;
    return same(value, expected);
  },

  github: (endpoint, call) => hubSignature(endpoint, call),

  meta: (endpoint, call) => hubSignature(endpoint, call),

  graph: (endpoint, call) => {
    // A Graph notification carries its clientState per change rather than a
    // signature; every one of them has to be this endpoint's.
    const value = bagOf(call.body)?.['value'];
    if (!Array.isArray(value) || value.length === 0) return false;
    return value.every((one) => {
      const state = bagOf(one)?.['clientState'];
      return typeof state === 'string' && same(state, endpoint.secret);
    });
  },

  stripe: (endpoint, call, now) => {
    const header = headerOf(call, 'stripe-signature');
    if (header === undefined) return false;
    const parts = stripeParts(header);
    const stamp = parts.get('t')?.[0] ?? '';
    if (!withinTolerance(Number(stamp), now)) return false;
    const expected = mac('sha256', endpoint.secret, signed(call, `${stamp}.`), 'hex');
    return anyIs(parts.get('v1') ?? [], expected);
  },

  slack: (endpoint, call, now) => {
    const stamp = headerOf(call, 'x-slack-request-timestamp') ?? '';
    if (!withinTolerance(Number(stamp), now)) return false;
    const value = headerOf(call, 'x-slack-signature');
    if (value === undefined) return false;
    const expected = `v0=${mac('sha256', endpoint.secret, signed(call, `v0:${stamp}:`), 'hex')}`;
    return same(value, expected);
  },

  standard: (endpoint, call, now) => {
    const id = headerOf(call, 'webhook-id');
    const stamp = headerOf(call, 'webhook-timestamp') ?? '';
    const header = headerOf(call, 'webhook-signature');
    const key = standardKey(endpoint.secret);
    if (id === undefined || header === undefined || key === undefined || !withinTolerance(Number(stamp), now)) return false;
    const expected = createHmac('sha256', key)
      .update(signed(call, `${id}.${stamp}.`))
      .digest('base64');
    // The header holds space-separated `v1,<base64>` entries; the other
    // versions are not this host's to judge.
    const given = header.split(' ')
      .map((one) => one.trim())
      .filter((one) => one.startsWith('v1,'))
      .map((one) => one.slice('v1,'.length));
    return anyIs(given, expected);
  },
};

/**
 * The headers the proof is read from, which a run is not shown.
 *
 * The route keeps these out of the event data, so a run cannot read the token
 * its caller was checked with. `authorization` and `cookie` are always kept
 * out by `readCall` itself.
 */
export function omitted(endpoint: Endpoint): string[] {
  switch (endpoint.auth ?? 'bearer') {
    case 'header':
    case 'hmac':
      return endpoint.header === undefined ? [] : [endpoint.header];
    case 'github': return ['x-hub-signature-256'];
    case 'meta': return ['x-hub-signature-256'];
    case 'stripe': return ['stripe-signature'];
    case 'slack': return ['x-slack-signature'];
    case 'standard': return ['webhook-signature'];
    default: return [];
  }
}

/**
 * The body a run is shown, without the secret a scheme reads from it.
 *
 * A Graph notification carries the connector's `clientState` in every item of
 * its `value`, so each item is shown without it, the way the other schemes'
 * proof headers are left out.
 */
export function shown(endpoint: Endpoint, body: unknown): unknown {
  if ((endpoint.auth ?? 'bearer') !== 'graph') return body;
  const held = bagOf(body);
  const value = held?.['value'];
  if (held === undefined || !Array.isArray(value)) return body;
  return {
    ...held,
    value: value.map((one) => {
      const item = bagOf(one);
      if (item === undefined) return one;
      const { clientState: _, ...rest } = item;
      return rest;
    }),
  };
}

/** Whether the call proves itself by the scheme its connector names. */
export function proves(endpoint: Endpoint, call: Call, now = Date.now()): boolean {
  const check = CHECKS[endpoint.auth ?? 'bearer'];
  return check !== undefined && check(endpoint, call, now);
}

/**
 * The `WWW-Authenticate` a 401 of this endpoint carries, as HTTP has every 401
 * carry one (RFC 9110 section 11.6.1): the host's bearer challenge, with
 * `error="invalid_token"` when the call carried the token its scheme reads.
 */
export function wwwAuthenticate(endpoint: Endpoint, call: Call): string {
  const scheme = endpoint.auth ?? 'bearer';
  const carried = (scheme === 'bearer' && bearerOf(call) !== undefined)
    || (scheme === 'query' && call.token !== undefined)
    || (scheme === 'header' && headerOf(call, endpoint.header ?? '') !== undefined);
  return bearerChallenge(carried);
}

/**
 * The id a sender gives one delivery and gives again when it delivers the same
 * event again, or nothing for a scheme whose sender names none: GitHub's
 * `X-GitHub-Delivery` and Standard Webhooks' `webhook-id`.
 * https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks#use-the-x-github-delivery-header
 * https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md
 */
export function deliveryOf(endpoint: Endpoint, call: Call): string | undefined {
  switch (endpoint.auth ?? 'bearer') {
    case 'github': return headerOf(call, 'x-github-delivery');
    case 'standard': return headerOf(call, 'webhook-id');
    default: return undefined;
  }
}

/**
 * The answer a sender's URL check gets, before any proof of its own.
 *
 * Meta confirms the URL with a `GET` carrying `hub.verify_token`, and answers
 * the `hub.challenge` it sent; a wrong token answers 403. Graph confirms the
 * URL with a `POST` carrying `validationToken` in the query and no proof at
 * all, so the token is echoed and nothing else happens. Nothing is fired by
 * either: neither call is a notification.
 */
export function validation(endpoint: Endpoint, call: Call): Response | undefined {
  const scheme = endpoint.auth ?? 'bearer';
  if (scheme === 'meta' && call.method === 'GET') {
    const mode = call.query['hub.mode'];
    const token = call.query['hub.verify_token'];
    const challenge = call.query['hub.challenge'];
    if (mode !== 'subscribe' || token === undefined || challenge === undefined
      || endpoint.verifyToken === undefined || !same(token, endpoint.verifyToken)) {
      return answer(403, { message: 'The handshake names the wrong verify token.' });
    }
    return plain(challenge);
  }
  if (scheme === 'graph') {
    const token = call.query['validationToken'];
    if (token !== undefined) return plain(token);
  }
  return undefined;
}

/**
 * The answer a Slack URL check gets, once its signature has passed.
 *
 * Slack sends a `url_verification` call and expects its `challenge` echoed as
 * plain text. It is answered only after the proof, because the call carries a
 * signature like every other Slack call.
 */
export function challenge(endpoint: Endpoint, call: Call): Response | undefined {
  if ((endpoint.auth ?? 'bearer') !== 'slack') return undefined;
  const body = bagOf(call.body);
  if (body?.['type'] !== 'url_verification' || typeof body['challenge'] !== 'string') return undefined;
  return plain(body['challenge']);
}
