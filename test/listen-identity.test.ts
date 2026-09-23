import { afterEach, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { listen } from '../packages/sdk/src/listen.js';
import type { Connected, Listener } from '../packages/sdk/src/types/listen.js';
import type { Peer } from '../packages/sdk/src/types/rpc.js';
import type { Principal } from '../packages/sdk/src/types/users.js';

/*
 * The door, and who it lets in.
 *
 * The deployment's own token admits the socket and names nobody. A person's
 * own token admits it and arrives as their principal before the first frame,
 * which is the whole reason a client that can only carry a URL works. Worth a
 * real socket rather than a unit test of the resolution: what is being
 * checked is what the handshake decided.
 */

let running: Listener | undefined;

afterEach(async () => {
  await running?.close();
  running = undefined;
});

const ROOT = 'sesame';

const ana = (token: string): Principal | undefined =>
  (token === 'ana-secret' ? { id: 'ana', roles: ['admin'], can: () => true } : undefined);

/** What each connection arrived as, in the order they were accepted. */
const arrived: (Principal | undefined)[] = [];
/** And whether each was admitted as the host itself. */
const roots: (boolean | undefined)[] = [];
const watching = (_peer: Peer, principal?: Principal, root?: boolean): Connected => {
  arrived.push(principal);
  roots.push(root);
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

it('admits a person\'s own token and arrives as them', async () => {
  arrived.length = 0;
  running = await listen({ port: 0, token: ROOT, identify: ana }, watching);
  const url = `ws://127.0.0.1:${running.port}`;
  expect(await knock(`${url}/?tkn=ana-secret`)).toBe('open');
  expect(arrived[0]?.id).toBe('ana');
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
