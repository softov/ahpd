/*
 * `x-ahpd/update` over AHP: who may send it, and what the root connection gets.
 *
 * The method is the daemon's own, built over the facts the command reads and
 * served by a host in this process. A person signs in with a role that holds
 * `config:write`, which is what the grant asks for; the owner is what refuses
 * them, because an update replaces the code the host runs. Nothing here runs
 * npm or a real restart: the install place, the plugin root, npm, the registry
 * and the restart are facts.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHost, fileUsers, ROOT } from '@ahpd/sdk';
import { echo } from '../../../examples/echo/agent.js';
import type { Running } from '../src/daemon.js';
import type { Ran, Runner } from '../src/install.js';
import type { Options } from '../src/commands/options.js';
import type { ServedFacts } from '../src/commands/served.js';
import { updateMethod } from '../src/commands/update.js';
import type { UpdateFacts } from '../src/commands/update.js';
import type { PlaceFacts } from '../src/selfupdate.js';
import type { Fetch } from '../src/update.js';
import { version } from '../src/version.js';

const AUTHORITY = '127.0.0.1:9350';
/** What the fake registry calls latest. Above any version this package will be. */
const LATEST = '99.0.0';
/** The version the code under test came from. */
const CURRENT = version();

let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'ahpd-host-update-')); });
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

/** The record `ahpd start` would have written for the daemon being updated. */
const RECORD: Running = {
  pid: 4242,
  url: `ws://${AUTHORITY}`,
  connectUrl: `ws://${AUTHORITY}/`,
  paths: [],
  startedAt: '2026-10-19T00:00:00.000Z',
  argv: ['--port', '9350'],
};

/**
 * The test's folder as a POSIX path: with forward slashes, which Linux's path
 * rules read and Windows' file calls take, so a Linux install can be made up
 * inside it on any system.
 */
const posixHome = (): string => home.replaceAll('\\', '/');

/**
 * A global install this test makes up: the shape is what `installPlace` reads.
 *
 * A Linux machine's, on any system the suite runs on: these cases are the
 * install that runs in this process, and Windows hands it to a helper instead,
 * which its own case drives. Under the test's folder, which is where the fake
 * npm writes what it installs.
 */
const install = (): PlaceFacts => ({
  root: `${posixHome()}/npm-prefix/lib/node_modules/@ahpd/server`,
  platform: 'linux',
  real: (path) => path,
  exists: () => false,
});

/** A configuration directory whose `package.json` lists no plugins. */
const configDir = (): string => {
  const dir = join(home, 'ahpd');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: {} }));
  return dir;
};

/** A runner that records every npm call, and succeeds. */
const fakeNpm = (): { calls: string[][]; runner: Runner } => {
  const calls: string[][] = [];
  const runner: Runner = async (_program, argv) => {
    calls.push([...argv]);
    return { code: 0, stdout: '', stderr: '' } satisfies Ran;
  };
  return { calls, runner };
};

/** A registry that names `latest` for the server itself, and nothing for anything else. */
const registry = (latest = LATEST): Fetch => async (url) => (String(url).endsWith('/dist-tags')
  ? Response.json({ latest })
  : new Response('{}', { status: 404 }));

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
 * A host serving the update, over a users file whose one role holds
 * `config:write`, and the restart the daemon's own facts record.
 */
const served = (facts: UpdateFacts = {}): {
  host: Host;
  users: ReturnType<typeof fileUsers>;
  restarted: { argv: string[]; force: boolean }[];
  npm: { calls: string[][]; runner: Runner };
} => {
  const usersFile = join(home, 'users.json');
  writeFileSync(usersFile, JSON.stringify({
    roles: { keeper: ['config:write'] },
    users: [{ id: 'ada', roles: ['keeper'] }],
  }));
  const users = fileUsers({ path: usersFile });
  const restarted: { argv: string[]; force: boolean }[] = [];
  const npm = fakeNpm();
  const daemon: ServedFacts = {
    options: {} as Options,
    configFile: join(home, 'config.json'),
    running: () => ({ pid: RECORD.pid, url: RECORD.url, host: '127.0.0.1', port: 9350, paths: [], startedAt: '' }),
    turning: () => [],
    restart: (argv, force) => {
      restarted.push({ argv: [...argv], force });
      return { restartDelayMs: 3000 };
    },
  };
  const host = createHost({
    path: home,
    agents: [{ ...echo({ path: home, pace: 0 }), provider: 'base' }],
    users,
    methods: {
      'x-ahpd/update': {
        by: 'ahpd',
        name: 'x-ahpd/update',
        method: updateMethod(daemon, {
          record: () => RECORD,
          place: install(),
          configDir: configDir(),
          run: npm.runner,
          npmVersion: async () => '11.15.0',
          takes: async () => {},
          fetch: registry(),
          ...facts,
        }),
      },
    },
  });
  return { host, users, restarted, npm };
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

describe('x-ahpd/update', () => {
  it('refuses a person who holds config:write, naming the deployment token', async () => {
    const { host, users } = served();
    const client = await person(host, users);
    const refused = await answered(client.handle({
      method: 'x-ahpd/update',
      params: { check: true },
    }));
    expect(refused).toMatchObject({
      code: -32009,
      message: 'ada may not update the daemon here; only the deployment token may',
    });
    await host.close();
  });

  it('answers the root connection a check with the versions, and does not install', async () => {
    const { host, npm, restarted } = served();
    const client = await root(host);
    const result = await client.handle({ method: 'x-ahpd/update', params: { check: true } });
    expect(result).toEqual({ current: CURRENT, latest: LATEST, may: true });
    expect(npm.calls).toEqual([]);
    expect(restarted).toEqual([]);
    await host.close();
  });

  it('answers the root connection an update, and runs the daemon\'s own restart', async () => {
    const { host, npm, restarted } = served();
    const client = await root(host);
    const result = await client.handle({ method: 'x-ahpd/update', params: {} });
    expect(result).toMatchObject({ from: CURRENT, to: LATEST, restarting: true, left: [] });
    // npm installed the version the plan chose, where this install is.
    expect(npm.calls[0]).toEqual(['install', '-g', '--prefix', `${posixHome()}/npm-prefix`, `@ahpd/server@${LATEST}`]);
    // The daemon's own line, as its record holds it, and not forced.
    expect(restarted).toEqual([{ argv: ['--port', '9350'], force: false }]);
    await host.close();
  });

  it('asks the registry for the encoded scoped path when no version is named', async () => {
    const asked: string[] = [];
    const recording: Fetch = async (url) => {
      asked.push(String(url));
      return Response.json({ latest: LATEST });
    };
    const { host } = served({ fetch: recording });
    const client = await root(host);
    const result = await client.handle({ method: 'x-ahpd/update', params: { check: true } });
    expect(result).toEqual({ current: CURRENT, latest: LATEST, may: true });
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatch(/\/-\/package\/@ahpd%2fserver\/dist-tags$/);
    await host.close();
  });

  it('answers a failed step with an RpcError, and asks for no restart', async () => {
    const npm = fakeNpm();
    const failing: Runner = async (program, argv) => {
      await npm.runner(program, argv);
      return { code: 1, stdout: '', stderr: 'EACCES: permission denied' };
    };
    const { host, restarted } = served({ run: failing });
    const client = await root(host);
    const refused = await answered(client.handle({ method: 'x-ahpd/update', params: {} }));
    expect(refused).toMatchObject({
      code: -32603,
      message: `npm could not install @ahpd/server@${LATEST}: EACCES: permission denied`,
    });
    expect(restarted).toEqual([]);
    await host.close();
  });
});
