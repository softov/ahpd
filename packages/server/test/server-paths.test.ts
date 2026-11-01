/*
 * `ahpd paths list`, `add` and `remove`, run in this process.
 *
 * The terminal's commands are run through the registry the program is built
 * from; the served ones through the handler a daemon answers with. The
 * configuration is a temporary directory, so every case writes the file it reads
 * and no case sees the configuration or the daemon record of whoever runs the
 * suite.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Output } from '@cofold/commands';
import type { RequestHandler } from '@cofold/remote';
import { Program } from '@cofold/terminal';
import { fileUsers, type Users } from '@ahpd/sdk';
import { running } from '../src/daemon.js';
import type { Options } from '../src/commands/options.js';
import { optionsFrom, programGlobals } from '../src/commands/options.js';
import { reachable } from '../src/commands/paths.js';
import { cliRegistry } from '../src/commands/registry.js';
import { apiOrigins } from '../src/commands/run.js';
import { servedRegistry, type ServedFacts } from '../src/commands/served.js';
import { apiHandler, listenApi } from '../src/http.js';

/** The origin the cases' daemon is reached on, which its routes and grants are read against. */
const AUTHORITY = '127.0.0.1:9350';

let home: string;
let config: string;
let had: string | undefined;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ahpd-paths-'));
  had = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = home;
  mkdirSync(join(home, 'ahpd'), { recursive: true });
  config = join(home, 'ahpd', 'config.json');
});
afterEach(() => {
  if (had === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = had;
  rmSync(home, { recursive: true, force: true });
});

const put = (held: unknown): void => { writeFileSync(config, `${JSON.stringify(held, null, 2)}\n`); };
const read = (): Record<string, unknown> => JSON.parse(readFileSync(config, 'utf8')) as Record<string, unknown>;

/** A folder under this case's own root, made so it can be served. */
const folder = (...parts: string[]): string => {
  const at = join(home, ...parts);
  mkdirSync(at, { recursive: true });
  return at;
};

/**
 * The record a detached daemon writes of itself, which is what says one is up.
 *
 * `api` is the origin its routes hang off, and a record without one is a daemon
 * that serves none. The token is what the connect URL carries, which is where a
 * verb reads the credential a forwarded change presents; its default is the
 * token every daemon in this file answers with, because a record is written by
 * the daemon it names.
 */
const record = (paths: string[] = [], daemon: { api?: string; token?: string; startFolder?: string } = {}): void => {
  writeFileSync(join(home, 'ahpd', 'daemon.json'), JSON.stringify({
    pid: process.pid,
    url: 'ws://127.0.0.1:9187',
    connectUrl: `ws://127.0.0.1:9187/?tkn=${daemon.token ?? 'root-secret'}`,
    paths,
    startedAt: '',
    ...(daemon.api === undefined ? {} : { api: daemon.api }),
    ...(daemon.startFolder === undefined ? {} : { startFolder: daemon.startFolder }),
  }));
};

/** One terminal command, as what it answered and what it said. */
const run = async (id: string, input: Record<string, unknown> = {}): Promise<{ output: Output | null; said: string }> => {
  const registry = cliRegistry();
  const command = registry.find(id);
  if (command === undefined) throw new Error(`no ${id}`);
  let said = '';
  const output = await registry.execute(command, {
    surface: 'cli',
    input: { configFile: config, ...input },
    io: { out: (text) => { said += text; }, err: (text) => { said += text; } },
  });
  return { output, said };
};

/**
 * One line as `ahpd` reads it, in this process.
 *
 * The registry and the globals are the ones `main.ts` builds its program from.
 * What the command wrote and what it said are kept apart, because with `--json`
 * the answer is stdout and every line about it is stderr.
 */
const line = async (words: string[]): Promise<{ code: number; out: string; err: string }> => {
  let out = '';
  let err = '';
  const program = new Program({
    name: 'ahpd',
    version: '0.0.0',
    registry: cliRegistry(),
    globals: programGlobals,
    io: { out: (text) => { out += text; }, err: (text) => { err += text; } },
  });
  return { code: await program.run(words), out, err };
};

describe('ahpd paths at the terminal', () => {
  it('lists the folders the configuration names', async () => {
    const one = folder('one');
    put({ paths: [one, '/tmp/two'] });
    const listed = await run('paths.list');
    expect(listed.output?.data).toEqual([one, '/tmp/two']);
    const shown = await line(['paths', 'list', '--config-file', config]);
    expect(shown.code).toBe(0);
    expect(shown.out).toBe(`${one}\n/tmp/two\n`);
  });

  it('says none is named when the configuration names none', async () => {
    put({ port: 1234 });
    const listed = await run('paths.list');
    expect(listed.output?.data).toEqual([]);
    const shown = await line(['paths', 'list', '--config-file', config]);
    expect(shown.out).toBe('paths: none named\n');
  });

  it('adds a folder to a configuration that is not there yet', async () => {
    const work = folder('work');
    const added = await run('paths.add', { folder: work });
    expect(added.said).toBe(`Added ${work} to "paths" in ${config}.\n`);
    expect(added.output?.data).toEqual({ paths: [work] });
    expect(read()).toEqual({ paths: [work] });
  });

  it('writes the folder it resolves, not the words typed', async () => {
    const work = folder('work');
    await run('paths.add', { folder: `${work}${sep}.` });
    expect(read().paths).toEqual([work]);
  });

  it('refuses a folder that is not there, and a file, writing nothing', async () => {
    const gone = join(home, 'gone');
    await expect(run('paths.add', { folder: gone })).rejects.toThrow(`No folder at ${gone}.`);
    const file = join(home, 'a-file');
    writeFileSync(file, 'x');
    await expect(run('paths.add', { folder: file })).rejects.toThrow(`${file} is not a folder.`);
    expect(existsSync(config)).toBe(false);
  });

  it('says a folder under a served one is already served, and writes nothing', async () => {
    const above = folder('work');
    const inside = folder('work', 'sub');
    put({ port: 1234, paths: [above] });
    const before = readFileSync(config, 'utf8');

    const under = await run('paths.add', { folder: inside });
    expect(under.said).toBe(`${inside} is under ${above}, which is served.\n`);
    expect(under.output?.data).toEqual({ paths: [above] });

    // The folder itself is one of the folders, so it is served already too.
    const same = await run('paths.add', { folder: above });
    expect(same.said).toBe(`${above} is already served.\n`);
    expect(readFileSync(config, 'utf8')).toBe(before);
  });

  it('removes a folder, and keeps every other key', async () => {
    const one = folder('one');
    const two = folder('two');
    put({ port: 1234, paths: [one, two], advancedTools: true });
    const removed = await run('paths.remove', { folder: two });
    expect(removed.said).toBe(`Removed ${two} from "paths" in ${config}.\n`);
    expect(removed.output?.data).toEqual({ paths: [one] });
    expect(read()).toEqual({ port: 1234, paths: [one], advancedTools: true });
  });

  it('refuses a folder "paths" does not name', async () => {
    const one = folder('one');
    const other = folder('other');
    put({ paths: [one] });
    await expect(run('paths.remove', { folder: other }))
      .rejects.toThrow(`${other} is not in "paths" in ${config}.`);
    expect(read().paths).toEqual([one]);
  });

  it('refuses to remove the last folder, and keeps it', async () => {
    const one = folder('one');
    put({ paths: [one] });
    await expect(run('paths.remove', { folder: one }))
      .rejects.toThrow(`The last folder in "paths" cannot be removed, because a daemon with no "paths" serves the folder it is started in.`);
    expect(read().paths).toEqual([one]);
  });

  it('answers the folders with --json, and the new list after a write', async () => {
    const one = folder('one');
    const two = folder('two');
    put({ paths: [one] });

    const listed = await line(['paths', 'list', '--json', '--config-file', config]);
    expect(listed.code).toBe(0);
    expect(JSON.parse(listed.out) as unknown).toEqual([one]);
    expect(listed.err).toBe('');

    const added = await line(['paths', 'add', two, '--json', '--config-file', config]);
    expect(added.code).toBe(0);
    expect(JSON.parse(added.out) as unknown).toEqual({ paths: [one, two] });
    // The line a person reads goes to stderr, because stdout is the answer.
    expect(added.err).toContain(`Added ${two} to "paths" in ${config}.`);
  });

  it('writes the file and says that a restart applies the change, when a daemon is recorded', async () => {
    const one = folder('one');
    const two = folder('two');
    record();
    const added = await run('paths.add', { folder: one });
    expect(added.said).toBe(`Added ${one} to "paths" in ${config}.\n`
      + 'Restart the daemon to apply the change: ahpd restart.\n');
    expect(added.output?.data).toEqual({ paths: [one], restart: true });

    // With no record, nothing is said about a restart, and no key is carried.
    rmSync(join(home, 'ahpd', 'daemon.json'));
    await run('paths.add', { folder: two });
    const removed = await run('paths.remove', { folder: two });
    expect(removed.said).toBe(`Removed ${two} from "paths" in ${config}.\n`);
    expect(removed.output?.data).toEqual({ paths: [one] });
  });

  /*
   * The forward: a plain `ahpd paths add` at the terminal reaches the daemon
   * that is running and serving the API, so the change applies at once instead
   * of waiting for a restart - decision
   * `ahpd-paths-add-at-the-terminal-reaches-a-running-daemon` and the second
   * half of `ahpd-paths-remove-asks-nothing`.
   *
   * The daemon's end is a real listener on a real port, because the forward is
   * a request over the network and not a call: what the case holds is the same
   * handler `serve()` mounts, with every request kept.
   */
  const listening = async (paths: string[], token = 'root-secret', startFolder?: string): Promise<{
    api: string;
    own: Options;
    file: string;
    seen: { method: string; path: string; authorization: string | null; body: unknown }[];
    done(): Promise<void>;
  }> => {
    const own = { paths, ...(startFolder === undefined ? {} : { startFolder }) } as Options;
    // The daemon's own file, and not the one the terminal edits: a case tells
    // the two apart by which of them changed. A daemon serving its start folder
    // was started from a file that names none.
    const file = join(home, 'served.json');
    writeFileSync(file, `${JSON.stringify(startFolder === undefined ? { paths } : {}, null, 2)}\n`);
    const bound = { port: 0 };
    const seen: { method: string; path: string; authorization: string | null; body: unknown }[] = [];
    const handler = apiHandler({
      registry: servedRegistry({
        options: own,
        configFile: file,
        running: () => ({
          pid: process.pid, url: `ws://127.0.0.1:${String(bound.port)}`, host: '127.0.0.1', port: bound.port, paths: own.paths, startedAt: '',
        }),
        turning: () => [],
        restart: () => {},
      }),
      token,
      program: { name: 'ahpd', version: '0.0.0' },
      origins: () => apiOrigins('127.0.0.1', undefined, bound.port),
    });
    const watched: RequestHandler = async (request) => {
      seen.push({
        method: request.method,
        path: new URL(request.url).pathname,
        authorization: request.headers.get('authorization'),
        body: await request.clone().json().catch(() => undefined),
      });
      return handler(request);
    };
    const api = await listenApi(watched, { port: 0, host: '127.0.0.1' });
    bound.port = api.port;
    return { api: `http://127.0.0.1:${String(api.port)}`, own, file, seen, done: async () => { await api.close(); } };
  };

  it('sends the change to the recorded daemon, with the token its record carries', async () => {
    const one = folder('one');
    const two = folder('two');
    put({ paths: [one] });
    // A token that is not this file's usual one, so the header the case reads
    // can only have come from the record.
    const api = await listening([one], 'the-daemons-token');
    record([one], { api: api.api, token: 'the-daemons-token' });
    try {
      const added = await line(['paths', 'add', two, '--json']);
      expect(added.code).toBe(0);
      // The daemon's own answer, which is the verb's.
      expect(JSON.parse(added.out) as unknown).toEqual({ paths: [one, two] });
      expect(added.err).toBe(`Added ${two} to "paths" on the running daemon.\n`);
      expect(api.seen).toEqual([{
        method: 'POST',
        path: '/api/paths/add',
        authorization: 'Bearer the-daemons-token',
        body: { folder: two },
      }]);
      expect(api.own.paths).toEqual([one, two]);
    }
    finally { await api.done(); }
  });

  it('sends the folder it resolved, and writes no configuration file of its own', async () => {
    const work = folder('work');
    const api = await listening([]);
    record([], { api: api.api });
    try {
      const added = await line(['paths', 'add', `${work}${sep}.`]);
      expect(added.code).toBe(0);
      expect(api.seen[0]?.body).toEqual({ folder: work });
      // The daemon wrote its own file; this process wrote none of the two.
      expect(existsSync(config)).toBe(false);
      expect(api.own.paths).toEqual([work]);
    }
    finally { await api.done(); }
  });

  it('is refused with the daemon\'s own sentence, which is the check that ran', async () => {
    const gone = join(home, 'gone');
    const api = await listening([]);
    record([], { api: api.api });
    try {
      await expect(line(['paths', 'add', gone])).rejects.toThrow(`No folder at ${gone}.`);
      // The sentence is the daemon's, so the daemon is what refused: the check
      // that ran is the check the file would have been written by.
      expect(api.seen).toHaveLength(1);
      expect(existsSync(config)).toBe(false);
    }
    finally { await api.done(); }
  });

  it('sends to the loopback when the record names a wildcard bind', async () => {
    const one = folder('one');
    const api = await listening([]);
    /*
     * What a daemon bound to every address announces. `0.0.0.0` names no one
     * machine - a Windows fetch to it fails - and the `Host` it sends is not a
     * name the API answers to either. The loopback at that port is the daemon.
     */
    record([], { api: `http://0.0.0.0:${new URL(api.api).port}` });
    try {
      const added = await line(['paths', 'add', one]);
      expect(added.code).toBe(0);
      expect(added.out).toBe(`Added ${one} to "paths" on the running daemon.\n`);
      expect(api.seen).toHaveLength(1);
      expect(api.own.paths).toEqual([one]);
    }
    finally { await api.done(); }
  });

  it('sends every shape of wildcard bind to the loopback', () => {
    // Bound to every address as IPv4 and as IPv6, and bound with no host at all,
    // which is announced without one and is not a URL.
    expect(reachable('http://0.0.0.0:9187')).toBe('http://127.0.0.1:9187');
    expect(reachable('http://[::]:9187')).toBe('http://[::1]:9187');
    expect(reachable('http://:9187')).toBe('http://127.0.0.1:9187');
    // One machine, named or numbered, is left as the record wrote it.
    expect(reachable('http://127.0.0.1:9187')).toBe('http://127.0.0.1:9187');
    expect(reachable('http://[::1]:9187')).toBe('http://[::1]:9187');
    expect(reachable('http://build.local:9187')).toBe('http://build.local:9187');
  });

  it('writes the file, and says the restart line, when the recorded daemon serves no API', async () => {
    const one = folder('one');
    record();
    const added = await line(['paths', 'add', one]);
    expect(added.code).toBe(0);
    expect(read().paths).toEqual([one]);
    expect(added.out).toBe(`Added ${one} to "paths" in ${config}.\n`
      + 'Restart the daemon to apply the change: ahpd restart.\n');
  });

  it('writes the file, and says the restart line, when the daemon does not answer', async () => {
    const one = folder('one');
    // A port nothing listens on, which is a daemon that was recorded and is not
    // there: the change is one a restart applies, not one this can send.
    record([], { api: 'http://127.0.0.1:1' });
    const added = await line(['paths', 'add', one]);
    expect(added.code).toBe(0);
    expect(read().paths).toEqual([one]);
    expect(added.out).toBe(`Added ${one} to "paths" in ${config}.\n`
      + 'Restart the daemon to apply the change: ahpd restart.\n');
  });

  it('writes the file it names, and sends nothing, when --config-file is given', async () => {
    const one = folder('one');
    const api = await listening([]);
    record([], { api: api.api });
    try {
      const added = await line(['paths', 'add', one, '--config-file', config]);
      expect(added.code).toBe(0);
      expect(read().paths).toEqual([one]);
      // The file named is the one edited, so there is nothing to send anywhere.
      expect(api.seen).toEqual([]);
      expect(api.own.paths).toEqual([]);
    }
    finally { await api.done(); }
  });

  it('stops at once on a folder "paths" does not name, with no --yes and no question', async () => {
    const one = folder('one');
    const other = folder('other');
    put({ paths: [one] });
    record();
    /*
     * It reaches the command and is refused there. A question would have ended
     * the run before the command ran at all, which is the shape the Windows run
     * found: asked about a folder that was then refused.
     */
    await expect(line(['paths', 'remove', other])).rejects.toThrow(`${other} is not in "paths" in ${config}.`);
    expect(read().paths).toEqual([one]);
  });

  /*
   * A daemon that names no folder serves its start folder, and the file does
   * not hold it. The first add writes both, so the file, the list, the record
   * and the next start name the same folders.
   */
  it('writes the start folder and the new folder, when the recorded daemon serves its start folder', async () => {
    const work = folder('work');
    const extra = folder('extra');
    put({ port: 1234 });
    record([work], { startFolder: work });

    const added = await line(['paths', 'add', extra]);
    expect(added.code).toBe(0);
    expect(added.out).toBe(`Added ${work}, the folder the daemon was started in, and ${extra} to "paths" in ${config}.\n`
      + 'Restart the daemon to apply the change: ahpd restart.\n');
    expect(read()).toEqual({ port: 1234, paths: [work, extra] });

    // The list, and what a restart reads, are the two folders.
    const listed = await line(['paths', 'list']);
    expect(listed.out).toBe(`${work}\n${extra}\n`);
    expect(optionsFrom({}).paths).toEqual([work, extra]);
  });

  it('removes either folder after the first add', async () => {
    const work = folder('work');
    const extra = folder('extra');
    put({});
    record([work], { startFolder: work });
    await line(['paths', 'add', extra]);

    await line(['paths', 'remove', extra]);
    expect(read().paths).toEqual([work]);
    await line(['paths', 'add', extra]);
    await line(['paths', 'remove', work]);
    expect(read().paths).toEqual([extra]);
  });

  it('sends the first add to a daemon serving its start folder, which writes both', async () => {
    const work = folder('work');
    const extra = folder('extra');
    const api = await listening([work], 'root-secret', work);
    record([work], { api: api.api, startFolder: work });
    try {
      const added = await line(['paths', 'add', extra, '--json']);
      expect(added.code).toBe(0);
      expect(JSON.parse(added.out) as unknown).toEqual({ paths: [work, extra], startFolder: work });
      expect(added.err).toBe(`Added ${work}, the folder the daemon was started in, and ${extra} to "paths" on the running daemon.\n`);
      expect(api.own.paths).toEqual([work, extra]);
      expect((JSON.parse(readFileSync(api.file, 'utf8')) as { paths: unknown }).paths).toEqual([work, extra]);
      expect(running()?.paths).toEqual([work, extra]);
    }
    finally { await api.done(); }
  });

  it('adds only the new folder when the file names "paths", whatever the record says', async () => {
    const one = folder('one');
    const work = folder('work');
    const extra = folder('extra');
    put({ paths: [one] });
    record([one], { startFolder: work });
    await line(['paths', 'add', extra]);
    expect(read().paths).toEqual([one, extra]);
  });
});

/*
 * The same three verbs over HTTP, against the daemon's own facts.
 *
 * The options object is the one the daemon was started with and `running()`
 * reads its folders per request, so a case sees a change the way `ahpd status`
 * does. Served, the file is the daemon's own, so the case's `configFile` is
 * never named by a request.
 */
describe('ahpd paths, served', () => {
  /** A daemon serving `paths`, and the API handler it answers with. */
  const daemon = (paths: string[], people?: Users, startFolder?: string) => {
    const own = { paths, ...(startFolder === undefined ? {} : { startFolder }) } as Options;
    /** The file's `paths` each time the root was told the daemon's values moved. */
    const told: unknown[] = [];
    const facts: ServedFacts = {
      options: own,
      configFile: config,
      running: () => ({
        pid: process.pid,
        url: `ws://${AUTHORITY}`,
        host: '127.0.0.1',
        port: 9350,
        paths: own.paths,
        startedAt: '',
        ...(own.startFolder === undefined ? {} : { startFolder: own.startFolder }),
      }),
      turning: () => [],
      restart: () => {},
      valuesMoved: async () => { told.push(read().paths); },
    };
    const handler = apiHandler({
      registry: servedRegistry(facts),
      token: 'root-secret',
      ...(people === undefined ? {} : { users: people }),
      program: { name: 'ahpd', version: '0.0.0' },
      origins: () => apiOrigins('127.0.0.1', undefined, 9350),
    });
    return {
      own,
      told,
      running: facts.running,
      ask: (method: string, path: string, body?: unknown, token = 'root-secret'): Promise<Response> =>
        handler(new Request(`http://${AUTHORITY}/api${path}`, {
          method,
          headers: { host: AUTHORITY, 'content-type': 'application/json', authorization: `Bearer ${token}` },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })),
    };
  };

  it('writes the daemon\'s own file, and the list it serves, when a folder is added', async () => {
    const one = folder('one');
    const two = folder('two');
    put({ paths: [one] });
    const served = daemon([one]);

    const added = await served.ask('POST', '/paths/add', { folder: two });
    expect(added.status).toBe(200);
    expect(await added.json()).toEqual({ paths: [one, two] });
    expect(read().paths).toEqual([one, two]);
    expect(served.own.paths).toEqual([one, two]);
  });

  it('tells the root the file it wrote, after each add and remove, and nothing for an add it did not write', async () => {
    const one = folder('one');
    const two = folder('two');
    put({ paths: [one] });
    const served = daemon([one]);

    await served.ask('POST', '/paths/add', { folder: two });
    // Already served, so the file is left as it is and nothing moved.
    await served.ask('POST', '/paths/add', { folder: two });
    await served.ask('POST', '/paths/remove', { folder: two });
    expect(served.told).toEqual([[one, two], [one]]);
  });

  it('answers the folders the daemon serves now, not the file', async () => {
    const one = folder('one');
    const two = folder('two');
    put({ paths: [one] });
    const listed = await daemon([one, two]).ask('GET', '/paths/list');
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual([one, two]);
  });

  it('shows a new folder in the list the daemon reports, so status names it with no restart', async () => {
    const one = folder('one');
    const two = folder('two');
    put({ paths: [one] });
    const served = daemon([one]);
    expect(served.running().paths).toEqual([one]);

    await served.ask('POST', '/paths/add', { folder: two });
    expect(served.running().paths).toEqual([one, two]);
  });

  it('rewrites the record, so a terminal reading it lists the folder too', async () => {
    const one = folder('one');
    const two = folder('two');
    put({ paths: [one] });
    record([one]);
    expect(running()?.paths).toEqual([one]);

    // `ahpd status --json` reads the record and never the daemon, so a change
    // the daemon serves and does not record is one a terminal cannot see.
    await daemon([one]).ask('POST', '/paths/add', { folder: two });
    expect(running()?.paths).toEqual([one, two]);
  });

  it('takes a folder out of the file and out of the list when one is removed', async () => {
    const one = folder('one');
    const two = folder('two');
    put({ paths: [one, two] });
    const served = daemon([one, two]);

    const removed = await served.ask('POST', '/paths/remove', { folder: two });
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ paths: [one] });
    expect(read().paths).toEqual([one]);
    expect(served.running().paths).toEqual([one]);
  });

  it('refuses a person\'s token, whoever they are, and takes the deployment\'s', async () => {
    const one = folder('one');
    const two = folder('two');
    put({ paths: [one] });
    const people = fileUsers({ path: join(home, 'users.json') });
    // An administrator, so what refuses her is the deployment-only rule and not
    // a grant she is missing.
    await people.add('ada', ['admin']);
    const served = daemon([one], people);

    const refused = await served.ask('POST', '/paths/add', { folder: two }, await people.mint('ada'));
    expect(refused.status).toBe(403);
    expect((await refused.json() as { message: string }).message)
      .toBe('ada may not add or remove a served folder here; only the deployment token may');
    expect(read().paths).toEqual([one]);
    expect(served.running().paths).toEqual([one]);

    const taken = await served.ask('POST', '/paths/add', { folder: two });
    expect(taken.status).toBe(200);
    expect(read().paths).toEqual([one, two]);
  });

  it('answers the new list and no restart, because this daemon already serves it', async () => {
    const one = folder('one');
    put({ port: 1234 });
    const added = await daemon([]).ask('POST', '/paths/add', { folder: one });
    expect(added.status).toBe(200);
    // The whole answer: the folders, and no key or line about a restart.
    expect(await added.json()).toEqual({ paths: [one] });
  });

  /*
   * The Windows run of 2026-10-14: a daemon started with no "paths" serves its
   * start folder, and an add that wrote only the new folder left the file and
   * the daemon naming different folders.
   */
  it('writes the start folder and the new folder, so the file, the list and status agree', async () => {
    const work = folder('work');
    const extra = folder('extra');
    put({ port: 1234 });
    const served = daemon([work], undefined, work);

    const added = await served.ask('POST', '/paths/add', { folder: extra });
    expect(added.status).toBe(200);
    expect(await added.json()).toEqual({ paths: [work, extra], startFolder: work });
    expect(read()).toEqual({ port: 1234, paths: [work, extra] });
    expect(served.own.paths).toEqual([work, extra]);
    expect(served.running().paths).toEqual([work, extra]);
    expect(await (await served.ask('GET', '/paths/list')).json()).toEqual([work, extra]);
    // What a restart reads is the same two folders.
    expect(optionsFrom({ configFile: config }).paths).toEqual([work, extra]);
  });

  it('removes the new folder, or the start folder, after the first add', async () => {
    const work = folder('work');
    const extra = folder('extra');
    put({});
    const first = daemon([work], undefined, work);
    await first.ask('POST', '/paths/add', { folder: extra });
    const removed = await first.ask('POST', '/paths/remove', { folder: extra });
    expect(removed.status).toBe(200);
    expect(read().paths).toEqual([work]);
    expect(first.running().paths).toEqual([work]);

    put({});
    const second = daemon([work], undefined, work);
    await second.ask('POST', '/paths/add', { folder: extra });
    const gone = await second.ask('POST', '/paths/remove', { folder: work });
    expect(gone.status).toBe(200);
    expect(read().paths).toEqual([extra]);
    expect(second.running().paths).toEqual([extra]);
  });

  it('writes nothing for a folder under the start folder, which is served already', async () => {
    const work = folder('work');
    const inside = folder('work', 'sub');
    put({ port: 1234 });
    const served = daemon([work], undefined, work);
    const added = await served.ask('POST', '/paths/add', { folder: inside });
    expect(added.status).toBe(200);
    expect(await added.json()).toEqual({ paths: [work] });
    expect(read()).toEqual({ port: 1234 });
    expect(served.own.paths).toEqual([work]);
  });

  it('adds only the new folder to a file that names "paths"', async () => {
    const one = folder('one');
    const work = folder('work');
    const extra = folder('extra');
    put({ paths: [one] });
    const served = daemon([one], undefined, work);
    await served.ask('POST', '/paths/add', { folder: extra });
    expect(read().paths).toEqual([one, extra]);
    expect(served.own.paths).toEqual([one, extra]);
  });
});

/*
 * The Windows run of 2026-10-14: the record held the start folder, and `ahpd
 * status --json` left it out, because the status answer is a fixed list of the
 * record's fields.
 */
describe('ahpd status names the start folder', () => {
  it('shows the start folder the record carries, as a field and as a line', async () => {
    const work = folder('work');
    record([work], { startFolder: work });
    const json = await line(['status', '--json', '--no-update-check']);
    expect(json.code).toBe(0);
    expect((JSON.parse(json.out) as { startFolder?: unknown }).startFolder).toBe(work);
    const text = await line(['status', '--no-update-check']);
    expect(text.out).toContain(`sessions in ${work}\nstart folder ${work}\n`);
  });

  it('has no start folder key or line when the record carries none', async () => {
    const one = folder('one');
    record([one]);
    const json = await line(['status', '--json', '--no-update-check']);
    expect(json.code).toBe(0);
    expect(Object.keys(JSON.parse(json.out) as object)).not.toContain('startFolder');
    const text = await line(['status', '--no-update-check']);
    expect(text.out).not.toContain('start folder');
  });

  /** A served status, against a daemon that serves `paths` and was started in `startFolder` when one is given. */
  const servedStatus = async (paths: string[], startFolder?: string): Promise<Record<string, unknown>> => {
    const own = { paths, ...(startFolder === undefined ? {} : { startFolder }) } as Options;
    const handler = apiHandler({
      registry: servedRegistry({
        options: own,
        configFile: config,
        running: () => ({
          pid: process.pid,
          url: `ws://${AUTHORITY}`,
          host: '127.0.0.1',
          port: 9350,
          paths: own.paths,
          startedAt: '',
          ...(own.startFolder === undefined ? {} : { startFolder: own.startFolder }),
        }),
        turning: () => [],
        restart: () => {},
      }),
      token: 'root-secret',
      program: { name: 'ahpd', version: '0.0.0' },
      origins: () => apiOrigins('127.0.0.1', undefined, 9350),
    });
    const answer = await handler(new Request(`http://${AUTHORITY}/api/status`, {
      headers: { host: AUTHORITY, authorization: 'Bearer root-secret' },
    }));
    expect(answer.status).toBe(200);
    return await answer.json() as Record<string, unknown>;
  };

  it('shows the start folder of the daemon answering, served', async () => {
    const work = folder('work');
    expect((await servedStatus([work], work)).startFolder).toBe(work);
  });

  it('has no start folder key, served, when the daemon names its folders', async () => {
    const one = folder('one');
    expect(Object.keys(await servedStatus([one]))).not.toContain('startFolder');
  });
});
