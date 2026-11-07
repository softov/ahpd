/*
 * `x-ahpd/restart` over AHP: who may send it, and what the root connection gets.
 *
 * The method is the daemon's own, built over the facts the command reads and
 * served by a host in this process. A person signs in with a role that holds
 * `config:write`, which is what the grant asks for; the owner is what refuses
 * them, because a restart ends the running turns of every person on the host.
 * Nothing here signals a process or restarts a daemon: the record is a file this
 * test writes, and the restart is a fact that records what it was asked.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHost, fileUsers, ROOT } from '@ahpd/sdk';
import { echo } from '../../../examples/echo/agent.js';
import type { Running } from '../src/daemon.js';
import type { Options } from '../src/commands/options.js';
import { FOREGROUND, restartMethod } from '../src/commands/restart.js';
import type { ServedFacts } from '../src/commands/served.js';

const AUTHORITY = '127.0.0.1:9350';
const ARGV = ['--port', '9350'];

let home: string;
let had: string | undefined;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ahpd-host-restart-'));
  had = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = home;
  mkdirSync(join(home, 'ahpd'), { recursive: true });
});
afterEach(() => {
  if (had === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = had;
  rmSync(home, { recursive: true, force: true });
});

/** The record `ahpd start` would have written for this daemon, or none for one in the foreground. */
const started = (pid = process.pid): void => {
  const record: Running = {
    pid,
    url: `ws://${AUTHORITY}`,
    connectUrl: `ws://${AUTHORITY}/`,
    paths: [],
    startedAt: '2026-10-30T00:00:00.000Z',
    argv: ARGV,
  };
  writeFileSync(join(home, 'ahpd', 'daemon.json'), JSON.stringify(record));
};

type Host = ReturnType<typeof createHost>;
type Client = ReturnType<Host['accept']>;

/** A peer with no wire of its own, enough for a host in this process. */
const peer = () => ({
  send: () => {},
  notify: () => {},
  request: async () => ({}),
  answered: () => {},
  close: () => {},
});

/** The handshake every client sends first. */
const hello = (client: Client, clientId = 'probe'): Promise<unknown> => client.handle({
  method: 'initialize',
  params: { clientId, protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] },
});

/** What a request was refused with, or the answer it gave. */
const answered = async (asking: Promise<unknown>): Promise<Record<string, unknown>> => asking.then(
  (result) => ({ result: result as Record<string, unknown> }),
  (error: { code: number; message: string }) => error as unknown as Record<string, unknown>,
);

/**
 * A host serving the restart, over a users file whose one role holds
 * `config:write`, and the restarts the daemon's own facts record.
 */
const served = (turning: string[] = []): {
  host: Host;
  users: ReturnType<typeof fileUsers>;
  restarted: { argv: string[]; force: boolean }[];
  facts: ServedFacts;
} => {
  const usersFile = join(home, 'users.json');
  writeFileSync(usersFile, JSON.stringify({
    roles: { keeper: ['config:write'] },
    users: [{ id: 'ada', roles: ['keeper'] }],
  }));
  const users = fileUsers({ path: usersFile });
  const restarted: { argv: string[]; force: boolean }[] = [];
  const facts: ServedFacts = {
    options: {} as Options,
    configFile: join(home, 'config.json'),
    users,
    running: () => ({ pid: process.pid, url: `ws://${AUTHORITY}`, host: '127.0.0.1', port: 9350, paths: [], startedAt: '' }),
    turning: () => turning,
    // As the daemon's restart answers: parked while a turn runs, unless forced.
    restart: (argv, force) => {
      restarted.push({ argv: [...argv], force });
      return turning.length > 0 && !force ? { parked: turning } : { restartDelayMs: 3000 };
    },
  };
  const host = createHost({
    path: home,
    agents: [{ ...echo({ path: home, pace: 0 }), provider: 'base' }],
    users,
    methods: {
      'x-ahpd/restart': { by: 'ahpd', name: 'x-ahpd/restart', method: restartMethod(facts) },
    },
  });
  return { host, users, restarted, facts };
};

/** A client that has signed in as `id`, with the token the directory mints for them. */
const person = async (host: Host, users: ReturnType<typeof fileUsers>, id = 'ada'): Promise<Client> => {
  const token = await users.mint(id);
  const client = host.accept(peer());
  await hello(client);
  await client.handle({ method: 'authenticate', params: { channel: ROOT, resource: users.resource.resource, token } });
  return client;
};

/** A client that is this host, as the deployment's own token makes one. */
const root = async (host: Host): Promise<Client> => {
  const client = host.accept(peer(), undefined, true);
  await hello(client, 'root');
  return client;
};

describe('x-ahpd/restart', () => {
  it('refuses a person who holds config:write, naming the deployment token', async () => {
    started();
    const { host, users } = served();
    const client = await person(host, users);
    const refused = await answered(client.handle({ method: 'x-ahpd/restart', params: {} }));
    expect(refused).toMatchObject({
      code: -32009,
      message: 'ada may not restart the daemon here; only the deployment token may',
    });
    await host.close();
  });

  it('refuses an owner that names a person, even with no reader beside it', async () => {
    started();
    const { facts } = served();
    const method = restartMethod(facts);
    await expect(Promise.resolve(method.handle({}, undefined, 'probe', 'user:ada')))
      .rejects.toMatchObject({ message: 'user:ada may not restart the daemon here; only the deployment token may' });
  });

  it('restarts for the root connection, with the line the record holds', async () => {
    started();
    const { host, restarted } = served();
    const client = await root(host);
    const result = await client.handle({ method: 'x-ahpd/restart', params: {} });
    // VS Code's upgrade answer carries how long until the server goes down.
    expect(result).toEqual({ restarting: true, pid: process.pid, restartDelayMs: 3000 });
    expect(restarted).toEqual([{ argv: ARGV, force: false }]);
    await host.close();
  });

  it('answers a restart parked while a turn runs, naming the session', async () => {
    started();
    const { host, restarted } = served(['ahp-session:/a']);
    const client = await root(host);
    const result = await client.handle({ method: 'x-ahpd/restart', params: {} });
    expect(result).toEqual({ restarting: false, pid: process.pid, parked: ['ahp-session:/a'] });
    expect(restarted).toEqual([{ argv: ARGV, force: false }]);
    await host.close();
  });

  it('restarts while a turn runs when the caller forces it', async () => {
    started();
    const { host, restarted } = served(['ahp-session:/a']);
    const client = await root(host);
    const result = await client.handle({ method: 'x-ahpd/restart', params: { force: true } });
    expect(result).toEqual({ restarting: true, pid: process.pid, restartDelayMs: 3000 });
    expect(restarted).toEqual([{ argv: ARGV, force: true }]);
    await host.close();
  });

  it('refuses a daemon in the foreground, and says where to restart it', async () => {
    const { host, restarted } = served();
    const client = await root(host);
    const refused = await answered(client.handle({ method: 'x-ahpd/restart', params: {} }));
    expect(refused).toMatchObject({ code: -32603, message: FOREGROUND });
    expect(restarted).toEqual([]);
    await host.close();
  });

  it('takes force and only force from the params', async () => {
    started();
    const { host, restarted } = served();
    const client = await root(host);
    await client.handle({ method: 'x-ahpd/restart', params: { force: 'yes', check: true } });
    expect(restarted).toEqual([{ argv: ARGV, force: false }]);
    await host.close();
  });
});
