import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { fileResources } from '../../sdk/src/resources/resources.js';
import { loadPlugins } from '../../server/src/plugins.js';
import { registryOf } from '../src/parts.js';
import { dockerAddressOf } from '../src/plugin.js';
import { closeAll, keeping } from './support/closing.js';
import type { Agent } from '../../sdk/src/types/agent.js';
import type { HostOptions, HostTool } from '../../sdk/src/types/host.js';
import type { MachineNeed } from '../../sdk/src/types/machine.js';

import type { Vault } from '../../sdk/src/types/vault.js';
import type { Usage, UsageEntry, UsageTotal } from '../../sdk/src/types/usage.js';

/*
 * A profile whose machines are made on a box's Docker, reached as
 * `DOCKER_HOST=ssh://<destination>`.
 *
 * The scripted `docker` keeps one file per `DOCKER_HOST`, so the box's Docker
 * is a second daemon here: a machine found in its file was made with the
 * address in the run's environment. The scripted `ssh` answers the server
 * check from a file, so the box has a Docker without this host having one.
 */

const REPO = join(import.meta.dirname, '../../..');
const SOURCE = './packages/computer/src/index.ts';
const DOCKER = fileURLToPath(new URL('./fixtures/docker.mjs', import.meta.url));
const SSH = fileURLToPath(new URL('./fixtures/ssh.mjs', import.meta.url));

let loose: string[] = [];
afterEach(async () => {
  await closeAll();
  for (const one of loose) rmSync(one, { recursive: true, force: true });
  loose = [];
});
const temp = (): string => {
  const made = mkdtempSync(join(tmpdir(), 'ahpd-far-docker-'));
  loose.push(made);
  return made;
};

/** What a box with a Docker this account reaches answers the server check with. */
const ready = [
  'os_id=debian', 'os_like=', 'os_name=Debian GNU/Linux 13 (trixie)', 'arch=x86_64', 'cpus=6',
  'memory_kb=11718656', 'home_free_kb=52428800', 'varlib_free_kb=20971520',
  'docker=26.1.5+dfsg1', 'docker_access=yes', 'user=softov',
].join('\n');

interface Held {
  machines: { name: string; image: string; mounts?: string[]; labels?: Record<string, string>; state?: string }[];
  calls: string[][];
  failPs?: boolean;
}
const held = (file: string): Held => (existsSync(file)
  ? JSON.parse(readFileSync(file, 'utf8')) as Held
  : { machines: [], calls: [] });

/** The file the scripted Docker keeps for the box at this address. */
const farFile = (local: string, address = 'ssh://dev02'): string => `${local}.${encodeURIComponent(address)}`;

const until = async (check: () => boolean, times = 1000): Promise<void> => {
  for (let i = 0; i < times; i++) {
    if (check()) return;
    await new Promise((r) => { setTimeout(r, 5); });
  }
  throw new Error(`still waiting after ${times} tries`);
};

function meter(): Usage & { entries: UsageEntry[] } {
  const entries: UsageEntry[] = [];
  return {
    entries,
    record: async (entry: UsageEntry) => { entries.push(entry); },
    total: async (): Promise<UsageTotal> => ({}),
    pools: async () => [],
    records: async () => [],
    groups: async () => [],
  };
}

/** One test's files: the local Docker, the box's check answer, and ssh's log. */
const files = () => {
  const dir = temp();
  const check = join(dir, 'check.txt');
  writeFileSync(check, ready);
  return { dir, local: join(dir, 'docker.json'), check, log: join(dir, 'ssh.jsonl') };
};

/** The plugin loaded with the box `dev02`, the profiles given, and every line it said. */
const load = async (
  at: ReturnType<typeof files>,
  profiles: Record<string, unknown>,
  { box = {}, env = {}, hostId = 'host-a', usage, agents = [], vault }: {
    box?: Record<string, unknown>; env?: Record<string, string>; hostId?: string; usage?: Usage; agents?: Agent[]; vault?: Vault;
  } = {},
) => {
  const lines: string[] = [];
  const base: HostOptions = {
    path: '/tmp/computer-far-docker',
    hostName: 'box.local',
    agents,
    resources: fileResources(),
    ...(usage === undefined ? {} : { usage }),
    ...(vault === undefined ? {} : { vault }),
  };
  const result = await loadPlugins(
    [{
      name: SOURCE,
      options: {
        command: process.execPath,
        args: [DOCKER],
        env: { DOCKER_FAKE_STATE: at.local, SSH_FAKE_LOG: at.log, SSH_FAKE_CHECK: at.check, ...env },
        ssh: { command: process.execPath, args: [SSH], machines: { dev02: { destination: 'dev02', ...box } } },
        profiles,
      },
    }],
    { base, configDir: join(at.dir, `state-${hostId}`), cwd: REPO, log: (line) => { lines.push(line); }, hostId },
  );
  keeping(result.options);
  const provider = result.options.resourceProviders?.computer as {
    write(uri: string, content: { data: string; encoding: string }, owner?: string): Promise<void>;
    list(uri: string): Promise<{ name: string }[]>;
  };
  // The Docker machines alone: the box itself is listed too, as `ssh.dev02`.
  const listed = async (): Promise<string[]> => (await provider.list('computer://'))
    .map((one) => one.name).filter((one) => !one.startsWith('ssh.')).sort();
  return { ...result, lines, provider, listed };
};

const said = (body: string) => ({ data: body, encoding: 'utf-8' });

it('spells a box as Docker\'s ssh address, with its port when it sets one', () => {
  expect(dockerAddressOf({ destination: 'softov@dev02' })).toBe('ssh://softov@dev02');
  expect(dockerAddressOf({ destination: 'dev02', port: '2222' })).toBe('ssh://dev02:2222');
});

it('leaves out a profile whose box names an identity, saying to name the key in ssh\'s configuration', async () => {
  const at = files();
  const { problems, lines } = await load(at, { far: { server: 'dev02' } }, { box: { identity: '/keys/dev02' } });
  expect(problems).toEqual([]);
  expect(lines.some((line) => line.includes('profiles.far names the server dev02, whose identity Docker cannot be given; name the key for dev02 in ssh\'s own configuration instead, so the profile is left out'))).toBe(true);
});

it('gives a box whose Docker is the plugin\'s own no runner of its own, and loads the rest', async () => {
  const at = files();
  const { problems, lines, listed } = await load(
    at,
    { same: { server: 'dev02' } },
    { env: { DOCKER_HOST: 'ssh://dev02' } },
  );
  expect(problems).toEqual([]);
  expect(lines.some((line) => line.includes('profiles.same names the server dev02, whose Docker is this plugin\'s own, so its machines are made on that one'))).toBe(true);
  expect(await listed()).toEqual([]);
});

it('makes a profile\'s machine on its box\'s Docker, lists it by that runner and meters it to its owner', async () => {
  const at = files();
  const usage = meter();
  const { problems, provider, listed } = await load(at, { far: { server: 'dev02' } }, { usage });
  expect(problems).toEqual([]);

  await provider.write('computer://box', said(JSON.stringify({ image: 'node:22', profile: 'far' })), 'user:ana');
  // Made by the box's Docker, and never by this host's.
  const made = held(farFile(at.local)).machines;
  expect(made.map((one) => one.name)).toEqual(['box']);
  expect(made[0]?.labels).toMatchObject({ 'ahpd.profile': 'far', 'ahpd.host': 'host-a' });
  expect(held(at.local).machines).toEqual([]);
  // The box was checked first, over ssh.
  expect(readFileSync(at.log, 'utf8')).toContain('sh -s');

  expect(await listed()).toEqual(['docker-far.box']);

  await provider.write('computer://docker-far.box/state', said('stopped'));
  expect(usage.entries).toHaveLength(1);
  expect(usage.entries[0]).toMatchObject({ computer: 'docker-far.box', owner: 'user:ana' });
});

it('pulls a far profile\'s parts on its box\'s Docker, which mounts them, and none on this host\'s', async () => {
  const at = files();
  const { problems, provider } = await load(at, { far: { server: 'dev02', parts: ['node'] } });
  expect(problems).toEqual([]);

  await provider.write('computer://box', said(JSON.stringify({ image: 'node:22', profile: 'far' })), 'user:ana');
  const far = held(farFile(at.local)) as Held & { pulls?: string[] };
  expect((far.pulls ?? []).filter((one) => one.includes('/ahpd-part/')).map((one) => one.split(':')[0]))
    .toEqual([`${registryOf()}/ahpd-part/node`]);
  expect(far.machines.map((one) => one.name)).toEqual(['box']);
  expect(((held(at.local) as Held & { pulls?: string[] }).pulls ?? []).filter((one) => one.includes('/ahpd-part/'))).toEqual([]);
});

it('refuses to make a machine on a box with no Docker, with the fix lines', async () => {
  const at = files();
  writeFileSync(at.check, ready.replace(/^docker.*$/gmu, ''));
  const { provider } = await load(at, { far: { server: 'dev02' } });
  await expect(provider.write('computer://box', said(JSON.stringify({ image: 'node:22', profile: 'far' })), 'user:ana'))
    .rejects.toThrow(/dev02 cannot run this profile's machines: it lacks docker/u);
  expect(held(farFile(at.local)).machines).toEqual([]);
});

/** A machine on the box's Docker, labelled as one profile's on one host. */
const machine = (name: string, profile: string, host: string) => ({
  name,
  image: 'node:22',
  labels: { 'ahpd.profile': profile, 'ahpd.host': host },
});

it('lists, for two profiles on one box, only each profile\'s own machines', async () => {
  const at = files();
  writeFileSync(farFile(at.local), JSON.stringify({
    machines: [machine('one', 'far', 'host-a'), machine('two', 'near', 'host-a')],
    calls: [],
  }));
  const { listed } = await load(at, { far: { server: 'dev02' }, near: { server: 'dev02' } });
  expect(await listed()).toEqual(['docker-far.one', 'docker-near.two']);
});

it('lists, for two hosts on one box\'s Docker, only the machines each host made', async () => {
  const at = files();
  writeFileSync(farFile(at.local), JSON.stringify({
    machines: [machine('mine', 'far', 'host-a'), machine('theirs', 'far', 'host-b')],
    calls: [],
  }));
  const a = await load(at, { far: { server: 'dev02' } }, { hostId: 'host-a' });
  const b = await load(at, { far: { server: 'dev02' } }, { hostId: 'host-b' });
  expect(await a.listed()).toEqual(['docker-far.mine']);
  expect(await b.listed()).toEqual(['docker-far.theirs']);
});

it('lists the local machines when a box\'s Docker refuses, naming it', async () => {
  const at = files();
  writeFileSync(at.local, JSON.stringify({ machines: [{ name: 'here', image: 'node:22' }], calls: [] }));
  writeFileSync(farFile(at.local), JSON.stringify({ machines: [], calls: [], failPs: true }));
  const { listed, lines } = await load(at, { far: { server: 'dev02' } });
  expect(await listed()).toEqual(['here']);
  expect(lines.some((line) => line.includes('Could not list the docker-far machines'))).toBe(true);
});

it('adopts a box\'s disposable machines at the next listing that reaches it, when the startup listing did not', async () => {
  const at = files();
  const far = farFile(at.local);
  writeFileSync(far, JSON.stringify({
    machines: [{
      name: 'left',
      image: 'node:22',
      labels: { ...machine('left', 'far', 'host-a').labels, 'ahpd.disposable': 'far' },
    }],
    calls: [],
    failPs: true,
  }));
  const { listed, lines } = await load(at, { far: { server: 'dev02', disposable: true } });
  await until(() => lines.some((line) => line.includes('the docker-far runtime\'s machines are adopted at the next listing that reaches it')));
  expect(lines.some((line) => line.includes('found the disposable machine docker-far.left'))).toBe(false);

  writeFileSync(far, JSON.stringify({ ...held(far), failPs: false }));
  expect(await listed()).toEqual(['docker-far.left']);
  await until(() => lines.some((line) => line.includes('found the disposable machine docker-far.left left behind')));
});

/** The least an agent is, with the needs it declares. */
const agent = (provider: string, needs: Record<string, MachineNeed>): Agent => ({
  provider,
  displayName: provider,
  schema: () => ({}),
  defaults: () => ({}),
  machine: () => needs,
  create: () => { throw new Error('not started in this test'); },
} as unknown as Agent);

it('refuses a profile mount of a path on this host, and copies a directory need in rather than mounting it', async () => {
  const at = files();
  const home = join(at.dir, 'tool-home');
  mkdirSync(home);
  writeFileSync(join(home, 'settings.json'), '{}');
  const tool = agent('tool', { toolHome: { directory: home, target: '/ahpd/tool', required: true } });

  const mounted = await load(at, { far: { server: 'dev02', agents: ['tool'], mounts: [`${at.dir}:/work`] } }, { agents: [tool] });
  await expect(mounted.provider.write('computer://box', said(JSON.stringify({ image: 'node:22', profile: 'far' })), 'user:ana'))
    .rejects.toThrow(`profile far makes its machines on dev02's Docker, and the profile's mount ${at.dir}:/work is a path on this host`);
  expect(held(farFile(at.local)).machines).toEqual([]);

  const { provider } = await load(at, { far: { server: 'dev02', agents: ['tool'] } }, { agents: [tool] });
  await provider.write('computer://box', said(JSON.stringify({ image: 'node:22', profile: 'far' })), 'user:ana');
  const far = held(farFile(at.local));
  expect(far.machines.map((one) => one.name)).toEqual(['box']);
  expect(far.machines[0]?.mounts ?? []).toEqual([]);
  expect(far.calls.some((one) => one[0] === 'cp' && one[1] === home && one[2] === 'box:/ahpd/tool')).toBe(true);
  expect(far.calls.flat().some((one) => one.includes(`${home}:`))).toBe(false);
});

/** An agent shaped like cofold: a configuration file holding keys, read from this host by default. */
const cofoldLike = (config: string, seed: string): Agent => agent('cofold', {
  cofoldState: { state: '/ahpd/cofold', seed: [{ source: seed, target: 'cofold/config.json' }], credential: true },
  cofoldConfig: { file: config, target: '/ahpd/cofold/config.json', readOnly: true, required: true, when: 'host', credential: true },
});

it('refuses a host credential on another box\'s Docker naming the need, and copies a file the profile gives instead', async () => {
  const at = files();
  const own = join(at.dir, 'own.json');
  const given = join(at.dir, 'for-dev02.json');
  writeFileSync(own, '{"key":"this-host"}');
  writeFileSync(given, '{"key":"dev02"}');
  const cofold = cofoldLike(own, own);

  const refused = await load(at, { far: { server: 'dev02', agents: ['cofold'], state: 'host' } }, { agents: [cofold] });
  await expect(refused.provider.write('computer://box', said(JSON.stringify({ image: 'node:22', profile: 'far' })), 'user:ana'))
    .rejects.toThrow('profile far makes its machines on dev02\'s Docker, and need cofoldConfig of cofold is this host\'s own credential');
  expect(held(farFile(at.local)).calls.filter((one) => one[0] === 'cp')).toEqual([]);

  const { provider } = await load(
    at,
    { far: { server: 'dev02', agents: ['cofold'], state: 'host', needs: { cofoldConfig: given } } },
    { agents: [cofold] },
  );
  await provider.write('computer://box', said(JSON.stringify({ image: 'node:22', profile: 'far' })), 'user:ana');
  const copied = held(farFile(at.local)).calls.filter((one) => one[0] === 'cp');
  expect(copied).toEqual([['cp', given, 'box:/ahpd/cofold/config.json']]);
});

it('refuses a state need seeded from this host\'s credential on another box\'s Docker, copying no seed', async () => {
  const at = files();
  const own = join(at.dir, 'own.json');
  writeFileSync(own, '{"key":"this-host"}');
  const { provider } = await load(
    at,
    { far: { server: 'dev02', agents: ['cofold'], state: 'volume' } },
    { agents: [cofoldLike(own, own)] },
  );
  await expect(provider.write('computer://box', said(JSON.stringify({ image: 'node:22', profile: 'far' })), 'user:ana'))
    .rejects.toThrow('need cofoldState of cofold is this host\'s own credential');
  const far = held(farFile(at.local));
  expect(far.machines).toEqual([]);
  expect(far.calls.flat().some((one) => one.includes(own))).toBe(false);
});

/** The variable an agent needs, and the secret its value is read from. */
const BOX_TOKEN = 'BOX_TOKEN';
const HOST_TOKEN = 'host:box-token';
const SECRET = 'sekrit-value';

/** A vault holding `values` and nothing else. */
const holding = (values: Record<string, string>): Vault => ({
  get: async (name) => values[name],
  set: async () => {},
  delete: async () => false,
  list: async () => Object.keys(values),
});

it('runs a session in a machine on a box\'s Docker nested, reached through that Docker with the vault\'s values by name', async () => {
  const at = files();
  const vaulted = agent('vaulted', { boxToken: { name: BOX_TOKEN, default: { $secret: HOST_TOKEN } } });
  const { options, provider } = await load(
    at,
    { far: { server: 'dev02', agents: ['vaulted'] } },
    { agents: [vaulted], vault: holding({ [HOST_TOKEN]: SECRET }) },
  );
  await provider.write('computer://box', said(JSON.stringify({ image: 'node:22', profile: 'far' })), 'user:ana');

  expect(options.computers?.remote?.('docker-far.box')).toBe(true);
  expect(options.computers?.remote?.('box')).toBe(false);

  const spawn = await options.computers?.nested?.('docker-far.box', { plugins: ['@ahpd/agent-cofold'], cwd: at.dir, provider: 'vaulted' });
  // The box's Docker, and the vault's value beside the command and never in it.
  expect(spawn?.env?.DOCKER_HOST).toBe('ssh://dev02');
  expect(spawn?.env?.[BOX_TOKEN]).toBe(SECRET);
  expect(JSON.stringify(spawn?.args)).not.toContain(SECRET);
  // A path on this host names nothing in a machine on another box.
  expect(spawn?.args).not.toContain(at.dir);
  expect(spawn?.workingDirectory).not.toBe(at.dir);

  // And a command a tool runs there is given the value too.
  const tool = (options.tools ?? []).find((one) => one.definition.name === 'run_in_computer') as HostTool;
  await tool.run({ id: 'docker-far.box', command: 'env' }, { provider: 'vaulted' } as never);
  const far = held(farFile(at.local)) as Held & { commands?: { env: Record<string, string>; dockerEnv: string[] }[] };
  expect(far.commands?.at(-1)?.env[BOX_TOKEN]).toBe(SECRET);
  expect(far.commands?.at(-1)?.dockerEnv).toContain('DOCKER_HOST');
  expect(JSON.stringify(far.calls)).not.toContain(SECRET);
});

it('hands a machine on a box\'s Docker the whole record of a record agent, by name', async () => {
  const at = files();
  const { options, provider } = await load(at, { far: { server: 'dev02' } });
  await provider.write('computer://box', said(JSON.stringify({ image: 'node:22', profile: 'far' })), 'user:ana');

  const whole = { id: 'cofold', engine: 'cofold', owner: 'host' as const, name: 'Cofold', config: { apiKey: SECRET } };
  const bare = { ...whole, config: {} };
  const spawn = await options.computers?.nested?.('docker-far.box', { plugins: ['@ahpd/agent-cofold'], record: { whole, bare } });
  // The box's Docker takes the value from the environment it is run with, as
  // a vault value is, so the key is never in an argument.
  expect(JSON.parse(spawn?.env?.AHPD_AGENT_RECORD ?? '{}')).toEqual(whole);
  expect(spawn?.args).toContain('AHPD_AGENT_RECORD');
  expect(JSON.stringify(spawn?.args)).not.toContain(SECRET);
});
