import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { proves } from '../src/auth.js';
import { checkEndpoint } from '../src/record.js';
import type { Call } from '../src/call.js';
import type { Endpoint } from '../src/record.js';

/*
 * Each auth scheme, over the calls its sender makes.
 *
 * The signatures are computed here the way each sender documents them, and the
 * docs' published examples are checked where one exists. What is checked is
 * whether the call proves itself, at a fixed clock so a timestamp is a fact.
 */

const SECRET = 'secret-token';
const BODY = '{"hello":"world"}';
/** The clock every case is checked at, in milliseconds. */
const NOW = 1_700_000_000_000;
/** The same clock, in the seconds a sender writes. */
const TS = String(Math.floor(NOW / 1000));

const hex = (key: string, data: string): string => createHmac('sha256', key).update(data).digest('hex');

const base64 = (key: Buffer, data: string): string => createHmac('sha256', key).update(data).digest('base64');

/** One call, with its headers lowercased as the route hands them over. */
const call = (body: string, headers: Record<string, string> = {}, token?: string): Call => ({
  raw: new TextEncoder().encode(body),
  body: null,
  headers: Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value])),
  query: {},
  ...(token === undefined ? {} : { token }),
  method: 'POST',
});

/** An endpoint, checked the way the adapter opens one. */
const endpoint = (fields: Record<string, unknown> = {}): Endpoint => checkEndpoint({ id: 'ci', secret: SECRET, ...fields });

/** The headers of a scheme's proof, built from the body it signs. */
interface Case {
  /** The endpoint's scheme, as a sentence names it. */
  name: string;
  endpoint: Endpoint;
  /** The call proving itself, or `wrong`/`missing` for a refusal. */
  make(body: string, over?: 'wrong' | 'missing'): Call;
  /** Whether the scheme signs the body, so a changed byte is a refusal. */
  signed: boolean;
}

const CASES: Case[] = [
  {
    name: 'bearer',
    endpoint: endpoint(),
    make: (body, over) => call(body, over === 'missing' ? {} : { authorization: over === 'wrong' ? 'Bearer nope' : `Bearer ${SECRET}` }),
    signed: false,
  },
  {
    name: 'header',
    endpoint: endpoint({ auth: 'header', header: 'X-Gitlab-Token' }),
    make: (body, over) => call(body, over === 'missing' ? {} : { 'X-Gitlab-Token': over === 'wrong' ? 'nope' : SECRET }),
    signed: false,
  },
  {
    name: 'query',
    endpoint: endpoint({ auth: 'query' }),
    make: (body, over) => call(body, {}, over === 'missing' ? undefined : over === 'wrong' ? 'nope' : SECRET),
    signed: false,
  },
  {
    // Shopify: base64 over the raw body, with no prefix.
    name: 'hmac',
    endpoint: endpoint({ auth: 'hmac', header: 'X-Shopify-Hmac-Sha256', algorithm: 'sha256', encoding: 'base64' }),
    make: (body, over) => call(body, over === 'missing' ? {} : { 'X-Shopify-Hmac-Sha256': over === 'wrong' ? base64(Buffer.from(SECRET), 'nope') : base64(Buffer.from(SECRET), body) }),
    signed: true,
  },
  {
    name: 'github',
    endpoint: endpoint({ auth: 'github' }),
    make: (body, over) => call(body, over === 'missing' ? {} : { 'X-Hub-Signature-256': over === 'wrong' ? `sha256=${hex(SECRET, 'nope')}` : `sha256=${hex(SECRET, body)}` }),
    signed: true,
  },
  {
    name: 'stripe',
    endpoint: endpoint({ auth: 'stripe' }),
    make: (body, over) => call(body, over === 'missing' ? {} : {
      'Stripe-Signature': over === 'wrong'
        ? `t=${TS},v1=${hex(SECRET, `nope.${body}`)}`
        : `t=${TS},v1=${hex(SECRET, `${TS}.${body}`)}`,
    }),
    signed: true,
  },
  {
    name: 'slack',
    endpoint: endpoint({ auth: 'slack' }),
    make: (body, over) => call(body, over === 'missing' ? {} : {
      'X-Slack-Request-Timestamp': TS,
      'X-Slack-Signature': over === 'wrong' ? `v0=${hex(SECRET, `v0:${TS}:nope`)}` : `v0=${hex(SECRET, `v0:${TS}:${body}`)}`,
    }),
    signed: true,
  },
  {
    name: 'standard',
    endpoint: endpoint({ auth: 'standard', secret: 'whsec_c2VjcmV0LXRva2Vu' }),
    make: (body, over) => call(body, over === 'missing' ? {} : {
      'webhook-id': 'msg_1',
      'webhook-timestamp': TS,
      'webhook-signature': over === 'wrong'
        ? `v1,${base64(Buffer.from(SECRET), `msg_1.${TS}.nope`)}`
        : `v1,${base64(Buffer.from(SECRET), `msg_1.${TS}.${body}`)}`,
    }),
    signed: true,
  },
];

describe.each(CASES)('$name', (one) => {
  it('passes a call signed as its sender documents it', () => {
    expect(proves(one.endpoint, one.make(BODY), NOW)).toBe(true);
  });

  it('refuses a wrong value and a missing proof', () => {
    expect(proves(one.endpoint, one.make(BODY, 'wrong'), NOW)).toBe(false);
    expect(proves(one.endpoint, one.make(BODY, 'missing'), NOW)).toBe(false);
  });

  if (one.signed) {
    it('refuses a changed body byte', () => {
      const signed = one.make(BODY);
      const changed = { ...signed, raw: new TextEncoder().encode(`${BODY} `) };
      expect(proves(one.endpoint, changed, NOW)).toBe(false);
    });
  }
});

it('passes the GitHub docs example', () => {
  const github = endpoint({ auth: 'github', secret: "It's a Secret to Everybody" });
  const delivery = call('Hello, World!', {
    'X-Hub-Signature-256': 'sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17',
  });
  expect(proves(github, delivery, NOW)).toBe(true);
});

it('passes the Stripe docs example', () => {
  const stripe = endpoint({ auth: 'stripe', secret: 'whsec_test_secret' });
  // The signed content the docs show is `<timestamp>.<payload>`, and the value
  // below is what their method gives for it.
  const delivery = call('{"id": "evt_test_webhook", "object": "event"}', {
    'Stripe-Signature': 't=1492774577,v1=c137b1b62277d523cf8fed4dfbd0170a9a5b8a380e00cc3711d4bf0652f2ce7a',
  });
  expect(proves(stripe, delivery, 1_492_774_577_000)).toBe(true);
});

it('passes the Slack docs example', () => {
  const slack = endpoint({ auth: 'slack', secret: '8f742231b10e8888abcd99yyyzzz85a5' });
  const body = 'token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1DC2JH3J&team_domain=testteamnow&channel_id=G8PSS9T3V&channel_name=foobar&user_id=U2CERLKJA&user_name=roadrunner&command=%2Fwebhook-collect&text=&response_url=https%3A%2F%2Fhooks.slack.com%2Fcommands%2FT1DC2JH3J%2F397700885554%2F96rGlfmibIGlgcZRskXaIFfN&trigger_id=398738663015.47445629121.803a0bc887a14d10d2c447fce8b6703c';
  const delivery = call(body, {
    'X-Slack-Request-Timestamp': '1531420618',
    'X-Slack-Signature': 'v0=a2114d57b48eac39b9ad189dd8316235a7b4a8d21a10bd27519666489c69b503',
  });
  expect(proves(slack, delivery, 1_531_420_618_000)).toBe(true);
});

it('passes the Standard Webhooks spec example', () => {
  const standard = endpoint({ auth: 'standard', secret: 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw' });
  const delivery = call('{"test": 2432232314}', {
    'webhook-id': 'msg_p5jXN8AQM9LWM0D4loKWxJek',
    'webhook-timestamp': '1614265330',
    'webhook-signature': 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=',
  });
  expect(proves(standard, delivery, 1_614_265_330_000)).toBe(true);
});

it('decodes a Standard Webhooks secret with no prefix from base64, as the reference library does', () => {
  // `c2VjcmV0LXRva2Vu` is the base64 of `secret-token`, which is the key it holds.
  const unprefixed = endpoint({ auth: 'standard', secret: 'c2VjcmV0LXRva2Vu' });
  const signedWith = (key: Buffer): Call => call(BODY, {
    'webhook-id': 'msg_1',
    'webhook-timestamp': TS,
    'webhook-signature': `v1,${base64(key, `msg_1.${TS}.${BODY}`)}`,
  });
  expect(proves(unprefixed, signedWith(Buffer.from(SECRET)), NOW)).toBe(true);
  expect(proves(unprefixed, signedWith(Buffer.from('c2VjcmV0LXRva2Vu')), NOW)).toBe(false);
  // A secret that is not base64 holds no key, so no signature proves a call.
  const text = endpoint({ auth: 'standard', secret: 'not base64 at all' });
  expect(proves(text, signedWith(Buffer.from('not base64 at all')), NOW)).toBe(false);
});

it('refuses a Stripe, Slack or Standard Webhooks call 301 seconds old', () => {
  const old = NOW - 301 * 1000;
  const oldTs = String(Math.floor(old / 1000));

  expect(proves(endpoint({ auth: 'stripe' }), call(BODY, {
    'Stripe-Signature': `t=${oldTs},v1=${hex(SECRET, `${oldTs}.${BODY}`)}`,
  }), NOW)).toBe(false);

  expect(proves(endpoint({ auth: 'slack' }), call(BODY, {
    'X-Slack-Request-Timestamp': oldTs,
    'X-Slack-Signature': `v0=${hex(SECRET, `v0:${oldTs}:${BODY}`)}`,
  }), NOW)).toBe(false);

  expect(proves(endpoint({ auth: 'standard', secret: 'whsec_c2VjcmV0LXRva2Vu' }), call(BODY, {
    'webhook-id': 'msg_1',
    'webhook-timestamp': oldTs,
    'webhook-signature': `v1,${base64(Buffer.from(SECRET), `msg_1.${oldTs}.${BODY}`)}`,
  }), NOW)).toBe(false);
});

it('takes a GitLab call with a header scheme', () => {
  const gitlab = endpoint({ auth: 'header', header: 'X-Gitlab-Token', secret: 'gitlab-token' });
  expect(proves(gitlab, call(BODY, { 'X-Gitlab-Token': 'gitlab-token' }), NOW)).toBe(true);
});

it('takes a Shopify call with an hmac scheme', () => {
  const shopify = endpoint({ auth: 'hmac', header: 'X-Shopify-Hmac-Sha256', algorithm: 'sha256', encoding: 'base64' });
  expect(proves(shopify, call(BODY, {
    'X-Shopify-Hmac-Sha256': base64(Buffer.from(SECRET), BODY),
  }), NOW)).toBe(true);
});

it('signs the bytes that arrived, not their text', () => {
  const latin = Buffer.from('name=Jos\xe9', 'latin1');
  const github = endpoint({ auth: 'github' });
  const signature = `sha256=${createHmac('sha256', SECRET).update(latin).digest('hex')}`;
  expect(proves(github, { ...call(''), raw: latin, headers: { 'x-hub-signature-256': signature } }, NOW)).toBe(true);
});

it('takes a bearer token on a stored connector with no auth', () => {
  expect(checkEndpoint({ id: 'ci', secret: SECRET }).auth).toBeUndefined();
  expect(proves(checkEndpoint({ id: 'ci', secret: SECRET }), call(BODY, { authorization: `Bearer ${SECRET}` }), NOW)).toBe(true);
});
