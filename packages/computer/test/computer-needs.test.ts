import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { fileResources } from '../../sdk/src/resources.js';
import { dockerRuntime } from '../src/runtime.js';
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

const load = (pluginOptions: Record<string, unknown>, agents: Agent[] = [], vault?: Vault) => loadPlugins(
  [{ name: SOURCE, options: pluginOptions }],
  { base: base(agents, vault), configDir: REPO, cwd: REPO, log: () => {} },
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
  expect(envOf(state)).toEqual({ ANTHROPIC_API_KEY: 'ada-token' });

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
  expect(envOf(state, 0)).toEqual({ ANTHROPIC_API_KEY: 'shared-value' });
  expect(envOf(state, 1)).toEqual({ ANTHROPIC_API_KEY: 'shared-value' });
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
  expect(envOf(state)).toEqual({ ANTHROPIC_API_KEY: 'ada-token' });
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
  expect(envOf(state, 0)).toEqual({ ANTHROPIC_API_KEY: 'ada-x' });

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
  await create({
    source: 'disposable:claude',
    session: 'ahp-session:/one',
    provider: 'claude',
    owner: 'user:ada',
  });
  expect(envOf(state)).toEqual({ ANTHROPIC_API_KEY: 'ada-token' });

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
