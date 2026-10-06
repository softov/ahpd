import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { fileResources } from '../../sdk/src/resources.js';
import { dockerRuntime } from '../src/runtime.js';
import { revealed } from '../src/secrets.js';
import { loadPlugins } from '../../server/src/plugins.js';
import type { Agent } from '../../sdk/src/types/agent.js';
import type { HostOptions } from '../../sdk/src/types/host.js';
import type { MachineNeed } from '../../sdk/src/types/machine.js';
import type { Vault } from '../../sdk/src/types/vault.js';

/*
 * A machine made from what its agents declared.
 *
 * The profile names its agents and the plugin asks the host for their needs,
 * which come out as Docker flags, a `docker cp` between the create and the
 * start, and the `ahpd.agents` label the picker and the host read back. The
 * `docker` is the scripted fixture, so what is under test is the command this
 * package builds rather than Docker.
 */

const REPO = join(import.meta.dirname, '../../..');
const SOURCE = './packages/computer/src/index.ts';
const FIXTURE = fileURLToPath(new URL('./fixtures/docker.mjs', import.meta.url));

/** A temporary directory removed after the test that made it. */
let loose: string | undefined;
afterEach(() => {
  vi.useRealTimers();
  if (loose !== undefined) rmSync(loose, { recursive: true, force: true });
  loose = undefined;
});

const temp = (): string => {
  loose = mkdtempSync(join(tmpdir(), 'ahpd-computer-needs-'));
  return loose;
};

/** The least an agent is, with the needs it declares. */
const agent = (provider: string, needs: Record<string, MachineNeed> = {}): Agent => ({
  provider,
  displayName: provider,
  schema: () => ({}),
  defaults: () => ({}),
  machine: () => needs,
  create: () => { throw new Error('not started in this test'); },
} as unknown as Agent);

const base = (agents: Agent[], vault?: Vault): HostOptions => ({
  path: '/tmp/computer-needs',
  agents,
  resources: fileResources(),
  ...(vault === undefined ? {} : { vault }),
});

/** A vault holding `values` and nothing else, which records what it was asked for. */
const holding = (values: Record<string, string>): Vault & { asked: string[] } => {
  const asked: string[] = [];
  return {
    asked,
    get: async (name) => { asked.push(name); return values[name]; },
    set: async () => {},
    delete: async () => false,
    list: async () => Object.keys(values),
  };
};

interface Held {
  machines: {
    name: string; image: string; mounts?: string[]; env?: Record<string, string>;
    labels?: Record<string, string>; workdir?: string; state?: string;
  }[];
  calls: string[][];
}

/**
 * The daemon's configuration folder: the test's own temporary directory where
 * it made one, so a `computers.json` it writes goes with the test.
 */
const configHome = (): string => loose ?? REPO;

const load = (pluginOptions: Record<string, unknown>, agents: Agent[] = [], vault?: Vault) => loadPlugins(
  [{ name: SOURCE, options: pluginOptions }],
  { base: base(agents, vault), configDir: configHome(), cwd: REPO, log: () => {} },
);

const providerOf = (options: HostOptions) => options.resourceProviders?.computer as {
  write(uri: string, content: { data: string; encoding: string }, owner?: string): Promise<void>;
  list(uri: string): Promise<{ name: string }[]>;
};

it('turns resolved needs into flags, a copy, a label and a same-path folder', async () => {
  const dir = temp();
  const state = join(dir, 'docker.json');
  const configDir = join(dir, 'claude-home');
  const configJson = join(dir, 'claude.json');
  const cli = join(dir, 'claude-cli');
  const folder = join(dir, 'project');
  mkdirSync(configDir);
  mkdirSync(folder);
  writeFileSync(configJson, '{}');
  writeFileSync(cli, '#!/bin/sh\n');

  const needs: Record<string, MachineNeed> = {
    claudeConfigDirectory: { directory: configDir, target: '/ahpd/claude', required: true },
    claudeConfigJson: { file: configJson, target: '/ahpd/claude/.claude.json', readOnly: true, required: true },
    anthropicKey: { name: 'ANTHROPIC_API_KEY', default: 'from-the-agent' },
    claudeExecutable: { source: cli, target: '/usr/local/bin/claude', required: true },
  };
  const { options, problems } = await load({
    command: process.execPath,
    args: [FIXTURE],
    env: { DOCKER_FAKE_STATE: state },
    sessionSetting: false,
    profiles: { claude: { agents: ['claude'], folder } },
  }, [agent('claude', needs)]);

  expect(problems).toEqual([]);
  const provider = providerOf(options);
  await provider.write('computer://box', { data: JSON.stringify({ profile: 'claude' }), encoding: 'utf-8' });

  const held = JSON.parse(readFileSync(state, 'utf8')) as Held;
  const box = held.machines[0] as NonNullable<Held['machines'][number]>;
  // A mount and a copy-in are different things: one is visible, the other is
  // placed before the first process starts.
  expect(box.mounts).toEqual([
    `${configDir}:/ahpd/claude`,
    `${configJson}:/ahpd/claude/.claude.json:ro`,
    // The folder a session works in, at the same path, so the CLI keys its
    // history the same way inside and out.
    `${folder}:${folder}`,
  ]);
  expect(box.env).toEqual({ ANTHROPIC_API_KEY: 'from-the-agent' });
  // The variable reached the machine by name: the value was in docker's own
  // environment and is in no argv the scripted docker saw.
  const made = held.calls.find((one) => one[0] === 'create') ?? [];
  expect(made.slice(made.indexOf('-e'), made.indexOf('-e') + 2)).toEqual(['-e', 'ANTHROPIC_API_KEY']);
  expect(held.calls.flat().filter((one) => one.includes('from-the-agent'))).toEqual([]);
  expect(box.labels).toMatchObject({ 'ahpd.computer': '1', 'ahpd.agents': 'claude' });
  expect(box.workdir).toBe(folder);

  // A copy-in needs the container to exist and not be running, so the machine
  // is created, then copied into, then started. The inspect and the list before
  // them are the create's own checks.
  expect(held.calls.slice(-3).map((one) => one[0])).toEqual(['create', 'cp', 'start']);
  expect(held.calls.slice(-2)[0]).toEqual(['cp', cli, 'box:/usr/local/bin/claude']);

  // The port reads the same label back, which is what the host checks a
  // session against before it lets one enter.
  expect(await options.computers?.agents?.('box')).toEqual(['claude']);
  expect(await options.computers?.agents?.('nope')).toBeUndefined();
});

it('makes a machine with a DOCKER_ need without running docker under it', async () => {
  const state = join(temp(), 'docker.json');
  const { options } = await load({
    command: process.execPath,
    args: [FIXTURE],
    env: { DOCKER_FAKE_STATE: state },
    sessionSetting: false,
    profiles: { claude: { agents: ['claude'] } },
  }, [agent('claude', {
    context: { name: 'DOCKER_CONTEXT', default: 'elsewhere' },
    config: { name: 'DOCKER_CONFIG', default: '/tmp/other-config' },
  })]);
  await providerOf(options).write('computer://box', { data: JSON.stringify({ profile: 'claude' }), encoding: 'utf-8' });

  const held = JSON.parse(readFileSync(state, 'utf8')) as Held & { machines: { dockerEnv?: string[] }[] };
  const box = held.machines[0];
  expect(box?.env).toEqual({ DOCKER_CONTEXT: 'elsewhere', DOCKER_CONFIG: '/tmp/other-config' });
  // In the machine, and not in the environment `docker run` itself ran in.
  expect(box?.dockerEnv).not.toContain('DOCKER_CONTEXT');
  expect(box?.dockerEnv).not.toContain('DOCKER_CONFIG');
  const made = held.calls.find((one) => one[0] === 'run') ?? [];
  expect(made).toContain('DOCKER_CONTEXT=elsewhere');
});

it('mounts one entry where the folder is named as a mount as well', async () => {
  const dir = temp();
  const state = join(dir, 'docker.json');
  const folder = join(dir, 'project');
  mkdirSync(folder);

  /*
   * The target check already collapses two identical entries, so this pair is
   * accepted - and the runtime has to agree, because `docker run` refuses the
   * machine outright as `Duplicate mount point` when it hears the same target
   * twice. The refusal would come from the runtime, not from here.
   */
  const { options } = await load({
    command: process.execPath,
    args: [FIXTURE],
    env: { DOCKER_FAKE_STATE: state },
    sessionSetting: false,
    profiles: { claude: { agents: ['claude'], folder, mounts: [`${folder}:${folder}`] } },
  }, [agent('claude', {})]);
  await providerOf(options).write('computer://box', { data: JSON.stringify({ profile: 'claude' }), encoding: 'utf-8' });

  const held = JSON.parse(readFileSync(state, 'utf8')) as Held;
  expect(held.machines[0]?.mounts).toEqual([`${folder}:${folder}`]);
});

it('fills a need from the profile over the plugin option over the agent', async () => {
  const dir = temp();
  const state = join(dir, 'docker.json');
  const own = join(dir, 'own');
  const fromOption = join(dir, 'option');
  const fromProfile = join(dir, 'profile');
  for (const one of [own, fromOption, fromProfile]) mkdirSync(one);

  const { options } = await load({
    command: process.execPath,
    args: [FIXTURE],
    env: { DOCKER_FAKE_STATE: state },
    sessionSetting: false,
    needs: { config: fromOption },
    profiles: { claude: { agents: ['claude'] } },
  }, [agent('claude', { config: { directory: own, target: '/ahpd/config', required: true } })]);
  await providerOf(options).write('computer://one', { data: JSON.stringify({ profile: 'claude' }), encoding: 'utf-8' });

  // The plugin option stands in for the agent's own default.
  expect((JSON.parse(readFileSync(state, 'utf8')) as Held).machines[0]?.mounts)
    .toEqual([`${fromOption}:/ahpd/config`]);

  // A profile's own value wins over both, which is how one agent runs against
  // another configuration without the agent being changed.
  const { options: second } = await load({
    command: process.execPath,
    args: [FIXTURE],
    env: { DOCKER_FAKE_STATE: state },
    sessionSetting: false,
    needs: { config: fromOption },
    profiles: { claude: { agents: ['claude'], needs: { config: fromProfile } } },
  }, [agent('claude', { config: { directory: own, target: '/ahpd/config', required: true } })]);
  await providerOf(second).write('computer://two', { data: JSON.stringify({ profile: 'claude' }), encoding: 'utf-8' });
  const made = JSON.parse(readFileSync(state, 'utf8')) as Held;
  expect(made.machines[1]?.mounts).toEqual([`${fromProfile}:/ahpd/config`]);
});

it('refuses a missing path, an unknown agent, a shared target and a missing folder', async () => {
  const dir = temp();
  const state = join(dir, 'docker.json');
  const good = join(dir, 'good');
  mkdirSync(good);
  const other = join(dir, 'other');
  mkdirSync(other);
  const gone = join(dir, 'gone');

  const bad = async (
    pluginOptions: Record<string, unknown>,
    agents: Agent[],
    body: Record<string, unknown>,
  ): Promise<unknown> => {
    const { options } = await load(pluginOptions, agents);
    return providerOf(options).write('computer://box', { data: JSON.stringify(body), encoding: 'utf-8' })
      .catch((error: unknown) => error);
  };
  const withAgents = (profiles: Record<string, unknown>): Record<string, unknown> => ({
    command: process.execPath, args: [FIXTURE], env: { DOCKER_FAKE_STATE: state }, sessionSetting: false, profiles,
  });

  // The path named by the need - not the machine - is what is missing, and the
  // sentence says the need and where the value came from.
  const missing = await bad(
    withAgents({ claude: { agents: ['claude'] } }),
    [agent('claude', { config: { file: gone, target: '/ahpd/config', required: true } })],
    { profile: 'claude' },
  );
  expect(missing).toMatchObject({ code: -32602 });
  expect((missing as Error).message).toMatch(/machine need config points at/);
  expect((missing as Error).message).toContain(gone);
  expect((missing as Error).message).toMatch(/the agent's default/);

  // A profile naming an agent this host does not have is refused rather than
  // made with none of what it was prepared for.
  const unknown = await bad(withAgents({ claude: { agents: ['nope'] } }), [agent('claude')], { profile: 'claude' });
  expect((unknown as Error).message).toMatch(/has no agent called nope/);

  // Two agents landing on one target is one of them silently losing.
  const clash = await bad(
    withAgents({ both: { agents: ['one', 'two'] } }),
    [
      agent('one', { config: { file: good, target: '/shared/target' } }),
      agent('two', { other: { file: other, target: '/shared/target' } }),
    ],
    { profile: 'both' },
  );
  expect((clash as Error).message).toMatch(/need config and need other both land at \/shared\/target/);

  // And a folder that is not there is refused like any other host path.
  const noFolder = await bad(withAgents({ claude: { agents: ['claude'], folder: gone } }), [agent('claude')], { profile: 'claude' });
  expect((noFolder as Error).message).toMatch(/folder names .* and that path is not there/);
});

/*
 * A need value that names a secret rather than being one.
 *
 * The value is read when the machine is made and for the machine's owner, so
 * the two cases that matter are whose machine it is and which profile was
 * picked: a `user:` secret belongs to one person, a `host:` one to anybody, and
 * a profile nobody picked is never this machine's to read.
 */
const KEY: Record<string, MachineNeed> = { anthropicKey: { name: 'ANTHROPIC_API_KEY', default: 'from-the-agent' } };

const envOf = (state: string, at = 0): Record<string, string> | undefined =>
  (JSON.parse(readFileSync(state, 'utf8')) as Held).machines[at]?.env;

/**
 * What a command run in a machine is given: the variables its `docker exec`
 * names, and the environment `docker` is spawned with for them.
 */
const execOf = async (options: HostOptions, id: string): Promise<{ names: string[]; env: Record<string, string>; args: string[] }> => {
  const how = await options.computers?.how(id, { command: 'true' });
  const args = how?.args ?? [];
  const names = args.flatMap((one, at) => (args[at - 1] === '-e' ? [one] : []));
  return { names, env: how?.env ?? {}, args };
};

/** Every `docker run` and `docker create` the scripted docker saw. */
const makes = (state: string): string[][] =>
  (JSON.parse(readFileSync(state, 'utf8')) as Held).calls.filter((one) => one[0] === 'run' || one[0] === 'create');

const written = async (
  options: HostOptions,
  name: string,
  body: Record<string, unknown>,
  owner?: string,
): Promise<unknown> =>
  providerOf(options).write(`computer://${name}`, { data: JSON.stringify(body), encoding: 'utf-8' }, owner)
    .catch((error: unknown) => error);

it('reads a profile need naming a secret, for the machine it is made for', async () => {
  const state = join(temp(), 'docker.json');
  const store = holding({ 'user:ada/token': 'ada-token' });
  const { options, problems } = await load({
    command: process.execPath,
    args: [FIXTURE],
    env: { DOCKER_FAKE_STATE: state },
    sessionSetting: false,
    profiles: { claude: { agents: ['claude'], needs: { anthropicKey: { $secret: 'user:ada/token' } } } },
  }, [agent('claude', KEY)], store);
  expect(problems).toEqual([]);

  await written(options, 'ada', { profile: 'claude' }, 'user:ada');
  // Never given at create, so the machine's own record does not hold it; it is
  // passed by name on each command run in the machine instead.
  expect(envOf(state)).toEqual({});
  expect(makes(state).flat().filter((one) => one.includes('ANTHROPIC_API_KEY') || one.includes('ada-token'))).toEqual([]);
  const ada = await execOf(options, 'ada');
  expect(ada.names).toEqual(['ANTHROPIC_API_KEY']);
  expect(ada.env.ANTHROPIC_API_KEY).toBe('ada-token');
  expect(ada.args.some((one) => one.includes('ada-token'))).toBe(false);

  // Ada's secret is not a secret this work may read, so the machine is refused
  // naming the need and the name rather than made without the credential.
  const refused = await written(options, 'bo', { profile: 'claude' }, 'user:bo');
  expect(refused).toMatchObject({ code: -32602 });
  expect((refused as Error).message).toContain('machine need anthropicKey names user:ada/token');
  expect((refused as Error).message).toContain('is not a secret this work may read');
  expect((JSON.parse(readFileSync(state, 'utf8')) as Held).machines).toHaveLength(1);
});

it('reads a host-scoped need in the option for any owner', async () => {
  const state = join(temp(), 'docker.json');
  const store = holding({ 'host:shared': 'shared-value' });
  const { options, problems } = await load({
    command: process.execPath,
    args: [FIXTURE],
    env: { DOCKER_FAKE_STATE: state },
    sessionSetting: false,
    needs: { anthropicKey: { $secret: 'host:shared' } },
    profiles: { claude: { agents: ['claude'] } },
  }, [agent('claude', KEY)], store);
  expect(problems).toEqual([]);

  // The deployment's value, so it lands whichever person the machine is for.
  await written(options, 'one', { profile: 'claude' }, 'user:ada');
  await written(options, 'two', { profile: 'claude' }, 'user:bo');
  expect(envOf(state, 0)).toEqual({});
  expect(envOf(state, 1)).toEqual({});
  expect((await execOf(options, 'one')).env.ANTHROPIC_API_KEY).toBe('shared-value');
  expect((await execOf(options, 'two')).env.ANTHROPIC_API_KEY).toBe('shared-value');
});

it('refuses a need naming a secret the vault does not hold', async () => {
  const state = join(temp(), 'docker.json');
  const { options } = await load({
    command: process.execPath,
    args: [FIXTURE],
    env: { DOCKER_FAKE_STATE: state },
    sessionSetting: false,
    profiles: { claude: { agents: ['claude'], needs: { anthropicKey: { $secret: 'user:ada/none' } } } },
  }, [agent('claude', KEY)], holding({}));

  const refused = await written(options, 'box', { profile: 'claude' }, 'user:ada');
  expect(refused).toMatchObject({ code: -32602 });
  expect((refused as Error).message).toContain('machine need anthropicKey names user:ada/none: the vault holds no user:ada/none');
});

it('never reads a need of a profile the body did not pick', async () => {
  const state = join(temp(), 'docker.json');
  const store = holding({ 'user:ada/token': 'ada-token', 'user:bo/token': 'bo-token' });
  const { options, problems } = await load({
    command: process.execPath,
    args: [FIXTURE],
    env: { DOCKER_FAKE_STATE: state },
    sessionSetting: false,
    profiles: {
      ada: { agents: ['claude'], needs: { anthropicKey: { $secret: 'user:ada/token' } } },
      bo: { agents: ['claude'], needs: { anthropicKey: { $secret: 'user:bo/token' } } },
    },
  }, [agent('claude', KEY)], store);
  expect(problems).toEqual([]);

  await written(options, 'box', { profile: 'ada' }, 'user:ada');
  expect(envOf(state)).toEqual({});
  expect((await execOf(options, 'box')).env.ANTHROPIC_API_KEY).toBe('ada-token');
  // Bo's profile is not this machine's, so his token was never wanted.
  expect(store.asked).toEqual(['user:ada/token']);
});

it('reads a plugin-wide need only where an agent on the machine declares it', async () => {
  const state = join(temp(), 'docker.json');
  const store = holding({ 'user:ada/x': 'ada-x' });
  const { options, problems } = await load({
    command: process.execPath,
    args: [FIXTURE],
    env: { DOCKER_FAKE_STATE: state },
    sessionSetting: false,
    // One value for every machine this host makes, under a need only Claude
    // declares: the deployment's `needs` are one map, and a cofold machine
    // resolves none of this.
    needs: { anthropicKey: { $secret: 'user:ada/x' } },
    profiles: { claude: { agents: ['claude'] }, cofold: { agents: ['cofold'] } },
  }, [agent('claude', KEY), agent('cofold')], store);
  expect(problems).toEqual([]);

  // Ada's, and Ada's machine, so it lands.
  await written(options, 'ada', { profile: 'claude' }, 'user:ada');
  expect(envOf(state, 0)).toEqual({});
  expect((await execOf(options, 'ada')).env.ANTHROPIC_API_KEY).toBe('ada-x');

  // A machine for an agent that declares no needs: nothing under that name is
  // this machine's, so nothing was read and the machine is made rather than
  // refused over somebody else's token.
  await written(options, 'cofold', { profile: 'cofold' }, 'user:bo');
  expect(envOf(state, 1)).toEqual({});

  // And it is still Ada's when Claude is the agent asked for.
  const refused = await written(options, 'other', { profile: 'claude' }, 'user:bo');
  expect(refused).toMatchObject({ code: -32602 });
  expect((refused as Error).message).toContain('machine need anthropicKey names user:ada/x');
  expect((refused as Error).message).toContain('is not a secret this work may read');

  // Read once, for the one machine it was wanted for.
  expect(store.asked).toEqual(['user:ada/x']);
});

it('reads a disposable machine\'s need for the session it is made for', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const state = join(temp(), 'docker.json');
  const store = holding({ 'user:ada/token': 'ada-token' });
  const { options, problems } = await load({
    command: process.execPath,
    args: [FIXTURE],
    env: { DOCKER_FAKE_STATE: state },
    sessionSetting: false,
    profiles: { claude: { agents: ['claude'], disposable: true, needs: { anthropicKey: { $secret: 'user:ada/token' } } } },
  }, [agent('claude', KEY)], store);
  expect(problems).toEqual([]);

  // The machine is made when the session starts, and its owner is the
  // session's: the profile named no agents of its own to make.
  const create = options.computers?.create as NonNullable<NonNullable<typeof options.computers>['create']>;
  const id = await create({
    source: 'disposable:claude',
    session: 'ahp-session:/one',
    provider: 'claude',
    owner: 'user:ada',
  });
  expect(envOf(state)).toEqual({});
  expect((await execOf(options, String(id))).env.ANTHROPIC_API_KEY).toBe('ada-token');

  const refused = await create({
    source: 'disposable:claude',
    session: 'ahp-session:/two',
    provider: 'claude',
    owner: 'user:bo',
  }).catch((error: unknown) => error);
  expect((refused as Error).message).toContain('machine need anthropicKey names user:ada/token');
  expect((JSON.parse(readFileSync(state, 'utf8')) as Held).machines).toHaveLength(1);
  vi.useRealTimers();
});

it('refuses a target two mounts land at, and makes one that only says it once', async () => {
  const dir = temp();
  const state = join(dir, 'docker.json');
  const good = join(dir, 'good');
  const other = join(dir, 'other');
  mkdirSync(good);
  mkdirSync(other);
  const withAgents = (profiles: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    command: process.execPath,
    args: [FIXTURE],
    env: { DOCKER_FAKE_STATE: state },
    sessionSetting: false,
    profiles,
    ...extra,
  });
  const bad = async (options: Record<string, unknown>, agents: Agent[], body: Record<string, unknown>): Promise<Error> => {
    const { options: loaded } = await load(options, agents);
    return providerOf(loaded).write('computer://box', { data: JSON.stringify(body), encoding: 'utf-8' })
      .then(() => { throw new Error('the machine was made'); })
      .catch((error: unknown) => error as Error);
  };

  // A profile mount and a need at one target: the operator's hand-written path
  // and the agent's declaration, named as they are in the sentence.
  const withProfileMount = await bad(
    withAgents({ claude: { agents: ['claude'], mounts: [`${good}:/ahpd/claude`] } }),
    [agent('claude', { claudeConfigDirectory: { directory: other, target: '/ahpd/claude', required: true } })],
    { profile: 'claude' },
  );
  expect(withProfileMount.message).toBe(
    `the profile's mount ${good}:/ahpd/claude and need claudeConfigDirectory both land at /ahpd/claude`,
  );

  // The same target from the profile's own folder, which the Docker route
  // mounts at the path it has here.
  const withFolder = await bad(
    withAgents({ claude: { agents: ['claude'], folder: good } }),
    [agent('claude', { claudeConfigDirectory: { directory: other, target: good, required: true } })],
    { profile: 'claude' },
  );
  expect(withFolder.message).toMatch(/need claudeConfigDirectory and the folder .* both land at/);

  // And on the CLI's route, where a copy-in is a bind: a need and a copy at
  // one target are refused there too.
  const folder = join(dir, 'workspace');
  mkdirSync(join(folder, '.devcontainer'), { recursive: true });
  writeFileSync(join(folder, '.devcontainer', 'devcontainer.json'), '{}');
  const withCopy = await bad(
    withAgents({ claude: { agents: ['claude'] } }),
    [agent('claude', {
      claudeConfigDirectory: { directory: good, target: '/ahpd/claude', required: true },
      cliHome: { source: other, target: '/ahpd/claude' },
    })],
    { profile: 'claude', devcontainer: { folder } },
  );
  expect(withCopy.message).toMatch(/need claudeConfigDirectory and the copy from .* both land at \/ahpd\/claude/);

  // Two agents declaring the same need at the same target are one statement,
  // not a clash: variants of one plugin share a profile's state.
  const { options: same } = await load(
    withAgents({ both: { agents: ['one', 'two'] } }),
    [
      agent('one', { config: { directory: good, target: '/ahpd/shared', required: true } }),
      agent('two', { config: { directory: good, target: '/ahpd/shared', required: true } }),
    ],
  );
  await providerOf(same).write('computer://same', { data: JSON.stringify({ profile: 'both' }), encoding: 'utf-8' });
  expect((JSON.parse(readFileSync(state, 'utf8')) as Held).machines[0]?.mounts).toEqual([`${good}:/ahpd/shared`]);
});

it('refuses a mount whose host path is relative or not there, whoever named it', async () => {
  const dir = temp();
  const state = join(dir, 'docker.json');
  const good = join(dir, 'good');
  const gone = join(dir, 'gone');
  mkdirSync(good);

  const bad = async (pluginOptions: Record<string, unknown>, body: Record<string, unknown>): Promise<Error> => {
    const { options } = await load(pluginOptions);
    return providerOf(options).write('computer://box', { data: JSON.stringify(body), encoding: 'utf-8' })
      .then(() => { throw new Error('the machine was made'); })
      .catch((error: unknown) => error as Error);
  };
  const runtime = (extra: Record<string, unknown>): Record<string, unknown> => ({
    command: process.execPath, args: [FIXTURE], env: { DOCKER_FAKE_STATE: state }, sessionSetting: false, ...extra,
  });

  // A profile's own mount. Today this is made with an empty directory at the
  // target, and the session finds out by exiting.
  const fromProfile = await bad(
    runtime({ profiles: { plain: { mounts: [`${gone}:/ahpd/gone`] } } }),
    { profile: 'plain' },
  );
  expect(fromProfile).toMatchObject({ code: -32602 });
  expect(fromProfile.message).toBe(`the profile's mount ${gone}:/ahpd/gone names ${gone}, and that path is not there`);

  // The deployment's, which a relative source turns into a Docker named volume.
  const fromPlugin = await bad(runtime({ mounts: ['cache:/cache'] }), {});
  expect(fromPlugin.message).toBe("the plugin's mount cache:/cache names cache, which is not an absolute path on this host");

  // And a body's own, where the deployment allows bodies to name mounts at all.
  const fromBody = await bad(runtime({ bodyMounts: true }), { mounts: [`${gone}:/ahpd/gone`] });
  expect(fromBody.message).toBe(`the body's mount ${gone}:/ahpd/gone names ${gone}, and that path is not there`);
});

it('the scripted docker refuses two mounts at one target, as Docker does', async () => {
  const dir = temp();
  const runtime = dockerRuntime({
    command: process.execPath,
    args: [FIXTURE],
    env: { DOCKER_FAKE_STATE: join(dir, 'docker.json') },
    label: 'ahpd.computer=1',
  });

  // What a manifest is checked for before any flag is written, so the fake
  // refusing it too is what makes a regression here fail rather than pass.
  await expect(runtime.run({
    name: 'twice',
    image: 'node:22',
    label: 'ahpd.computer=1',
    mounts: [`${dir}:/shared`, `${join(dir, 'other')}:/shared`],
  })).rejects.toThrow(/Duplicate mount point: \/shared/);
});

it('offers a machine only to the agents it was prepared for', async () => {
  const dir = temp();
  const state = join(dir, 'docker.json');
  // Two machines, one for each agent, one made for both, and one made before
  // any label existed.
  writeFileSync(state, JSON.stringify({
    machines: [
      { name: 'for-claude', image: 'node:22', labels: { 'ahpd.agents': 'claude' } },
      { name: 'for-cofold', image: 'node:22', labels: { 'ahpd.agents': 'cofold' } },
      { name: 'for-both', image: 'node:22', labels: { 'ahpd.agents': 'claude,cofold' } },
      { name: 'old', image: 'debian:bookworm-slim', labels: {} },
    ],
    calls: [],
  }));

  const { options } = await load({
    command: process.execPath,
    args: [FIXTURE],
    env: { DOCKER_FAKE_STATE: state },
  });
  const answerer = options.sessionConfigCompletions?.computer as NonNullable<typeof options.sessionConfigCompletions>['computer'];
  const forClaude = await answerer({ property: 'computer', query: '', provider: 'claude' });
  expect(forClaude.map((one) => one.value)).toEqual(['', 'computer://for-claude', 'computer://for-both', 'computer://old']);

  const forCofold = await answerer({ property: 'computer', query: '', provider: 'cofold' });
  expect(forCofold.map((one) => one.value)).toEqual(['', 'computer://for-cofold', 'computer://for-both', 'computer://old']);

  // A client that names no agent is offered everything, which is what a picker
  // drawn before the harness is chosen has to do.
  const anyone = await answerer({ property: 'computer', query: '' });
  expect(anyone.map((one) => one.value)).toEqual([
    '', 'computer://for-claude', 'computer://for-cofold', 'computer://for-both', 'computer://old',
  ]);
});

it('reads every label a listing reads by name, so a value holding a comma is whole', async () => {
  const dir = temp();
  const state = join(dir, 'docker.json');
  writeFileSync(state, JSON.stringify({
    machines: [{
      name: 'awkward',
      image: 'node:22',
      labels: {
        'ahpd.computer': '1',
        'ahpd.agents': 'claude,cofold',
        'ahpd.disposable': 'claude,fast',
        'ahpd.disposable.alone': 'true',
        'ahpd.owner': 'user:ana,admin',
        'ahpd.team': 'backend,platform',
        'ahpd.project': 'ahpd,docs',
      },
    }],
    calls: [],
  }));
  const runtime = dockerRuntime({
    command: process.execPath,
    args: [FIXTURE],
    env: { DOCKER_FAKE_STATE: state },
    label: 'ahpd.computer=1',
  });

  // `docker ps` prints every label in one comma-joined column, so a value
  // holding a comma is cut where the pairs are cut. Each label is asked for by
  // name instead, and comes back as it was written.
  expect((await runtime.list())[0]).toMatchObject({
    id: 'awkward',
    agents: ['claude', 'cofold'],
    disposable: { profile: 'claude,fast', alone: true },
    owner: 'user:ana,admin',
    team: 'backend,platform',
    project: 'ahpd,docs',
  });
});

it('reads a label value holding a tab or a newline as it was written', async () => {
  const dir = temp();
  const state = join(dir, 'docker.json');
  // A row is one line of tab-separated columns, so a value holding either of
  // the two separators is the case that splits on them. `owner` is a typed
  // reference and `project` a name, and neither is checked for whitespace.
  const owner = 'user:ana\tsilva';
  writeFileSync(state, JSON.stringify({
    machines: [{
      name: 'wrapped',
      image: 'node:22',
      labels: {
        'ahpd.computer': '1',
        'ahpd.agents': 'claude',
        'ahpd.owner': owner,
        'ahpd.project': 'ahpd\tdocs\nold',
      },
    }],
    calls: [],
  }));
  const runtime = dockerRuntime({
    command: process.execPath,
    args: [FIXTURE],
    env: { DOCKER_FAKE_STATE: state },
    label: 'ahpd.computer=1',
  });

  // The labels are read as one JSON object rather than a row of columns, which
  // is what a value cannot break: the separators are escaped inside it.
  expect((await runtime.list())[0]).toMatchObject({ id: 'wrapped', owner, project: 'ahpd\tdocs\nold' });
});

it('answers a machine removed between the listing and its labels with the ones that stayed', async () => {
  const dir = temp();
  const state = join(dir, 'docker.json');
  writeFileSync(state, JSON.stringify({
    machines: [
      { name: 'gone', image: 'node:22', labels: { 'ahpd.computer': '1', 'ahpd.session': 'echo:/gone' } },
      { name: 'stays', image: 'node:22', labels: { 'ahpd.computer': '1', 'ahpd.session': 'echo:/stays' } },
    ],
    // The listing answers both, and drops one before the `inspect` after it.
    vanishAfterPs: 'gone',
    calls: [],
  }));
  const runtime = dockerRuntime({
    command: process.execPath,
    args: [FIXTURE],
    env: { DOCKER_FAKE_STATE: state },
    label: 'ahpd.computer=1',
  });

  /*
   * `inspect` prints the machine it found and exits non-zero over the one it
   * could not, which is not a failure of the listing: the machine is gone, and
   * the listing is of what is there. The line that did come back is `stays`,
   * and it is matched by the name beside it rather than by its place in the
   * answer, which would give `stays` the labels of `gone`.
   */
  expect(await runtime.list()).toMatchObject([{ id: 'stays', session: 'echo:/stays' }]);
});

it('answers which needs a reference gave their value', async () => {
  const read = await revealed(
    { plain: 'as-written', fromVault: { $secret: 'host:b' }, undeclared: { $secret: 'host:c' } },
    ['claude'],
    () => ({ plain: { name: 'PLAIN' }, fromVault: { name: 'FROM_VAULT' } }),
    {},
    async (name) => `read-${name}`,
  );
  expect(read?.values).toEqual({ plain: 'as-written', fromVault: 'read-host:b' });
  expect([...(read?.named ?? new Map()).entries()]).toEqual([['fromVault', 'host:b']]);
});

/*
 * An agent may name a secret as an environment need's own default, which is
 * how a preset written `{ "$secret": "<name>" }` reaches a machine. It is read
 * as a value in the plugin's `needs` is, when the machine is made and for its
 * owner, and it is the default: a profile's or the option's value wins.
 */
const DEFAULTED: Record<string, MachineNeed> = {
  'codex.CODEX_API_KEY': { name: 'CODEX_API_KEY', default: { $secret: 'user:ada/codex' }, required: false },
  'codex.CODEX_HOME': { name: 'CODEX_HOME', default: '/ahpd/codex', required: false },
};

it('reads an agent need whose default names a secret, for the machine\'s owner at create', async () => {
  const dir = temp();
  const state = join(dir, 'docker.json');
  const store = holding({ 'user:ada/codex': 'ada-codex' });
  const lines: string[] = [];
  const { options, problems } = await loadPlugins(
    [{
      name: SOURCE,
      options: {
        command: process.execPath,
        args: [FIXTURE],
        env: { DOCKER_FAKE_STATE: state },
        sessionSetting: false,
        profiles: { codex: { agents: ['codex'] }, gone: { agents: ['codex'], disposable: true } },
      },
    }],
    { base: base([agent('codex', DEFAULTED)], store), configDir: dir, cwd: REPO, log: (line) => { lines.push(line); } },
  );
  expect(problems).toEqual([]);

  await written(options, 'ada', { profile: 'codex' }, 'user:ada');
  // The plain default is given at create; the vault's is never, and it is
  // passed by name on each command instead.
  expect(envOf(state)).toEqual({ CODEX_HOME: '/ahpd/codex' });
  const ada = await execOf(options, 'ada');
  expect(ada.names).toEqual(['CODEX_API_KEY']);
  expect(ada.env.CODEX_API_KEY).toBe('ada-codex');

  // A disposable machine reads it for the session's owner the same way.
  const create = options.computers?.create as NonNullable<NonNullable<typeof options.computers>['create']>;
  const id = String(await create({ source: 'disposable:gone', session: 'ahp-session:/one', provider: 'codex', owner: 'user:ada' }));
  expect((await execOf(options, id)).env.CODEX_API_KEY).toBe('ada-codex');

  // The value is on no argv, in no machine record, in no file beside the
  // configuration and in no log line; the reference is what is recorded.
  expect(readFileSync(state, 'utf8')).not.toContain('ada-codex');
  expect(makes(state).flat().join(' ')).not.toContain('ada-codex');
  expect(ada.args.join(' ')).not.toContain('ada-codex');
  const recorded = readFileSync(join(dir, 'computers.json'), 'utf8');
  expect(recorded).toContain('user:ada/codex');
  expect(recorded).not.toContain('ada-codex');
  expect(lines.join('\n')).not.toContain('ada-codex');

  // Bo's machine cannot read Ada's secret, so that create alone is refused,
  // naming the need and the secret and never a value.
  const refused = await written(options, 'bo', { profile: 'codex' }, 'user:bo');
  expect(refused).toMatchObject({ code: -32602 });
  expect((refused as Error).message).toContain('machine need codex.CODEX_API_KEY names user:ada/codex');
  expect((refused as Error).message).toContain('is not a secret this work may read');
  expect((JSON.parse(readFileSync(state, 'utf8')) as Held).machines.map((one) => one.name)).not.toContain('bo');
});

it('refuses only the create whose agent default names a secret the vault does not hold', async () => {
  const state = join(temp(), 'docker.json');
  const { options } = await load({
    command: process.execPath,
    args: [FIXTURE],
    env: { DOCKER_FAKE_STATE: state },
    sessionSetting: false,
    profiles: { codex: { agents: ['codex'] }, plain: { agents: ['plain'] } },
  }, [agent('codex', DEFAULTED), agent('plain', KEY)], holding({}));

  const refused = await written(options, 'box', { profile: 'codex' }, 'user:ada');
  expect(refused).toMatchObject({ code: -32602 });
  expect((refused as Error).message).toContain('machine need codex.CODEX_API_KEY names user:ada/codex: the vault holds no user:ada/codex');
  // A machine for another agent is made as before.
  expect(await written(options, 'other', { profile: 'plain' }, 'user:ada')).toBeUndefined();
});

it('gives a profile\'s or the option\'s value over an agent default that names a secret, which is then not read', async () => {
  const state = join(temp(), 'docker.json');
  const store = holding({ 'user:ada/codex': 'ada-codex', 'host:mine': 'mine-value' });
  const { options } = await load({
    command: process.execPath,
    args: [FIXTURE],
    env: { DOCKER_FAKE_STATE: state },
    sessionSetting: false,
    needs: { 'codex.CODEX_API_KEY': { $secret: 'host:mine' } },
    profiles: { codex: { agents: ['codex'] }, own: { agents: ['codex'], needs: { 'codex.CODEX_API_KEY': 'profile-value' } } },
  }, [agent('codex', DEFAULTED)], store);

  await written(options, 'opt', { profile: 'codex' }, 'user:ada');
  expect((await execOf(options, 'opt')).env.CODEX_API_KEY).toBe('mine-value');
  await written(options, 'own', { profile: 'own' }, 'user:ada');
  expect(envOf(state, 1)).toMatchObject({ CODEX_API_KEY: 'profile-value' });
  expect(store.asked).not.toContain('user:ada/codex');
});

it('reads an agent default that names a secret again after a restart, for a machine with no recorded needs', async () => {
  const dir = temp();
  const state = join(dir, 'docker.json');
  const store = holding({ 'user:ada/codex': 'ada-codex' });
  const options = {
    command: process.execPath,
    args: [FIXTURE],
    env: { DOCKER_FAKE_STATE: state },
    sessionSetting: false,
    profiles: { codex: { agents: ['codex'] } },
  };
  const first = await load(options, [agent('codex', DEFAULTED)], store);
  await written(first.options, 'ada', { profile: 'codex' }, 'user:ada');
  rmSync(join(dir, 'computers.json'));

  const again = await load(options, [agent('codex', DEFAULTED)], store);
  const reached = await execOf(again.options, 'ada');
  expect(reached.names).toEqual(['CODEX_API_KEY']);
  expect(reached.env.CODEX_API_KEY).toBe('ada-codex');
});

/*
 * A vault-named value is held with its machine in the daemon's memory and
 * nowhere else, so a daemon that restarted reads it again the first time the
 * machine is reached: for the owner the machine carries, from the profile it
 * was made from. When the read fails, the profile's `secretUnreadable` says
 * whether the command fails or runs without that one variable.
 */
const VAULTED: Record<string, MachineNeed> = {
  anthropicKey: { name: 'ANTHROPIC_API_KEY' },
  otherKey: { name: 'OTHER_KEY' },
};

/** The plugin loaded with its log kept, as a daemon starting again would load it. */
const loadLogged = async (pluginOptions: Record<string, unknown>, vault: Vault) => {
  const lines: string[] = [];
  const { options, problems } = await loadPlugins(
    [{ name: SOURCE, options: pluginOptions }],
    { base: base([agent('claude', VAULTED)], vault), configDir: configHome(), cwd: REPO, log: (line) => { lines.push(line); } },
  );
  expect(problems).toEqual([]);
  return { options, lines };
};

const vaultedOptions = (state: string, more: Record<string, unknown> = {}): Record<string, unknown> => ({
  command: process.execPath,
  args: [FIXTURE],
  env: { DOCKER_FAKE_STATE: state },
  sessionSetting: false,
  needs: { otherKey: { $secret: 'host:other' } },
  profiles: {
    claude: { agents: ['claude'], needs: { anthropicKey: { $secret: 'user:ada/token' } }, ...more },
  },
});

it('reads a vault-named value again after a restart, for the owner the machine carries', async () => {
  const state = join(temp(), 'docker.json');
  const store = holding({ 'user:ada/token': 'ada-token', 'host:other': 'other-token' });
  const first = await loadLogged(vaultedOptions(state), store);
  await written(first.options, 'ada', { profile: 'claude' }, 'user:ada');
  expect(store.asked).toEqual(['user:ada/token', 'host:other']);

  // The daemon again, with the same vault: nothing of the value was kept, so
  // it is read again, and Ada's own secret is readable because the machine
  // says it is Ada's.
  const again = await loadLogged(vaultedOptions(state), store);
  const reached = await execOf(again.options, 'ada');
  expect(reached.names).toEqual(['ANTHROPIC_API_KEY', 'OTHER_KEY']);
  expect(reached.env).toMatchObject({ ANTHROPIC_API_KEY: 'ada-token', OTHER_KEY: 'other-token' });
  expect(store.asked).toEqual(['user:ada/token', 'host:other', 'user:ada/token', 'host:other']);
  // Read once, then held: the next command asks the vault nothing.
  await execOf(again.options, 'ada');
  expect(store.asked).toHaveLength(4);
  // And the values are on no argv, in no machine record and in no log line.
  const held = readFileSync(state, 'utf8');
  expect(held).not.toContain('ada-token');
  expect(held).not.toContain('other-token');
  expect([...first.lines, ...again.lines].join('\n')).not.toMatch(/ada-token|other-token/);
});

it('fails every command into the machine when a vault-named value cannot be read again', async () => {
  const state = join(temp(), 'docker.json');
  const first = await loadLogged(vaultedOptions(state), holding({ 'user:ada/token': 'ada-token', 'host:other': 'other-token' }));
  await written(first.options, 'ada', { profile: 'claude' }, 'user:ada');

  // Ada's token is gone from the vault, and the profile says nothing.
  const store = holding({ 'host:other': 'other-token' });
  const again = await loadLogged(vaultedOptions(state), store);
  const refused = await again.options.computers?.how('ada', { command: 'true' }).catch((error: unknown) => error);
  expect((refused as Error).message).toContain('machine need anthropicKey names user:ada/token: the vault holds no user:ada/token');
  // Nothing was held, so the next command reads again and fails the same way.
  const twice = await again.options.computers?.how('ada', { command: 'true' }).catch((error: unknown) => error);
  expect((twice as Error).message).toContain('machine need anthropicKey names user:ada/token');
  expect(store.asked.filter((one) => one === 'user:ada/token')).toHaveLength(2);
  expect((twice as Error).message).not.toContain('other-token');

  // A tool's command is a command in the machine too.
  const tool = (again.options.tools ?? []).find((one) => one.definition.name === 'computer_exec');
  const said = await Promise.resolve(tool?.run({ id: 'ada', command: 'true' }, {} as never)).catch((error: unknown) => error);
  expect(String(said instanceof Error ? said.message : said)).toContain('machine need anthropicKey');
});

it('drops only the unreadable variable and logs it, where the profile says drop', async () => {
  const state = join(temp(), 'docker.json');
  const first = await loadLogged(vaultedOptions(state, { secretUnreadable: 'drop' }), holding({ 'user:ada/token': 'ada-token', 'host:other': 'other-token' }));
  await written(first.options, 'ada', { profile: 'claude' }, 'user:ada');

  const again = await loadLogged(vaultedOptions(state, { secretUnreadable: 'drop' }), holding({ 'host:other': 'other-token' }));
  const how = await again.options.computers?.how('ada', { command: 'true', env: { A: '1' } });
  const args = how?.args ?? [];
  expect(args.flatMap((one, at) => (args[at - 1] === '-e' ? [one] : []))).toEqual(['OTHER_KEY', 'A']);
  expect(how?.env).toMatchObject({ OTHER_KEY: 'other-token', A: '1' });
  expect(how?.env?.ANTHROPIC_API_KEY).toBeUndefined();
  const said = again.lines.filter((one) => one.includes('anthropicKey'));
  expect(said).toHaveLength(1);
  expect(said[0]).toContain('ada is reached without ANTHROPIC_API_KEY: machine need anthropicKey names user:ada/token');
  expect(again.lines.join('\n')).not.toContain('other-token');
});

/*
 * A machine a session made is made for that session's harness, whose needs
 * may be its own rather than the ones the host's agents declare. What it was
 * made with is recorded beside the configuration as names and references, so
 * a daemon started afterwards reads those again rather than the needs the
 * agents declare today.
 */
it('reads a session machine\'s own vault-named need again after a restart, from the reference it was made with', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const dir = temp();
  const state = join(dir, 'docker.json');
  const store = holding({ 'host:session': 'session-token', 'user:ada/token': 'ada-token' });
  const options = {
    ...vaultedOptions(state),
    needs: { sessionKey: { $secret: 'host:session' } },
    profiles: { claude: { agents: [], disposable: true, needs: { anthropicKey: { $secret: 'user:ada/token' } } } },
  };
  const first = await loadLogged(options, store);
  const create = first.options.computers?.create as NonNullable<NonNullable<typeof first.options.computers>['create']>;
  const id = String(await create({
    source: 'disposable:claude',
    session: 'ahp-session:/one',
    provider: 'claude',
    owner: 'user:ada',
    // The session's harness declares a need the host's agents do not.
    needs: { ...VAULTED, sessionKey: { name: 'SESSION_KEY' } },
  }));
  expect((await execOf(first.options, id)).env).toMatchObject({ SESSION_KEY: 'session-token', ANTHROPIC_API_KEY: 'ada-token' });

  const again = await loadLogged(options, store);
  const reached = await execOf(again.options, id);
  expect(reached.names).toEqual(expect.arrayContaining(['SESSION_KEY', 'ANTHROPIC_API_KEY']));
  expect(reached.env).toMatchObject({ SESSION_KEY: 'session-token', ANTHROPIC_API_KEY: 'ada-token' });

  // The record holds the references and never what they read.
  const recorded = readFileSync(join(dir, 'computers.json'), 'utf8');
  expect(recorded).toContain('host:session');
  expect(recorded).toContain('user:ada/token');
  expect(recorded).not.toMatch(/session-token|ada-token/);
  expect(readFileSync(state, 'utf8')).not.toMatch(/session-token|ada-token/);
  expect(reached.args.join(' ')).not.toMatch(/session-token|ada-token/);
  expect([...first.lines, ...again.lines].join('\n')).not.toMatch(/session-token|ada-token/);
  vi.useRealTimers();
});

/*
 * A machine made before needs were recorded has no entry for them, so a
 * daemon started afterwards reads its needs from what its agents declare, as
 * it always did.
 */
it('reads a machine with no recorded needs again from the needs its agents declare', async () => {
  const dir = temp();
  const state = join(dir, 'docker.json');
  const store = holding({ 'user:ada/token': 'ada-token', 'host:other': 'other-token' });
  const first = await loadLogged(vaultedOptions(state), store);
  await written(first.options, 'ada', { profile: 'claude' }, 'user:ada');
  rmSync(join(dir, 'computers.json'));

  const again = await loadLogged(vaultedOptions(state), store);
  const reached = await execOf(again.options, 'ada');
  expect(reached.names).toEqual(['ANTHROPIC_API_KEY', 'OTHER_KEY']);
  expect(reached.env).toMatchObject({ ANTHROPIC_API_KEY: 'ada-token', OTHER_KEY: 'other-token' });
  expect(again.lines.filter((one) => one.includes('computers.json'))).toEqual([]);
});
