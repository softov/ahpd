/*
 * `ahpd update` and `POST /api/update`, up to the refusals, the install, the
 * plugin move and the restart.
 *
 * The registry is a local HTTP server, reached through `npm_config_registry` as
 * npm itself would be, so no case touches npm or npmjs.org. The record, the
 * turns running, the install place, npm and the restart are the facts
 * `declareUpdate` takes, so a case needs neither a daemon nor an install of
 * this package; the one that is here is a checkout and is refused, which is the
 * refusal under test. npm is a runner that records its arguments and leaves the
 * packages where the call's own `--prefix` says, as npm does.
 */

import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRegistry } from '@cofold/commands';
import type { Output } from '@cofold/commands';
import { manifestFrom } from '@cofold/remote';
import { fileUsers } from '@ahpd/sdk';
import type { Running } from '../src/daemon.js';
import type { Ran, Runner } from '../src/install.js';
import type { Options } from '../src/commands/options.js';
import { cliRegistry } from '../src/commands/registry.js';
import { FOREGROUND, busy } from '../src/commands/restart.js';
import { apiOrigins } from '../src/commands/run.js';
import { checkScopes } from '../src/commands/scopes.js';
import { servedRegistry } from '../src/commands/served.js';
import type { ServedFacts } from '../src/commands/served.js';
import { declareUpdate } from '../src/commands/update.js';
import type { UpdateFacts } from '../src/commands/update.js';
import { apiHandler } from '../src/http.js';
import { planUpdate } from '../src/selfupdate.js';
import type { HelperOptions, PlaceFacts } from '../src/selfupdate.js';
import type { Fetch } from '../src/update.js';
import { version } from '../src/version.js';

const AUTHORITY = '127.0.0.1:9350';
/** What the fake registry calls latest. Above any version this package will be. */
const LATEST = '99.0.0';
/** The version the code under test came from. */
const CURRENT = version();

let home: string;
let hadHome: string | undefined;
let hadRegistry: string | undefined;
let registryServer: Server;
/** What the local registry answers as `dist-tags.latest`; `undefined` is a registry that says nothing. */
let latest: string | undefined;

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'ahpd-update-'));
  hadHome = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = home;
  hadRegistry = process.env.npm_config_registry;
  latest = LATEST;
  registryServer = createServer((request, response) => {
    // npm's encoded form, and only it: a registry that needs the scope's slash
    // encoded, such as verdaccio, answers 404 to the unencoded path, which is
    // what the else branch below does.
    if (request.url === '/-/package/@ahpd%2fserver/dist-tags' && latest !== undefined) {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ latest }));
      return;
    }
    response.statusCode = 404;
    response.end('{}');
  });
  await new Promise<void>((done) => { registryServer.listen(0, '127.0.0.1', done); });
  process.env.npm_config_registry = `http://127.0.0.1:${String((registryServer.address() as AddressInfo).port)}`;
});

afterEach(async () => {
  if (hadHome === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = hadHome;
  if (hadRegistry === undefined) delete process.env.npm_config_registry; else process.env.npm_config_registry = hadRegistry;
  await new Promise<void>((done) => { registryServer.close(() => { done(); }); });
  rmSync(home, { recursive: true, force: true });
});

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

/** A configuration directory whose `package.json` lists `dependencies`, with `installed` left in `node_modules` as npm would have. */
const plugins = (dependencies: Record<string, string>, installed: Record<string, string> = {}): string => {
  const dir = join(home, 'ahpd');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies }));
  for (const [name, held] of Object.entries(installed)) {
    mkdirSync(join(dir, 'node_modules', name), { recursive: true });
    writeFileSync(join(dir, 'node_modules', name, 'package.json'), JSON.stringify({ name, version: held }));
  }
  return dir;
};

/** A name and an exact version, as npm is given them: `@scope/name@1.2.3`. */
const SPEC = /^((?:@[^/]+\/)?[^@/]+)@(\d+\.\d+\.\d+)$/u;

/**
 * A runner that records every npm call, lets `answer` fail one, and leaves the
 * packages a successful install names where the call's own `--prefix` says.
 * Flags after the prefix that are not a name at an exact version, such as
 * `--legacy-peer-deps`, are skipped, since npm is not asked to install them.
 */
const fakeNpm = (answer: (argv: readonly string[]) => Ran = () => ({ code: 0, stdout: '', stderr: '' })): {
  calls: string[][];
  runner: Runner;
} => {
  const calls: string[][] = [];
  const runner: Runner = async (_program, argv) => {
    calls.push([...argv]);
    const done = answer(argv);
    const at = argv.indexOf('--prefix');
    if (argv[0] !== 'install' || done.code !== 0 || at === -1) return done;
    const into = argv[at + 1] as string;
    for (const spec of argv.slice(at + 2)) {
      const found = SPEC.exec(spec);
      const name = found?.[1];
      const held = found?.[2];
      if (name === undefined || held === undefined) continue;
      mkdirSync(join(into, 'node_modules', name), { recursive: true });
      writeFileSync(join(into, 'node_modules', name, 'package.json'), JSON.stringify({ name, version: held }));
    }
    return done;
  };
  return { calls, runner };
};

/**
 * A registry with the versions each plugin has, as `[version, @ahpd/sdk peer
 * range]`; no range is a version any sdk admits. The last version is `latest`.
 * A name not listed is a 404, which `fittingVersion` answers as no choice.
 */
const pluginRegistry = (versions: Record<string, [string, string | undefined][]>): Fetch => async (url) => {
  const asked = decodeURIComponent(String(url));
  for (const [name, held] of Object.entries(versions)) {
    if (!asked.endsWith(`/${name}`)) continue;
    const latest = held.at(-1)?.[0];
    return Response.json({
      'dist-tags': latest === undefined ? {} : { latest },
      versions: Object.fromEntries(held.map(([held, range]) => [held, range === undefined ? {} : { peerDependencies: { '@ahpd/sdk': range } }])),
    });
  }
  return new Response('{}', { status: 404 });
};

/** Long enough for a restart asked for after the answer to have run. */
const tick = (): Promise<void> => new Promise((done) => { setTimeout(done, 0); });

/** The daemon's own facts, with the sessions it says are turning. */
const servedFacts = (turning: string[] = []): ServedFacts => ({
  options: {} as Options,
  configFile: join(home, 'config.json'),
  running: () => ({ pid: RECORD.pid, url: RECORD.url, host: '127.0.0.1', port: 9350, paths: [], startedAt: '' }),
  turning: () => turning,
  restart: () => ({ restartDelayMs: 3000 }),
});

/**
 * One terminal command, against the facts a case hands it.
 *
 * Nothing here runs a real npm or a real restart: a successful install is a
 * runner that answers zero, the successor is a check that passes, and the
 * terminal restart is a function a case can watch. An update that succeeds
 * asks for that restart on the next turn of the loop, which `tick` waits for.
 */
const update = async (input: Record<string, unknown>, facts: UpdateFacts = {}): Promise<Output | null> => {
  const registry = createRegistry({ authorize: checkScopes });
  const command = declareUpdate(registry, undefined, {
    record: () => RECORD,
    place: install(),
    configDir: join(home, 'ahpd'),
    run: fakeNpm().runner,
    npmVersion: async () => '11.15.0',
    takes: async () => {},
    restart: () => {},
    ...facts,
  });
  return registry.execute(command, { surface: 'cli', input });
};

/** The sentence one terminal command was refused with. */
const refusal = async (input: Record<string, unknown>, facts: UpdateFacts = {}): Promise<string> => {
  try { await update(input, facts); }
  catch (error) { return error instanceof Error ? error.message : String(error); }
  throw new Error('it was not refused');
};

/** The daemon's API, with a person to refuse and the update's own facts. */
const api = async (options: { place?: PlaceFacts; record?: Running } = {}): Promise<{
  post: (body: unknown, token?: string) => Promise<Response>;
  person: string;
}> => {
  const usersFile = join(home, 'users.json');
  writeFileSync(usersFile, JSON.stringify({ roles: {}, users: [] }));
  const users = fileUsers({ path: usersFile });
  await users.add('ada', ['admin']);
  const person = await users.mint('ada');
  const facts = servedFacts();
  const registry = options.place === undefined
    ? servedRegistry(facts)
    : (() => {
        const made = createRegistry({ authorize: checkScopes });
        declareUpdate(made, facts, {
          record: () => options.record,
          place: options.place,
        });
        return made;
      })();
  const handler = apiHandler({
    registry,
    token: 'root-secret',
    users,
    program: { name: 'ahpd', version: '0.0.0' },
    origins: () => apiOrigins('127.0.0.1', undefined, 9350),
  });
  const post = (body: unknown, token = 'root-secret'): Promise<Response> => handler(new Request(`http://${AUTHORITY}/api/update`, {
    method: 'POST',
    headers: { host: AUTHORITY, 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  }));
  return { person, post };
};

describe('the declaration', () => {
  it('is one command on the terminal and a POST on the API, with the deployment token alone', () => {
    const command = cliRegistry().find('daemon.update');
    expect(command).toBeDefined();
    expect(command?.scopes).toEqual(['config:write']);
    expect(command?.meta?.deploymentTokenOnly).toBe('update the daemon');

    // The same command over the served registry, with the three inputs a caller
    // may send and no positional one.
    const served = manifestFrom(servedRegistry(servedFacts()), { name: 'ahpd', version: '0.0.0' });
    const at = served.commands.find((one) => one.id === 'daemon.update');
    expect(at).toMatchObject({ pattern: ['update'], http: { method: 'POST', path: '/update' } });
    const inputs = [...(at?.options ?? []).map((one) => one.field ?? one.name), ...Object.keys(at?.arguments ?? {})].sort();
    expect(inputs).toEqual(['check', 'force', 'version']);
  });
});

describe('ahpd update', () => {
  it('answers --check with the running version and the one npm has', async () => {
    const said = await update({ check: true });
    expect(CURRENT).not.toBe(LATEST);
    expect(said?.data).toEqual({ current: CURRENT, latest: LATEST, may: true });
  });

  it('refuses a target that is not newer than the running version', async () => {
    expect(await refusal({ version: CURRENT })).toBe(`${CURRENT} is not newer than the running ${CURRENT}; there is nothing to update to.`);
    expect(await refusal({ version: '0.0.1' })).toContain('is not newer than the running');

    // Asked as a check, the same refusal is the answer rather than a throw.
    const checked = await update({ version: CURRENT, check: true });
    expect(checked?.data).toMatchObject({ current: CURRENT, latest: CURRENT, may: false });
  });

  it('refuses a daemon in the foreground with the words daemon.restart uses', async () => {
    expect(await refusal({}, { record: () => undefined })).toBe(FOREGROUND);
    const checked = await update({ check: true }, { record: () => undefined });
    expect(checked?.data).toEqual({ current: CURRENT, latest: LATEST, may: false, why: FOREGROUND });
  });

  it('refuses a running turn, naming the session, unless forced', async () => {
    const facts: UpdateFacts = { turning: () => ['ana'] };
    expect(await refusal({}, facts)).toBe(busy(['ana']));
    // Forced, the turn does not refuse it, and the install runs.
    const forced = await update({ force: true }, facts);
    expect(forced?.data).toMatchObject({ restarting: true });
  });

  it('refuses a checkout before anything is installed, naming the folder', async () => {
    const checkout = join(home, 'packages', 'server');
    const plan = await planUpdate({ version: LATEST, record: RECORD, place: { root: checkout, platform: 'linux', real: (path) => path } });
    expect('why' in plan ? plan.why : '').toContain(checkout);
  });

  it('says the registry did not answer rather than updating to nothing', async () => {
    latest = undefined;
    await expect(update({ check: true })).rejects.toThrow('The registry did not say which version of @ahpd/server is latest');
  });
});

describe('the install and the restart', () => {
  it('installs a global ahpd with -g and --prefix, and --allow-scripts on npm 11.16', async () => {
    const npm = fakeNpm();
    const answer = await update({ version: LATEST }, {
      configDir: plugins({}),
      run: npm.runner,
      npmVersion: async () => '11.16.0',
    });
    expect(npm.calls[0]).toEqual([
      'install', '-g', '--allow-scripts=node-pty', '--prefix', `${posixHome()}/npm-prefix`, `@ahpd/server@${LATEST}`,
    ]);
    expect(answer?.data).toMatchObject({ from: CURRENT, to: LATEST, restarting: true });
  });

  it('leaves --allow-scripts off a global install on an older npm', async () => {
    const npm = fakeNpm();
    await update({ version: LATEST }, {
      configDir: plugins({}),
      run: npm.runner,
      npmVersion: async () => '11.15.9',
    });
    expect(npm.calls[0]).toEqual([
      'install', '-g', '--prefix', `${posixHome()}/npm-prefix`, `@ahpd/server@${LATEST}`,
    ]);
  });

  it('installs a project ahpd with --prefix alone, and never --allow-scripts', async () => {
    const project = `${posixHome()}/project`;
    const npm = fakeNpm();
    await update({ version: LATEST }, {
      configDir: plugins({}),
      run: npm.runner,
      npmVersion: async () => '12.0.0',
      place: {
        root: `${project}/node_modules/@ahpd/server`,
        platform: 'linux',
        real: (path) => path,
        exists: (path) => path === `${project}/package.json`,
      },
    });
    expect(npm.calls[0]).toEqual(['install', '--prefix', project, `@ahpd/server@${LATEST}`]);
  });

  it('moves the plugins to the new sdk, and answers what moved and what was left', async () => {
    const configDir = plugins(
      { '@ahpd/agent-acp': '^1.0.0', '@ahpd/sdk': '0.12.0' },
      { '@ahpd/agent-acp': '1.0.0', '@ahpd/sdk': '0.12.0' },
    );
    const npm = fakeNpm();
    const fetch = pluginRegistry({ '@ahpd/agent-acp': [['1.5.0', '^0.12.0'], ['2.0.0', '^99.0.0']] });
    const answer = await update({ version: LATEST }, { configDir, run: npm.runner, fetch });
    expect(npm.calls[1]).toEqual([
      'install', '--prefix', configDir, '--legacy-peer-deps', `@ahpd/sdk@${LATEST}`, '@ahpd/agent-acp@2.0.0',
    ]);
    expect(answer?.data).toMatchObject({
      from: CURRENT,
      to: LATEST,
      restarting: true,
      plugins: [
        { name: '@ahpd/agent-acp', from: '1.0.0', to: '2.0.0' },
        { name: '@ahpd/sdk', from: '0.12.0', to: LATEST },
      ],
      left: [],
    });
  });

  it('refuses a plugin with no version that admits the new sdk, before npm runs', async () => {
    const configDir = plugins({ '@ahpd/agent-acp': '^1.0.0' }, { '@ahpd/agent-acp': '1.0.0' });
    const npm = fakeNpm();
    const fetch = pluginRegistry({ '@ahpd/agent-acp': [['1.0.0', '^1.0.0']] });
    const why = await refusal({ version: LATEST }, { configDir, run: npm.runner, fetch });
    expect(why).toContain(`@ahpd/agent-acp has no version that admits @ahpd/sdk ${LATEST}`);
    expect(why).toContain('its newest, 1.0.0, needs ^1.0.0');
    expect(npm.calls).toEqual([]);
  });

  it('names an unfit plugin and goes on with --force', async () => {
    const configDir = plugins({ '@ahpd/agent-acp': '^1.0.0' }, { '@ahpd/agent-acp': '1.0.0' });
    const npm = fakeNpm();
    const fetch = pluginRegistry({ '@ahpd/agent-acp': [['1.0.0', '^1.0.0']] });
    const answer = await update({ version: LATEST, force: true }, { configDir, run: npm.runner, fetch });
    const plain = typeof answer?.plain === 'function' ? answer.plain() : answer?.plain;
    expect(plain).toContain(`@ahpd/agent-acp has no version that admits @ahpd/sdk ${LATEST}`);
    expect(npm.calls[0]?.[0]).toBe('install');
    expect(answer?.data).toMatchObject({ left: ['@ahpd/agent-acp'] });
  });

  it('answers the npm error and asks for no restart', async () => {
    let restarted = false;
    const npm = fakeNpm((argv) => (argv.includes(`@ahpd/server@${LATEST}`)
      ? { code: 1, stdout: '', stderr: 'EACCES: permission denied' }
      : { code: 0, stdout: '', stderr: '' }));
    const why = await refusal({ version: LATEST }, {
      configDir: plugins({}),
      run: npm.runner,
      restart: () => { restarted = true; },
    });
    expect(why).toBe(`npm could not install @ahpd/server@${LATEST}: EACCES: permission denied`);
    await tick();
    expect(restarted).toBe(false);
  });

  it('answers a failed successor check and asks for no restart', async () => {
    let restarted = false;
    const npm = fakeNpm();
    const why = await refusal({ version: LATEST }, {
      configDir: plugins({}),
      run: npm.runner,
      takes: async () => { throw new Error('--port 9350 is not a flag this ahpd takes'); },
      restart: () => { restarted = true; },
    });
    expect(why).toBe('--port 9350 is not a flag this ahpd takes');
    // The new files were installed before the check that refused them.
    expect(npm.calls).toHaveLength(1);
    await tick();
    expect(restarted).toBe(false);
  });

  it('restarts a supervised daemon through its manager, after the answer', async () => {
    const said: string[] = [];
    const supervised: Running = {
      pid: RECORD.pid,
      url: RECORD.url,
      connectUrl: RECORD.connectUrl,
      paths: [],
      startedAt: RECORD.startedAt,
      service: 'systemd',
    };
    const answer = await update({ version: LATEST }, {
      record: () => supervised,
      configDir: plugins({}),
      restart: () => { said.push('manager restart'); },
    });
    expect(answer?.data).toMatchObject({ restarting: true });
    // The answer is in hand; the manager is asked once it has gone.
    expect(said).toEqual([]);
    await tick();
    expect(said).toEqual(['manager restart']);
  });

  it('hands a supervised daemon its own line for the successor check', async () => {
    const restarted: string[][] = [];
    const supervised: Running = {
      pid: RECORD.pid,
      url: RECORD.url,
      connectUrl: RECORD.connectUrl,
      paths: [],
      startedAt: RECORD.startedAt,
      service: 'systemd',
    };
    const facts: ServedFacts = {
      ...servedFacts(),
      restart: (argv) => {
        restarted.push([...argv]);
        return { restartDelayMs: 3000 };
      },
    };
    const registry = createRegistry({ authorize: checkScopes });
    const command = declareUpdate(registry, facts, {
      record: () => supervised,
      place: install(),
      configDir: plugins({}),
      run: fakeNpm().runner,
      ownArgv: ['--port', '9350'],
    });
    const answer = await registry.execute(command, { surface: 'cli', input: { version: LATEST } });
    // The daemon's own line, not the record's (it has none) and not `update`'s.
    expect(restarted).toEqual([['--port', '9350']]);
    expect(answer?.data).toMatchObject({ restarting: true, restartDelayMs: 3000 });
  });

  it('answers the restart parked until the turns end when a turn began during the install', async () => {
    const facts: ServedFacts = {
      ...servedFacts(),
      // The daemon's own restart, a turn having begun while npm ran.
      restart: () => ({ parked: ['ahp-session:/a'] }),
    };
    const registry = createRegistry({ authorize: checkScopes });
    const command = declareUpdate(registry, facts, {
      record: () => RECORD,
      place: install(),
      configDir: plugins({}),
      run: fakeNpm().runner,
    });
    const answer = await registry.execute(command, { surface: 'cli', input: { version: LATEST } });
    expect(answer?.data).toMatchObject({ from: CURRENT, to: LATEST, restarting: false, parked: ['ahp-session:/a'] });
    const plain = typeof answer?.plain === 'function' ? answer.plain() : answer?.plain;
    expect(plain).toContain(`${CURRENT} to ${LATEST}\nA turn is running in ahp-session:/a; it restarts once the turns end, or at once with --force.\n`);
  });

  it('on Windows hands the install to a helper and stops once the answer has had VS Code\'s upgrade delay, rather than installing here', async () => {
    // The layout npm leaves on Windows, which is a global prefix there.
    const windows: PlaceFacts = {
      root: 'C:\\npm-prefix\\node_modules\\@ahpd\\server',
      platform: 'win32',
      real: (path) => path,
      exists: () => false,
    };
    const handed: HelperOptions[] = [];
    const went: string[] = [];
    const npm = fakeNpm();
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      const answer = await update({ version: LATEST }, {
        record: () => ({ ...RECORD, startFolder: join(home, 'work') }),
        place: windows,
        configDir: plugins({}),
        run: npm.runner,
        npmVersion: async () => '11.16.0',
        // Nothing in this process may install or check a successor: the new
        // files are written by the helper, after this process has gone.
        takes: async () => { throw new Error('the successor was checked before the install'); },
        handOff: (options) => { handed.push(options); },
        down: () => { went.push('down'); },
      });

      expect(answer?.data).toEqual({ from: CURRENT, to: LATEST, restarting: true, restartDelayMs: 3000 });
      // The answer is in hand before the daemon goes, and has VS Code's three
      // seconds to reach the caller first.
      expect(went).toEqual([]);
      await vi.advanceTimersByTimeAsync(2999);
      expect(went).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect(went).toEqual(['down']);
    }
    finally {
      vi.useRealTimers();
    }
    expect(npm.calls).toEqual([]);
    expect(handed).toHaveLength(1);
    expect(handed[0]).toMatchObject({
      pid: RECORD.pid,
      place: { kind: 'global', prefix: 'C:\\npm-prefix' },
      version: LATEST,
      configDir: join(home, 'ahpd'),
      line: RECORD.argv,
      cwd: join(home, 'work'),
      log: join(home, 'ahpd', 'daemon.log'),
      platform: 'win32',
    });
  });
});

describe('POST /api/update', () => {
  it('refuses a person with 403, naming the deployment token', async () => {
    const { post, person } = await api();
    const answered = await post({ check: true }, person);
    expect(answered.status).toBe(403);
    expect((await answered.json() as { message: string }).message)
      .toBe('ada may not update the daemon here; only the deployment token may');
  });

  it('answers the deployment token with the versions, and with the refusal a check finds', async () => {
    const { post } = await api({ place: install(), record: RECORD });
    const checked = await post({ check: true });
    expect(checked.status).toBe(200);
    expect(await checked.json()).toEqual({ current: CURRENT, latest: LATEST, may: true });

    // A daemon in the foreground is refused in the place of `may`.
    const foreground = await api({ place: install() });
    const answered = await foreground.post({ check: true });
    expect(await answered.json()).toEqual({ current: CURRENT, latest: LATEST, may: false, why: FOREGROUND });
  });
});
