import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clientsChannel } from '../src/clients/channel.js';
import { createHost } from '../src/host.js';
import { fileUsers } from '../src/access/users.js';
import { invokeOperation, OPERATION_COMMAND } from '../src/kinds/operations.js';
import { servedRecords } from '../src/resources/recordschannel.js';
import { echo } from '../../../examples/echo/agent.js';
import type { ClientCounts } from '../src/clients/channel.js';
import type { ClientRegistry } from '../src/types/host.js';
import type { Connected } from '../src/types/listen.js';
import type { Peer } from '../src/types/rpc.js';
import type { Users } from '../src/types/users.js';

/*
 * The clients channel over a host serving a few fake sockets.
 *
 * Nothing is a real WebSocket here: a connection is accepted with the socket
 * number, the address and the forwarded claim the listener would have given it,
 * and a peer whose `close` ends the connection as a listener's would. The list
 * and its one operation are read through the host, so the grants are the ones a
 * caller would meet.
 */

const URI = 'x-ahpd-clients://';
const ROOT = 'ahp-root://';

type Bag = Record<string, any>;

let home: string;
let usersFile: string;
let host: ReturnType<typeof createHost>;
let users: Users;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ahpd-clients-'));
  usersFile = join(home, 'users.json');
  writeFileSync(usersFile, JSON.stringify({
    roles: {
      reader: ['client:read'],
      dropper: ['client:drop'],
      both: ['client:read', 'client:drop'],
    },
    users: [
      { id: 'ana', roles: ['reader'] },
      { id: 'bo', roles: [] },
      { id: 'cy', roles: ['dropper'] },
      { id: 'di', roles: ['both'] },
    ],
  }));
});

afterEach(async () => {
  await host?.close();
  rmSync(home, { recursive: true, force: true });
});

/** A host serving the clients channel, with the registry bound as the daemon binds it. */
const served = (counters?: (socket: number) => ClientCounts | undefined) => {
  let registry: ClientRegistry | undefined;
  const clients = clientsChannel({ registry: () => registry, ...(counters === undefined ? {} : { counters }) });
  const wire = servedRecords('ahpd', [clients.channel], {
    [OPERATION_COMMAND]: invokeOperation({ channels: () => ({ [URI]: clients.operations }), check: () => {} }),
  });
  users = fileUsers({ path: usersFile });
  host = createHost({
    path: home,
    agents: [{ ...echo({ path: home, pace: 0 }), provider: 'base', displayName: 'Base' }],
    channels: wire.channels,
    methods: wire.methods,
    users,
  });
  registry = host.clientRegistry;
  // As `run.ts` does: each arrival and departure sends the readers what moved.
  host.clientRegistry.watch(() => { void clients.refresh(); });
  return host;
};

/** One accepted socket, as a client drives it. */
interface Sock {
  socket: number;
  /** Every notification the host sent this client. */
  notes: { method: string; params: Bag }[];
  /** Whether the peer was closed. */
  closed: string[];
  call(method: string, params: Bag): Promise<Bag>;
  close(): void;
}

/** A peer nobody drives, for a connection whose row is read and nothing else. */
const idle = (): Peer => ({
  send: () => {},
  notify: () => {},
  request: async () => ({}),
  answered: () => {},
  close: () => {},
});

/** A connection on `socket`, introduced as `clientId`, and signed in as `id` when it is given. */
const connect = async (socket: number, clientId: string, id?: string, locale?: string): Promise<Sock> => {
  const notes: Sock['notes'] = [];
  const closed: string[] = [];
  let connected: Connected | undefined;
  const peer: Peer = {
    send: () => {},
    notify: (method, params) => { notes.push({ method, params: params as Bag }); },
    request: async () => ({}),
    answered: () => {},
    close: () => { closed.push('closed'); connected?.close(); },
  };
  connected = host.accept(peer, undefined, false, { socket, address: '127.0.0.1', forwardedFor: '203.0.113.9' });
  const call = async (method: string, params: Bag): Promise<Bag> => connected!.handle({ method, params }).then(
    (result) => ({ result: result as Bag }),
    (error: { code: number; message: string }) => ({ code: error.code, message: error.message }),
  );
  await call('initialize', { clientId, protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT], ...(locale === undefined ? {} : { locale }) });
  if (id !== undefined) {
    const token = await users.mint(id);
    const answer = await call('authenticate', { channel: ROOT, resource: users.resource.resource, token });
    if (answer['code'] !== undefined) throw new Error(`authenticate refused: ${JSON.stringify(answer)}`);
  }
  return { socket, notes, closed, call, close: () => { connected!.close(); } };
};

/** The rows a subscribe answers, by id. */
const subscribe = async (one: Sock): Promise<Record<string, Bag>> => {
  const answer = await one.call('subscribe', { channel: URI });
  if (answer['result'] === undefined) throw new Error(`subscribe refused: ${JSON.stringify(answer)}`);
  const state = answer['result']['snapshot'].state as Bag;
  const records = state['records'] as { id: string; record: Bag }[];
  return Object.fromEntries(records.map((row) => [row.id, row.record]));
};

/** Every row id a channel action this client was sent names. */
const removedFor = (one: Sock): string[] => one.notes
  .filter((note) => note.method === 'action' && note.params['action']?.type === 'x-ahpd-clients/removed')
  .map((note) => note.params['action'].id as string);

/** Every row id this client was sent a changed action for. */
const changedFor = (one: Sock): string[] => one.notes
  .filter((note) => note.method === 'action' && note.params['action']?.type === 'x-ahpd-clients/changed')
  .map((note) => note.params['action'].id as string);

/** One turn of the loop, which is when a drop closes its peer. */
const tick = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });

it('lists one row for each connection, with the address and the claim the listener gave it', async () => {
  await served();
  const first = await connect(7, 'ana-window', 'ana');
  await connect(8, 'bo-window');

  const rows = await subscribe(first);
  expect(Object.keys(rows)).toEqual(['7', '8']);
  expect(rows['7']).toMatchObject({
    id: '7',
    socket: 7,
    clientId: 'ana-window',
    address: '127.0.0.1',
    forwardedFor: '203.0.113.9',
    principal: 'ana',
    subscriptions: [ROOT],
  });
  expect(typeof rows['7']?.['connectedAt']).toBe('number');
  expect(rows['8']).toMatchObject({ id: '8', socket: 8, clientId: 'bo-window' });
  // The claim is the text that arrived, not a resolved address.
  expect(rows['8']?.['forwardedFor']).toBe('203.0.113.9');
});

it('puts a principal\'s roles and team beside their id, and marks a root socket', async () => {
  await served();
  const ana = await connect(8, 'ana-window', 'ana');
  // A connection handed a principal at the door, with roles and a team.
  host.accept(idle(), { id: 'bo', roles: ['reader', 'admin'], team: 'core', can: () => true }, false, { socket: 9, address: '127.0.0.1' });
  // A socket admitted on the deployment's own token is the host itself.
  host.accept(idle(), undefined, true, { socket: 10, address: '127.0.0.1' });

  const rows = await subscribe(ana);
  expect(rows['9']).toMatchObject({ id: '9', principal: 'bo', roles: ['reader', 'admin'], team: 'core' });
  expect(rows['10']).toMatchObject({ id: '10', root: true });
  expect(rows['8']).toMatchObject({ id: '8', principal: 'ana', roles: ['reader'] });
  expect(rows['8']).not.toHaveProperty('root');
});

it('tells every reader that a connection closed, and its row is gone', async () => {
  await served();
  const leaving = await connect(7, 'leaving');
  const ana = await connect(8, 'ana-window', 'ana');
  const di = await connect(9, 'di-window', 'di');
  await subscribe(ana);
  await subscribe(di);

  leaving.close();
  await tick();

  expect(removedFor(ana)).toEqual(['7']);
  expect(removedFor(di)).toEqual(['7']);
  expect(Object.keys(await subscribe(ana))).toEqual(['8', '9']);
});

it('refuses a subscribe from a person without client:read', async () => {
  await served();
  const bo = await connect(8, 'bo-window', 'bo');
  expect(await bo.call('subscribe', { channel: URI })).toMatchObject({ code: -32009, message: 'bo may not client:read here' });
});

it('refuses a drop from a caller without client:drop, and the socket stays open', async () => {
  await served();
  const target = await connect(7, 'target');
  const ana = await connect(8, 'ana-window', 'ana');
  expect(await ana.call(OPERATION_COMMAND, { channel: URI, operationId: 'drop', target: { id: '7' } }))
    .toMatchObject({ code: -32009 });
  await tick();
  expect(target.closed).toEqual([]);
  expect(Object.keys(await subscribe(ana))).toContain('7');
});

it('answers a drop with the row, and then closes that socket', async () => {
  await served();
  const target = await connect(7, 'target');
  const di = await connect(8, 'di-window', 'di');

  const answer = await di.call(OPERATION_COMMAND, { channel: URI, operationId: 'drop', target: { id: '7' } });
  expect(answer['result']).toMatchObject({ id: '7', socket: 7, clientId: 'target' });
  await tick();
  expect(target.closed).toEqual(['closed']);
});

it('answers a caller that drops its own socket before the socket goes', async () => {
  await served();
  const di = await connect(9, 'di-window', 'di');

  const answer = await di.call(OPERATION_COMMAND, { channel: URI, operationId: 'drop', target: { id: '9' } });
  // The answer is in hand, and the peer has not been closed yet.
  expect(answer['result']).toMatchObject({ id: '9', clientId: 'di-window' });
  expect(di.closed).toEqual([]);
  await tick();
  expect(di.closed).toEqual(['closed']);
});

it('refuses a drop on a socket no connection holds, with -32001', async () => {
  await served();
  const di = await connect(8, 'di-window', 'di');
  expect(await di.call(OPERATION_COMMAND, { channel: URI, operationId: 'drop', target: { id: '404' } }))
    .toMatchObject({ code: -32001, message: 'No client on socket 404 is connected' });
});

it('lists a dropped client that connects again as a new row', async () => {
  await served();
  const again = await connect(7, 'ana-window', 'di');
  const di = await connect(8, 'di-window', 'di');
  await subscribe(again);

  await di.call(OPERATION_COMMAND, { channel: URI, operationId: 'drop', target: { id: '7' } });
  await tick();

  const back = await connect(9, 'ana-window', 'di');
  const rows = await subscribe(back);
  expect(Object.keys(rows).sort()).toEqual(['8', '9']);
  expect(rows['9']).toMatchObject({ id: '9', clientId: 'ana-window' });
});

it('counts the frames and bytes its socket carried, in each direction', async () => {
  const counts = new Map<number, ClientCounts>();
  await served((socket) => counts.get(socket));
  const ana = await connect(8, 'ana-window', 'ana');
  counts.set(8, { framesIn: 3, framesOut: 5, bytesIn: 120, bytesOut: 340 });

  const rows = await subscribe(ana);
  expect(rows['8']).toMatchObject({ framesIn: 3, framesOut: 5, bytesIn: 120, bytesOut: 340 });
});

it('sends a change in the counts on the five-second tick, and not before', async () => {
  const counts = new Map<number, ClientCounts>();
  await served((socket) => counts.get(socket));
  const ana = await connect(8, 'ana-window', 'ana');

  // Faked from the subscribe, which is where the timer starts.
  vi.useFakeTimers();
  try {
    await subscribe(ana);
    counts.set(8, { framesIn: 1, framesOut: 2, bytesIn: 3, bytesOut: 4 });

    await vi.advanceTimersByTimeAsync(4_999);
    expect(changedFor(ana)).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(changedFor(ana)).toEqual(['8']);
    const changed = ana.notes.find((note) => note.method === 'action' && note.params['action']?.type === 'x-ahpd-clients/changed');
    expect(changed?.params['action'].record).toMatchObject({ framesIn: 1, framesOut: 2, bytesIn: 3, bytesOut: 4 });
  } finally {
    vi.useRealTimers();
  }
});

it('runs the counter timer only while the list has a subscriber', async () => {
  const set = vi.spyOn(globalThis, 'setInterval');
  const clear = vi.spyOn(globalThis, 'clearInterval');
  try {
    await served((socket) => ({ framesIn: 0, framesOut: 0, bytesIn: 0, bytesOut: 0 }));
    const ana = await connect(8, 'ana-window', 'ana');
    expect(set).not.toHaveBeenCalled();

    await subscribe(ana);
    expect(set).toHaveBeenCalledWith(expect.any(Function), 5_000);

    await ana.call('unsubscribe', { channel: URI });
    expect(clear).toHaveBeenCalled();
  } finally {
    set.mockRestore();
    clear.mockRestore();
  }
});

it('offers drop as one operation on a client, with a grant and a confirmation', async () => {
  await served();
  const ana = await connect(8, 'ana-window', 'ana');
  const answer = await ana.call('subscribe', { channel: URI });
  const operations = answer['result']['snapshot'].state.operations as Bag[];
  expect(operations).toEqual([expect.objectContaining({
    id: 'drop',
    kind: 'host',
    label: 'Drop',
    scopes: ['client'],
    grant: 'client:drop',
    confirmation: expect.any(String),
  })]);
});

it('lists the drop operation in the locale the client sent, and in English for one that sent none', async () => {
  await served();
  const pt = await connect(7, 'ana-window', 'ana', 'pt');
  const en = await connect(8, 'ana-other', 'ana');
  const operationsOf = async (one: Sock): Promise<Bag[]> =>
    ((await one.call('subscribe', { channel: URI }))['result']!['snapshot'].state as Bag)['operations'] as Bag[];

  expect((await operationsOf(pt))[0]).toMatchObject({
    id: 'drop',
    label: 'Desconectar',
    description: 'Fecha esta conexão. O cliente pode se conectar de novo na hora.',
    confirmation: 'Desconectar este cliente? A conexão fecha agora e ele pode se conectar de novo.',
  });
  expect((await operationsOf(en))[0]).toMatchObject({
    id: 'drop',
    label: 'Drop',
    description: 'Closes this connection. The client can connect again at once.',
    confirmation: 'Drop this client? Its connection closes now, and it can connect again.',
  });
});
