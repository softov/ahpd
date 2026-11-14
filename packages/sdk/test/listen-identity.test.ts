import { afterEach, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { doorOf, listen, plainAnswer } from '../src/listen.js';
import type { Arrival, Connected, Listener, Opened } from '../src/types/listen.js';
import type { Peer } from '../src/types/rpc.js';
import type { Principal } from '../src/types/users.js';

/*
 * The door, and who it lets in.
 *
 * The deployment's own token admits the socket and is the host. A person's own
 * token admits it and says nobody unless their record trusts it, which the
 * daemon decides through `identify` - so what is under test is that the door
 * takes the answer as given: a principal, or an empty object for a token that
 * opens the socket and nothing more. Worth a real socket rather than a unit
 * test of the resolution: what is being checked is what the handshake decided.
 */

let running: Listener | undefined;

afterEach(async () => {
  await running?.close();
  running = undefined;
});

const ROOT = 'sesame';

const ana = (token: string): Arrival | undefined =>
  (token === 'ana-secret' ? { principal: { id: 'ana', roles: ['admin'], can: () => true } } : undefined);

/** A directory that knows the token and does not trust it: door only. */
const doorOnly = (token: string): Arrival | undefined =>
  (token === 'ana-secret' ? {} : undefined);

/** What each connection arrived as, in the order they were accepted. */
const arrived: (Principal | undefined)[] = [];
/** And whether each was admitted as the host itself. */
const roots: (boolean | undefined)[] = [];
/** And where each came from: its socket number, address and forwarded claim. */
const openings: (Opened | undefined)[] = [];
const watching = (_peer: Peer, principal?: Principal, root?: boolean, opened?: Opened): Connected => {
  arrived.push(principal);
  roots.push(root);
  openings.push(opened);
  return { handle: async () => ({}), close: () => {} };
};

const knock = (url: string, headers?: Record<string, string>): Promise<'open' | string> => new Promise((resolve) => {
  const socket = headers === undefined ? new WebSocket(url) : new WebSocket(url, { headers });
  socket.on('open', () => { socket.close(); resolve('open'); });
  socket.on('error', (error: Error) => resolve(error.message));
});

it('admits the deployment token and names nobody', async () => {
  arrived.length = 0;
  running = await listen({ port: 0, token: ROOT, identify: ana }, watching);
  const url = `ws://127.0.0.1:${running.port}`;
  expect(await knock(`${url}/?tkn=${ROOT}`)).toBe('open');
  expect(arrived).toEqual([undefined]);
  // A token that is nobody's is still refused, in HTTP.
  expect(await knock(`${url}/?tkn=nope`)).toContain('401');
  expect(arrived).toEqual([undefined]);
});

it('admits a person\'s own token and arrives as them when the record trusts it', async () => {
  arrived.length = 0;
  running = await listen({ port: 0, token: ROOT, identify: ana }, watching);
  const url = `ws://127.0.0.1:${running.port}`;
  expect(await knock(`${url}/?tkn=ana-secret`)).toBe('open');
  expect(arrived[0]?.id).toBe('ana');
});

it('admits a door-only token and names nobody, which is the default', async () => {
  arrived.length = 0;
  running = await listen({ port: 0, token: ROOT, identify: doorOnly }, watching);
  const url = `ws://127.0.0.1:${running.port}`;
  // The socket opens and the connection is nobody, so the first gated command
  // answers -32007 and the client signs in - decision
  // `a-persons-token-names-them-unless-the-issuer-is-required`.
  expect(await knock(`${url}/?tkn=ana-secret`)).toBe('open');
  expect(arrived).toEqual([undefined]);
  // A token the directory does not know is still refused, which is the
  // difference between "door only" and "not a door at all".
  expect(await knock(`${url}/?tkn=nope`)).toContain('401');
});

it('makes the deployment token the host itself when it is told to', async () => {
  arrived.length = 0;
  roots.length = 0;
  running = await listen({ port: 0, token: ROOT, identify: ana, root: true }, watching);
  const url = `ws://127.0.0.1:${running.port}`;
  expect(await knock(`${url}/?tkn=${ROOT}`)).toBe('open');
  expect(arrived).toEqual([undefined]);
  expect(roots).toEqual([true]);
  // And a person's own token is still a person, not the host.
  expect(await knock(`${url}/?tkn=ana-secret`)).toBe('open');
  expect(arrived[1]?.id).toBe('ana');
  expect(roots[1]).toBeUndefined();
});

it('reads the token from a bearer header too, because a browser cannot set one on a URL', async () => {
  arrived.length = 0;
  running = await listen({ port: 0, token: ROOT, identify: ana }, watching);
  expect(await knock(`ws://127.0.0.1:${running.port}`, { authorization: 'Bearer ana-secret' })).toBe('open');
  expect(arrived[0]?.id).toBe('ana');
});

it('admits anyone when no token is configured, and still names a person who presents one', async () => {
  arrived.length = 0;
  running = await listen({ port: 0, identify: ana }, watching);
  const url = `ws://127.0.0.1:${running.port}`;
  expect(await knock(url)).toBe('open');
  expect(arrived).toEqual([undefined]);
  expect(await knock(`${url}/?tkn=ana-secret`)).toBe('open');
  expect(arrived[1]?.id).toBe('ana');
});

it('refuses a person\'s token on the next connection once it is no longer theirs', async () => {
  arrived.length = 0;
  let theirs = true;
  running = await listen(
    { port: 0, token: ROOT, identify: (token) => (theirs ? ana(token) : undefined) },
    watching,
  );
  const url = `ws://127.0.0.1:${running.port}`;
  expect(await knock(`${url}/?tkn=ana-secret`)).toBe('open');
  theirs = false;
  expect(await knock(`${url}/?tkn=ana-secret`)).toContain('401');
  // The deployment's own token is unaffected: removal takes a person away and
  // not the door.
  expect(await knock(`${url}/?tkn=${ROOT}`)).toBe('open');
});

it('gives a Node socket its address, its number and the forwarded claim the request carried', async () => {
  openings.length = 0;
  running = await listen({ port: 0 }, watching);
  const url = `ws://127.0.0.1:${running.port}`;
  expect(await knock(url, { 'x-forwarded-for': '203.0.113.9' })).toBe('open');
  // The loopback address the client really connected from, and the number
  // the tap reports its frames under: the first accepted socket is one.
  expect(openings).toHaveLength(1);
  expect(openings[0]).toMatchObject({ socket: 1, address: '127.0.0.1', forwardedFor: '203.0.113.9' });
});

it('cuts the query off the path it reports, so what a row carries holds no token', async () => {
  openings.length = 0;
  running = await listen({ port: 0 }, watching);
  const url = `ws://127.0.0.1:${running.port}`;
  expect(await knock(`${url}/?tkn=secret`)).toBe('open');
  // The path is the URL cut at its query; the token itself stays in `url`,
  // the one field no row carries.
  expect(openings[0]?.path).toBe('/');
  const row = { ...openings[0] } as Record<string, unknown>;
  delete row.url;
  expect(JSON.stringify(row)).not.toContain('secret');
});

it('leaves the forwarded claim off a socket whose request carried none', async () => {
  openings.length = 0;
  running = await listen({ port: 0 }, watching);
  expect(await knock(`ws://127.0.0.1:${running.port}`)).toBe('open');
  expect(openings[0]?.address).toBe('127.0.0.1');
  expect(openings[0]).not.toHaveProperty('forwardedFor');
});

it('admits an unknown token when no connection token is required, and names nobody', async () => {
  /*
   * `--without-connection-token` is a host that requires nothing at the door,
   * so a token nobody recognises is simply a socket that is nobody: it is not
   * refused, and it carries no principal. A directory being configured does
   * not turn the door into a lock.
   */
  arrived.length = 0;
  running = await listen({ port: 0, identify: ana }, watching);
  expect(await knock(`ws://127.0.0.1:${running.port}/?tkn=nope`)).toBe('open');
  expect(arrived).toEqual([undefined]);
});

/** A plain `GET /` on the listener, with `?tkn=` when a token is given and the headers as given. */
const ask = (token?: string, headers?: Record<string, string>): Promise<Response> =>
  fetch(`http://127.0.0.1:${running?.port ?? 0}/${token === undefined ? '' : `?tkn=${encodeURIComponent(token)}`}`, headers === undefined ? {} : { headers });

it('answers a plain request 401 when the handshake would refuse its token, and 426 when it would admit it', async () => {
  running = await listen({ port: 0, token: ROOT, identify: doorOnly }, watching);
  for (const refused of [await ask(), await ask('nope'), await ask(undefined, { authorization: 'Bearer nope' })]) {
    expect(refused.status).toBe(401);
    expect(await refused.text()).toBe('A connection token is required');
    expect(refused.headers.get('access-control-allow-origin')).toBe('*');
  }
  for (const admitted of [await ask(ROOT), await ask('ana-secret'), await ask(undefined, { authorization: `Bearer ${ROOT}` })]) {
    expect(admitted.status).toBe(426);
    expect(await admitted.text()).toBe('ahpd speaks the Agent Host Protocol over WebSocket');
    expect(admitted.headers.get('access-control-allow-origin')).toBe('*');
  }
});

it('sends a refused plain request a bearer challenge: the realm alone with no token, invalid_token with one', async () => {
  running = await listen({ port: 0, token: ROOT, identify: doorOnly }, watching);
  expect((await ask()).headers.get('www-authenticate')).toBe('Bearer realm="ahpd"');
  for (const refused of [await ask('nope'), await ask(undefined, { authorization: 'Bearer nope' })]) {
    expect(refused.status).toBe(401);
    expect(refused.headers.get('www-authenticate')).toBe('Bearer realm="ahpd", error="invalid_token"');
  }
  // The same challenge from the answer the daemon's own HTTP surface mounts.
  const door = doorOf({ token: ROOT });
  expect((await plainAnswer(door, new Request('http://127.0.0.1/'))).headers.get('www-authenticate')).toBe('Bearer realm="ahpd"');
  expect((await plainAnswer(door, new Request('http://127.0.0.1/?tkn=nope'))).headers.get('www-authenticate'))
    .toBe('Bearer realm="ahpd", error="invalid_token"');
  expect((await ask(ROOT)).headers.get('www-authenticate')).toBeNull();
});

it('answers every plain request 426 when no connection token is required', async () => {
  running = await listen({ port: 0 }, watching);
  for (const admitted of [await ask(), await ask('nope')]) {
    expect(admitted.status).toBe(426);
    expect(admitted.headers.get('access-control-allow-origin')).toBe('*');
  }
});

it('decides a plain request and a handshake with the same door', async () => {
  const door = doorOf({ token: ROOT, identify: ana, root: true });
  expect(await door(`/?tkn=${ROOT}`, null)).toEqual({ admitted: true, root: true });
  expect(await door('/', `Bearer ${ROOT}`)).toEqual({ admitted: true, root: true });
  expect((await door('/?tkn=ana-secret', null))).toMatchObject({ admitted: true, principal: { id: 'ana' } });
  expect(await door('/?tkn=nope', null)).toEqual({ admitted: false });
  const answered = await plainAnswer(door, new Request('http://127.0.0.1/?tkn=nope'));
  expect(answered.status).toBe(401);
  expect(answered.headers.get('access-control-allow-origin')).toBe('*');
  expect((await plainAnswer(door, new Request(`http://127.0.0.1/?tkn=${ROOT}`))).status).toBe(426);
});
