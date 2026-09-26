import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { fileResources } from '../packages/sdk/src/resources.js';
import { loadPlugins } from '../packages/server/src/plugins.js';
import type { Agent } from '../packages/sdk/src/types/agent.js';
import type { HostOptions } from '../packages/sdk/src/types/host.js';
import type { MachineNeed } from '../packages/sdk/src/types/machine.js';

/*
 * A machine made from what its agents declared.
 *
 * The profile names its agents and the plugin asks the host for their needs,
 * which come out as Docker flags, a `docker cp` between the create and the
 * start, and the `ahpd.agents` label the picker and the host read back. The
 * `docker` is the scripted fixture, so what is under test is the command this
 * package builds rather than Docker.
 */

const REPO = join(import.meta.dirname, '..');
const SOURCE = './packages/computer/src/index.ts';
const FIXTURE = fileURLToPath(new URL('./fixtures/docker.mjs', import.meta.url));

/** A temporary directory removed after the test that made it. */
let loose: string | undefined;
afterEach(() => {
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

const base = (agents: Agent[]): HostOptions => ({
  path: '/tmp/computer-needs',
  agents,
  resources: fileResources(),
});

interface Held {
  machines: {
    name: string; image: string; mounts?: string[]; env?: Record<string, string>;
    labels?: Record<string, string>; workdir?: string; state?: string;
  }[];
  calls: string[][];
}

const load = (pluginOptions: Record<string, unknown>, agents: Agent[] = []) => loadPlugins(
  [{ name: SOURCE, options: pluginOptions }],
  { base: base(agents), configDir: REPO, cwd: REPO, log: () => {} },
);

const providerOf = (options: HostOptions) => options.resourceProviders?.computer as {
  write(uri: string, content: { data: string; encoding: string }): Promise<void>;
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
      agent('two', { config: { file: good, target: '/shared/target' } }),
    ],
    { profile: 'both' },
  );
  expect((clash as Error).message).toMatch(/both land at \/shared\/target/);

  // And a folder that is not there is refused like any other host path.
  const noFolder = await bad(withAgents({ claude: { agents: ['claude'], folder: gone } }), [agent('claude')], { profile: 'claude' });
  expect((noFolder as Error).message).toMatch(/folder names .* and that path is not there/);
});

it('offers a machine only to the agents it was prepared for', async () => {
  const dir = temp();
  const state = join(dir, 'docker.json');
  // Two machines, one for each agent, and one made before any label existed.
  writeFileSync(state, JSON.stringify({
    machines: [
      { name: 'for-claude', image: 'node:22', labels: { 'ahpd.agents': 'claude' } },
      { name: 'for-cofold', image: 'node:22', labels: { 'ahpd.agents': 'cofold' } },
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
  expect(forClaude.map((one) => one.value)).toEqual(['', 'computer://for-claude', 'computer://old']);

  const forCofold = await answerer({ property: 'computer', query: '', provider: 'cofold' });
  expect(forCofold.map((one) => one.value)).toEqual(['', 'computer://for-cofold', 'computer://old']);

  // A client that names no agent is offered everything, which is what a picker
  // drawn before the harness is chosen has to do.
  const anyone = await answerer({ property: 'computer', query: '' });
  expect(anyone.map((one) => one.value)).toEqual([
    '', 'computer://for-claude', 'computer://for-cofold', 'computer://old',
  ]);
});
