import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { fileResources } from '../../sdk/src/resources.js';
import { loadPlugins } from '../../server/src/plugins.js';
import type { Agent } from '../../sdk/src/types/agent.js';
import type { MachineNeed } from '../../sdk/src/types/machine.js';

/*
 * A state volume, seeded from this host before its machine starts.
 *
 * The stamp in the volume records each seed as it was when it was written, so
 * a second machine of one profile and owner copies nothing, a changed seed is
 * written again on its own, and what the agent wrote beside the seeds stays.
 * The `docker` is the scripted fixture, whose volumes keep their files across
 * containers.
 */

const REPO = join(import.meta.dirname, '../../..');
const SOURCE = './packages/computer/src/index.ts';
const FIXTURE = fileURLToPath(new URL('./fixtures/docker.mjs', import.meta.url));

let loose: string | undefined;
afterEach(() => {
  if (loose !== undefined) rmSync(loose, { recursive: true, force: true });
  loose = undefined;
  if (home !== undefined) rmSync(home, { recursive: true, force: true });
  home = undefined;
});

const temp = (): string => {
  loose = mkdtempSync(join(tmpdir(), 'ahpd-computer-state-'));
  return loose;
};

/*
 * The state directory a load is given, which is a temporary one of its own.
 *
 * A load with this repository as its state directory writes into the checkout:
 * a machine made on a linked worktree leaves `computers.gitfile` at whatever
 * `configDir` names, and a test that did that put a file in the repository.
 */
let home: string | undefined;
const stateDir = (): string => (home ??= mkdtempSync(join(tmpdir(), 'ahpd-computer-state-config-')));

const agent = (provider: string, needs: Record<string, MachineNeed>): Agent => ({
  provider,
  displayName: provider,
  schema: () => ({}),
  defaults: () => ({}),
  machine: () => needs,
  create: () => { throw new Error('not started in this test'); },
} as unknown as Agent);

interface Held {
  machines: { name: string }[];
  calls: string[][];
  volumes?: Record<string, { files: string[]; contents?: Record<string, string>; owners?: Record<string, string> }>;
  copiedIn?: string[][];
  chowns?: string[][];
  commands?: { id: string; user?: string; command: string[] }[];
}

const held = (state: string): Held => JSON.parse(readFileSync(state, 'utf8')) as Held;

/** The plugin over the scripted Docker, holding `extra` in its state, with its log kept. */
const load = async (state: string, needs: Record<string, MachineNeed>, extra: Record<string, unknown> = {}) => {
  writeFileSync(state, JSON.stringify({ machines: [], calls: [], ...extra }));
  const lines: string[] = [];
  const { options, problems } = await loadPlugins(
    [{
      name: SOURCE,
      options: { command: process.execPath, args: [FIXTURE], env: { DOCKER_FAKE_STATE: state }, sessionSetting: false, profiles: { box: { agents: ['claude'] } } },
    }],
    { base: { path: '/tmp/computer-state', agents: [agent('claude', needs)], resources: fileResources() }, configDir: stateDir(), cwd: REPO, log: (line) => { lines.push(line); } },
  );
  expect(problems).toEqual([]);
  const provider = options.resourceProviders?.computer as {
    write(uri: string, content: { data: string; encoding: string }, owner?: string): Promise<void>;
  };
  const make = (name: string): Promise<void> =>
    provider.write(`computer://${name}`, { data: JSON.stringify({ profile: 'box' }), encoding: 'utf-8' }, 'user:alice');
  return { make, lines };
};

const VOLUME = `ahpd-state-box-user-alice-claude-${createHash('sha256').update('box\0user:alice\0claude').digest('hex').slice(0, 8)}`;

it('seeds a state volume once, again only for a seed that changed, and keeps what the agent wrote', async () => {
  const dir = temp();
  const state = join(dir, 'docker.json');
  const settings = join(dir, 'settings.json');
  const notes = join(dir, 'CLAUDE.md');
  writeFileSync(settings, '{"theme":"dark"}');
  writeFileSync(notes, '# notes\n');
  const { make } = await load(state, {
    claudeState: { state: '/ahpd/claude', seed: [{ source: settings }, { source: notes }] },
  });

  await make('one');
  const first = held(state);
  expect(first.copiedIn).toEqual([['settings.json', 'CLAUDE.md', '.ahpd-seed.json']]);
  expect(first.volumes?.[VOLUME]?.contents?.['settings.json']).toBe('{"theme":"dark"}');
  // Seeded before the machine was made, through a helper that is gone again.
  const order = first.calls.map((one) => one[0]);
  expect(order.lastIndexOf('cp')).toBeLessThan(order.lastIndexOf('run'));
  expect(first.machines.map((one) => one.name)).toEqual(['one']);

  // The agent writes beside the seeds.
  const volume = first.volumes?.[VOLUME];
  volume?.files.push('history.jsonl');
  if (volume?.contents !== undefined) volume.contents['history.jsonl'] = 'a turn';
  writeFileSync(state, JSON.stringify(first));

  await make('two');
  expect(held(state).copiedIn).toHaveLength(1);

  writeFileSync(settings, '{"theme":"light"}');
  utimesSync(settings, new Date(), new Date(Date.now() + 60_000));
  await make('three');
  const third = held(state);
  expect(third.copiedIn?.[1]).toEqual(['settings.json', '.ahpd-seed.json']);
  expect(third.volumes?.[VOLUME]?.contents?.['settings.json']).toBe('{"theme":"light"}');
  expect(third.volumes?.[VOLUME]?.contents?.['history.jsonl']).toBe('a turn');
  expect(third.volumes?.[VOLUME]?.contents?.['CLAUDE.md']).toBe('# notes\n');
});

it('skips a seed whose host source is absent with a line, and seeds the rest', async () => {
  const dir = temp();
  const state = join(dir, 'docker.json');
  const settings = join(dir, 'settings.json');
  const gone = join(dir, 'gone.json');
  writeFileSync(settings, '{}');
  const { make, lines } = await load(state, {
    claudeState: { state: '/ahpd/claude', seed: [{ source: gone }, { source: settings }] },
  });
  await make('one');
  expect(held(state).copiedIn).toEqual([['settings.json', '.ahpd-seed.json']]);
  expect(held(state).machines.map((one) => one.name)).toEqual(['one']);
  expect(lines.filter((one) => one.includes(gone))).toEqual([
    `ahpd-computer: one seeds ${VOLUME} without ${gone}, which is not on this host`,
  ]);

  // Seeded once it appears.
  writeFileSync(gone, '{}');
  await make('two');
  expect(held(state).copiedIn?.[1]).toEqual(['gone.json', '.ahpd-seed.json']);
});

it('gives the seeded files to the machine’s user, and leaves a root machine’s alone', async () => {
  const dir = temp();
  const state = join(dir, 'docker.json');
  const settings = join(dir, 'settings.json');
  writeFileSync(settings, '{}');
  const needs: Record<string, MachineNeed> = { claudeState: { state: '/ahpd/claude', seed: [{ source: settings }] } };

  const { make } = await load(state, needs, { imageUser: { 'debian:bookworm-slim': 'node' }, users: { node: { uid: 1000, gid: 1000 } } });
  await make('one');
  const first = held(state);
  // The owner rides in the archive, the volume's root among it, and nothing
  // is chowned after the copy and no other image is run for it.
  expect(first.calls.filter((one) => one[0] === 'cp' && one.includes('-a'))).toHaveLength(1);
  expect(first.volumes?.[VOLUME]?.owners).toEqual({ '.': '1000:1000', 'settings.json': '1000:1000', '.ahpd-seed.json': '1000:1000' });
  expect(first.calls.filter((one) => one.includes('chown'))).toEqual([]);

  const rooted = join(dir, 'rooted.json');
  const { make: makeRoot } = await load(rooted, needs);
  await makeRoot('one');
  expect(held(rooted).volumes?.[VOLUME]?.owners?.['settings.json']).toBe('0:0');
  expect(held(rooted).calls.filter((one) => one.includes('chown') || one.includes('id'))).toEqual([]);
});

it('never follows a link inside a seeded directory, and says so once', async () => {
  const dir = temp();
  const state = join(dir, 'docker.json');
  const skills = join(dir, 'skills');
  mkdirSync(skills);
  writeFileSync(join(skills, 'SKILL.md'), 'skill');
  writeFileSync(join(dir, 'outside.txt'), 'not a seed');
  // A link to its own parent would walk forever, and one out of the directory
  // would copy a file the seed never named.
  symlinkSync('..', join(skills, 'loop'));
  symlinkSync(join(dir, 'outside.txt'), join(skills, 'outside'));
  const { make, lines } = await load(state, { claudeState: { state: '/ahpd/claude', seed: [{ source: skills }] } });
  await make('one');
  expect(held(state).copiedIn).toEqual([['skills/SKILL.md', '.ahpd-seed.json']]);
  expect(lines.filter((one) => one.includes('link'))).toEqual([
    `ahpd-computer: one seeds ${VOLUME} without ${join(skills, 'loop')}, a link it does not follow`,
    `ahpd-computer: one seeds ${VOLUME} without ${join(skills, 'outside')}, a link it does not follow`,
  ]);
});

it('follows a seed that is itself a link, once', async () => {
  const dir = temp();
  const state = join(dir, 'docker.json');
  writeFileSync(join(dir, 'real.json'), '{}');
  symlinkSync(join(dir, 'real.json'), join(dir, 'settings.json'));
  const { make } = await load(state, { claudeState: { state: '/ahpd/claude', seed: [{ source: join(dir, 'settings.json') }] } });
  await make('one');
  expect(held(state).copiedIn).toEqual([['settings.json', '.ahpd-seed.json']]);
});

it('seeds a dev container that builds its image after up, inside it and owned by its user’s ids, with no other image', async () => {
  const dir = temp();
  const state = join(dir, 'docker.json');
  const devState = join(dir, 'dev.json');
  const folder = join(dir, 'work');
  mkdirSync(join(folder, '.devcontainer'), { recursive: true });
  writeFileSync(join(folder, '.devcontainer', 'devcontainer.json'), '{ "dockerFile": "Dockerfile", "remoteUser": "node" }');
  writeFileSync(join(folder, '.devcontainer', 'Dockerfile'), 'FROM debian\n');
  const settings = join(dir, 'settings.json');
  writeFileSync(settings, '{}');
  writeFileSync(state, JSON.stringify({ machines: [], calls: [], users: { node: { uid: 1000, gid: 1000 } } }));
  const lines: string[] = [];
  const { options, problems } = await loadPlugins(
    [{
      name: SOURCE,
      options: {
        command: process.execPath, args: [FIXTURE], env: { DOCKER_FAKE_STATE: state }, sessionSetting: false,
        devcontainer: {
          command: process.execPath,
          args: [fileURLToPath(new URL('./fixtures/devcontainer.mjs', import.meta.url))],
          env: { DEVCONTAINER_FAKE_STATE: devState, DOCKER_FAKE_STATE: state },
        },
      },
    }],
    { base: { path: '/tmp/computer-state', agents: [agent('claude', { claudeState: { state: '/ahpd/claude', seed: [{ source: settings }] } })], resources: fileResources() }, configDir: dir, cwd: REPO, log: (line) => { lines.push(line); } },
  );
  expect(problems).toEqual([]);
  await options.computers?.create?.({ source: `devcontainer://${folder}`, session: 'claude:/one', provider: 'claude', owner: 'user:ada' });
  const after = held(state);
  // No container is created for the seed, so no image is pulled for it.
  expect(after.calls.filter((one) => one[0] === 'create')).toEqual([]);
  expect(after.calls.flat().filter((one) => one.includes('bookworm'))).toEqual([]);
  // The seed is written into the running container, after its user's ids are
  // read there, and nothing is chowned.
  const copies = after.calls.filter((one) => one[0] === 'cp' && one.includes('-a'));
  expect(copies).toEqual([['cp', '-a', '-', 'abc123:/ahpd']]);
  expect(after.calls.findIndex((one) => one[0] === 'exec')).toBeLessThan(after.calls.findIndex((one) => one[0] === 'cp'));
  const commands = after.commands ?? [];
  expect(commands.filter((one) => one.command.includes('chown'))).toEqual([]);
  expect(commands.filter((one) => one.command[0] === 'id').map((one) => one.user)).toEqual(['node', 'node']);
  const volume = Object.values(after.volumes ?? {})[0];
  expect(volume?.owners).toEqual({ '.': '1000:1000', 'settings.json': '1000:1000', '.ahpd-seed.json': '1000:1000' });
  expect(lines.filter((one) => one.includes('owned by root'))).toEqual([]);
});

it('keeps only the named keys of a JSON seed, and drops a dotted path', async () => {
  const dir = temp();
  const state = join(dir, 'docker.json');
  const config = join(dir, '.claude.json');
  const settings = join(dir, 'settings.json');
  writeFileSync(config, JSON.stringify({ mcpServers: { a: { command: 'x' } }, oauthAccount: { email: 'a@b' }, userID: 'u' }));
  writeFileSync(settings, JSON.stringify({ theme: 'dark', security: { auth: 'token', other: 1 } }));
  const { make } = await load(state, {
    claudeState: {
      state: '/ahpd/claude',
      seed: [{ source: config, keep: ['mcpServers'] }, { source: settings, drop: ['security.auth'] }],
    },
  });
  await make('one');
  const contents = held(state).volumes?.[VOLUME]?.contents ?? {};
  expect(JSON.parse(contents['.claude.json'] ?? '')).toEqual({ mcpServers: { a: { command: 'x' } } });
  expect(JSON.parse(contents['settings.json'] ?? '')).toEqual({ theme: 'dark', security: { other: 1 } });
});

it('seeds a directory under its target, each file at its own path', async () => {
  const dir = temp();
  const state = join(dir, 'docker.json');
  const skills = join(dir, 'skills');
  mkdirSync(join(skills, 'review'), { recursive: true });
  writeFileSync(join(skills, 'review', 'SKILL.md'), 'review');
  const { make } = await load(state, { claudeState: { state: '/ahpd/claude', seed: [{ source: skills }] } });
  await make('one');
  expect(held(state).copiedIn).toEqual([['skills/review/SKILL.md', '.ahpd-seed.json']]);
});
