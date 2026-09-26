import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { createHost } from '../packages/sdk/src/host.js';
import { fileResources } from '../packages/sdk/src/resources.js';
import { loadPlugins } from '../packages/server/src/plugins.js';
import { echo } from '../examples/echo/agent.js';
import type { Agent } from '../packages/sdk/src/types/agent.js';
import type { HostOptions } from '../packages/sdk/src/types/host.js';
import type { MachineNeed } from '../packages/sdk/src/types/machine.js';
import type { Peer } from '../packages/sdk/src/types/rpc.js';

/*
 * A disposable machine: offered as a source, made when a session starts, and
 * gone a delay after the last session that used it.
 *
 * The `docker` the runtime spawns is the scripted fixture, so what is under
 * test is what this package asked Docker for and when it asked: the profile,
 * the session's harness needs, the folder, the labels a restart reads back,
 * and the timers. No daemon and no container.
 */

const REPO = join(import.meta.dirname, '..');
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
  loose = mkdtempSync(join(tmpdir(), 'ahpd-disposable-'));
  return loose;
};

/** The fake docker's own record. */
interface Held {
  machines: {
    name: string; image: string; mounts?: string[]; env?: Record<string, string>;
    labels?: Record<string, string>; workdir?: string; state?: string;
  }[];
  calls: string[][];
  failRun?: boolean;
}

const held = (state: string): Held => (existsSync(state)
  ? JSON.parse(readFileSync(state, 'utf8')) as Held
  : { machines: [], calls: [] });

/**
 * Real milliseconds, even under a faked clock.
 *
 * The delay tests move `setTimeout`; a subprocess still takes real time to
 * start, so the wait is the one this module captured before the clock was
 * faked.
 */
const realSetTimeout = setTimeout;
const wait = (ms: number): Promise<void> => new Promise((resolve) => { realSetTimeout(resolve, ms); });

/** Yield to the event loop until the check holds, for a real subprocess. */
const until = async (check: () => boolean, times = 1000): Promise<void> => {
  for (let i = 0; i < times; i++) {
    if (check()) return;
    await wait(5);
  }
};

const settle = async (times = 30): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((resolve) => { setImmediate(resolve); });
};

const peer = (): Peer & { notes: { method: string; params: unknown }[] } => {
  const notes: { method: string; params: unknown }[] = [];
  return {
    notes,
    send: () => {},
    notify: (method, params) => notes.push({ method, params }),
    request: async () => ({}),
    answered: () => {},
    close: () => {},
  };
};

const base = (agents: Agent[]): HostOptions => ({
  path: '/tmp/computer-disposable',
  agents,
  resources: fileResources(),
});

/** The echo backend, declaring what a machine needs for it to run. */
const agentWith = (needs: Record<string, MachineNeed> = {}): Agent => ({
  ...echo({ path: '/tmp/computer-disposable', pace: 0 }),
  machine: () => needs,
});

const load = (
  pluginOptions: Record<string, unknown>,
  agents: Agent[] = [],
  log: (message: string) => void = () => {},
) => loadPlugins(
  [{ name: SOURCE, options: pluginOptions }],
  { base: base(agents), configDir: REPO, cwd: REPO, log },
);

/** The options every test starts from: the fixture as the runtime. */
const options = (state: string, more: Record<string, unknown> = {}): Record<string, unknown> => ({
  command: process.execPath,
  args: [FIXTURE],
  env: { DOCKER_FAKE_STATE: state },
  ...more,
});

/** One host, several sessions, so the count can be seen moving. */
async function room(hostOptions: HostOptions) {
  const p = peer();
  const client = createHost(hostOptions).accept(p);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  });
  return {
    client,
    peer: p,
    open: async (uri: string, config: Record<string, unknown>, folder?: string): Promise<void> => {
      await client.handle({
        method: 'createSession',
        params: {
          channel: uri,
          provider: 'echo',
          config,
          ...(folder === undefined ? {} : { workingDirectories: [folder] }),
        },
      });
      await client.handle({ method: 'subscribe', params: { channel: uri } });
    },
    dispose: (uri: string): Promise<unknown> => client.handle({ method: 'disposeSession', params: { channel: uri } }),
  };
}

/** The actions one client was told about on one channel. */
const actions = (
  p: ReturnType<typeof peer>,
  channel: string,
): Record<string, unknown>[] => p.notes
  .filter((note) => note.method === 'action')
  .map((note) => note.params as { channel: string; action: Record<string, unknown> })
  .filter((note) => note.channel === channel)
  .map((note) => note.action);

/*
 * Task 01: the picker.
 */
it('offers a disposable profile as disposable:<key>, labelled with its title', async () => {
  const state = join(temp(), 'docker.json');
  const { options: loaded, problems } = await load(options(state, {
    profiles: {
      claude: { title: 'Claude', description: 'A machine of its own.', image: 'node:22', disposable: true },
      plain: { title: 'Plain' },
      alone: { title: 'Alone', disposable: true, disposableAlone: true },
    },
  }));
  expect(problems).toEqual([]);

  const answerer = loaded.sessionConfigCompletions?.computer as NonNullable<typeof loaded.sessionConfigCompletions>['computer'];
  const all = await answerer({ property: 'computer', query: '' });
  // Empty first, because it is the default and the way back. Then the profiles
  // a session may make a machine from, by the title a person picked.
  expect(all.map((one) => one.value)).toEqual(['', 'disposable:claude', 'disposable:alone']);
  expect(all.find((one) => one.value === 'disposable:claude')).toMatchObject({
    label: 'Claude',
    description: 'A machine of its own.',
  });
  // A profile without the flag is not a source. It is made from the form, like
  // every profile before this.
  expect(all.some((one) => one.value === 'disposable:plain')).toBe(false);

  // What a person types narrows it, the same as for a running machine.
  const typed = await answerer({ property: 'computer', query: 'clau' });
  expect(typed.map((one) => one.value)).toEqual(['disposable:claude']);
});

/*
 * Task 02: made at session start.
 */
it('makes a machine at session start from the profile, the harness needs and the folder', async () => {
  const dir = temp();
  const state = join(dir, 'docker.json');
  const configDir = join(dir, 'claude-home');
  const folder = join(dir, 'project');
  mkdirSync(configDir);
  mkdirSync(folder);

  const { options: loaded, problems } = await load(options(state, {
    profiles: { claude: { title: 'Claude', image: 'node:22', disposable: true } },
  }), [agentWith({ config: { directory: configDir, target: '/ahpd/config', required: true } })]);
  expect(problems).toEqual([]);

  const { open } = await room(loaded);
  await open('ahp-session:/one', { computer: 'disposable:claude' }, folder);

  const made = held(state);
  expect(made.machines).toHaveLength(1);
  const box = made.machines[0] as NonNullable<Held['machines'][number]>;
  expect(box.image).toBe('node:22');
  // The need the harness declared, then the folder the session works in, at
  // the same path - so the CLI keys its history the same inside and out.
  expect(box.mounts).toEqual([`${configDir}:/ahpd/config`, `${folder}:${folder}`]);
  expect(box.workdir).toBe(folder);
  expect(box.labels).toMatchObject({
    'ahpd.computer': '1',
    'ahpd.agents': 'echo',
    'ahpd.disposable': 'claude',
  });
  // The machine is named, not an anonymous blob, so a person can find it.
  expect(box.name).toMatch(/^ahpd-computer-/);
});

it('keeps the machine for a restart before the first turn, and starts no timer', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const dir = temp();
  const state = join(dir, 'docker.json');
  const folder = join(dir, 'project');
  mkdirSync(folder);

  const { options: loaded } = await load(options(state, {
    profiles: { claude: { title: 'Claude', disposable: true, disposableDelay: 1000 } },
  }), [agentWith()]);
  const { client, open, dispose } = await room(loaded);
  await open('ahp-session:/one', { computer: 'disposable:claude' }, folder);

  const made = held(state);
  const box = made.machines[0]?.name as string;
  expect(box).toBeDefined();

  // What the first send pushes: the whole config bag, including the source the
  // person picked while the session runs in the machine that source became.
  await client.handle({
    method: 'dispatchAction',
    params: { channel: 'ahp-session:/one', action: { type: 'session/configChanged', config: { computer: 'disposable:claude' } } },
  });
  await settle();

  // No second machine, and no second start.
  expect(held(state).machines.map((one) => one.name)).toEqual([box]);
  expect(held(state).calls.filter((one) => one[0] === 'run' || one[0] === 'create')).toHaveLength(1);

  // And no timer: the delay passes and the machine is still there, because a
  // restart is the same session rather than a second user.
  await vi.advanceTimersByTimeAsync(10000);
  await settle();
  expect(held(state).machines.map((one) => one.name)).toEqual([box]);
  expect(held(state).calls.some((one) => one[0] === 'rm')).toBe(false);

  // A disposal is a real end, and the delay then runs.
  await dispose('ahp-session:/one');
  await settle();
  await vi.advanceTimersByTimeAsync(1000);
  await until(() => held(state).machines.length === 0);
  expect(held(state).calls.some((one) => one[0] === 'rm')).toBe(true);
});

it('makes the machine when a disposable profile is picked before the first turn', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const dir = temp();
  const state = join(dir, 'docker.json');
  const folder = join(dir, 'project');
  mkdirSync(folder);

  const { options: loaded } = await load(options(state, {
    profiles: { claude: { title: 'Claude', disposable: true, disposableDelay: 1000 } },
  }), [agentWith()]);
  const { client, peer: p, open, dispose } = await room(loaded);
  // New opened before the person decided, so the session has no computer.
  await open('ahp-session:/one', {}, folder);
  expect(held(state).machines).toEqual([]);

  // The first send carries the profile that was picked, and the session is
  // started again into the machine the profile becomes.
  await client.handle({
    method: 'dispatchAction',
    params: { channel: 'ahp-session:/one', action: { type: 'session/configChanged', config: { computer: 'disposable:claude' } } },
  });
  await until(() => held(state).machines.length === 1);
  // The restart runs behind the `configChanged`, and the machine file is
  // written before the create's own process has exited; give the start its
  // moment before disposing the session it is starting.
  await wait(200);
  await settle();
  const box = held(state).machines[0]?.name as string;
  expect(held(state).machines[0]?.labels).toMatchObject({ 'ahpd.disposable': 'claude', 'ahpd.agents': 'echo' });

  // What the client is told is the machine the session actually has, not the
  // source it picked: a chip holding the source would name nothing.
  const told = actions(p, 'ahp-session:/one')
    .filter((action) => action.type === 'session/configChanged')
    .map((action) => (action.config as Record<string, unknown>).computer);
  expect(told).toContain(`computer://${box}`);
  expect(told).not.toContain('disposable:claude');

  // It is a real user, so the delay does not run while the session is in it.
  await vi.advanceTimersByTimeAsync(10000);
  await settle();
  expect(held(state).machines.map((one) => one.name)).toEqual([box]);

  // And the delay runs when the session is disposed.
  await dispose('ahp-session:/one');
  await settle();
  await vi.advanceTimersByTimeAsync(1000);
  await until(() => held(state).machines.length === 0);
  expect(held(state).calls.some((one) => one[0] === 'rm')).toBe(true);
});

it('answers a session whose machine could not be made with the runtime sentence', async () => {
  const dir = temp();
  const state = join(dir, 'docker.json');
  writeFileSync(state, JSON.stringify({ machines: [], calls: [], failRun: true }));

  const { options: loaded } = await load(options(state, {
    profiles: { claude: { title: 'Claude', disposable: true } },
  }), [agentWith()]);
  const { open } = await room(loaded);
  await expect(open('ahp-session:/one', { computer: 'disposable:claude' }))
    .rejects.toThrow(/refuses to make this one/);
  // Nothing was left watched, because nothing was made.
  expect(held(state).machines).toEqual([]);
});

/*
 * Task 03: the count and the delay.
 */
it('removes the machine after the delay, and a session that picks it again cancels it', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const dir = temp();
  const state = join(dir, 'docker.json');
  const folder = join(dir, 'project');
  mkdirSync(folder);

  const { options: loaded } = await load(options(state, {
    profiles: { claude: { title: 'Claude', disposable: true, disposableDelay: 1000 } },
  }), [agentWith()]);
  const { open, dispose } = await room(loaded);
  await open('ahp-session:/one', { computer: 'disposable:claude' }, folder);
  const box = held(state).machines[0]?.name as string;

  // The last session is gone, so the delay is running.
  await dispose('ahp-session:/one');
  await settle();
  await vi.advanceTimersByTimeAsync(600);
  await settle();
  expect(held(state).machines.map((one) => one.name)).toEqual([box]);

  // But another session picks the running machine, which cancels it.
  await open('ahp-session:/two', { computer: `computer://${box}` });
  await settle();
  await vi.advanceTimersByTimeAsync(10000);
  await settle();
  expect(held(state).machines.map((one) => one.name)).toEqual([box]);

  // And when that one is gone too, the delay runs out for real.
  await dispose('ahp-session:/two');
  await settle();
  await vi.advanceTimersByTimeAsync(1000);
  await until(() => held(state).machines.length === 0);
  expect(held(state).calls.filter((one) => one[0] === 'rm')).toHaveLength(1);
});

it('keeps an alone machine out of the picker while its profile stays offered', async () => {
  const dir = temp();
  const state = join(dir, 'docker.json');
  const folder = join(dir, 'project');
  mkdirSync(folder);

  const { options: loaded } = await load(options(state, {
    profiles: { alone: { title: 'Alone', disposable: true, disposableAlone: true } },
  }), [agentWith()]);
  const { open } = await room(loaded);
  await open('ahp-session:/one', { computer: 'disposable:alone' }, folder);
  const box = held(state).machines[0]?.name as string;
  expect(held(state).machines[0]?.labels).toMatchObject({ 'ahpd.disposable': 'alone', 'ahpd.disposable.alone': 'true' });

  const answerer = loaded.sessionConfigCompletions?.computer as NonNullable<typeof loaded.sessionConfigCompletions>['computer'];
  const all = await answerer({ property: 'computer', query: '' });
  // The source is offered, so a session can still ask for a machine of its own.
  expect(all.map((one) => one.value)).toContain('disposable:alone');
  // The machine is not, so no second session can walk into this one.
  expect(all.map((one) => one.value)).not.toContain(`computer://${box}`);
});

it('gives a leftover disposable machine the delay again at startup', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const dir = temp();
  const state = join(dir, 'docker.json');
  // What a daemon that stopped left behind: the timers are gone with it, and
  // only the label says this machine was made for one session.
  writeFileSync(state, JSON.stringify({
    machines: [{ name: 'leftover', image: 'node:22', labels: { 'ahpd.disposable': 'claude' } }],
    calls: [],
  }));

  const lines: string[] = [];
  await load(options(state, {
    profiles: { claude: { title: 'Claude', disposable: true, disposableDelay: 1000 } },
  }), [], (message) => { lines.push(message); });

  // The scan is a listing, which is a subprocess; wait for it to say what it
  // found before moving the clock.
  await until(() => lines.some((one) => one.includes('left behind')));
  expect(held(state).machines.map((one) => one.name)).toEqual(['leftover']);

  await vi.advanceTimersByTimeAsync(1000);
  await until(() => held(state).machines.length === 0);
  expect(held(state).calls.some((one) => one[0] === 'rm')).toBe(true);
});

/*
 * Task 04: the docs' own example.
 *
 * The object below is the `profiles` half of the example in `docs/COMPUTER.md`,
 * kept in step by hand: an example that does not load is worse than none.
 */
it('loads the disposable example from docs/COMPUTER.md', async () => {
  const state = join(temp(), 'docker.json');
  const docs = {
    profiles: {
      scratch: {
        title: 'Scratch',
        description: 'A machine of this session\'s own, with the CLI shared in.',
        image: 'node:22',
        mounts: ['/srv/claude-home:/ahpd/claude'],
        disposable: true,
        disposableDelay: 300000,
        disposableAlone: true,
      },
    },
  };
  const { options: loaded, problems } = await load(options(state, docs));
  expect(problems).toEqual([]);

  const answerer = loaded.sessionConfigCompletions?.computer as NonNullable<typeof loaded.sessionConfigCompletions>['computer'];
  const all = await answerer({ property: 'computer', query: '' });
  expect(all.find((one) => one.value === 'disposable:scratch')).toMatchObject({ label: 'Scratch' });
});
