import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { MACHINE_OBJECTS } from '../src/gitdir.js';
import { memorySessions } from '../../sdk/src/sessions.js';
import { createHost } from '../../sdk/src/host.js';
import { fileResources } from '../../sdk/src/resources.js';
import { gitWorktrees } from '../../sdk/src/repo/worktrees.js';
import { loadPlugins } from '../../server/src/plugins.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Agent } from '../../sdk/src/types/agent.js';
import type { HostOptions } from '../../sdk/src/types/host.js';
import type { MachineNeed } from '../../sdk/src/types/machine.js';
import type { Peer } from '../../sdk/src/types/rpc.js';

/*
 * A disposable machine: offered as a source, made when a session starts, and
 * gone a delay after the last session that used it.
 *
 * The `docker` the runtime spawns is the scripted fixture, so what is under
 * test is what this package asked Docker for and when it asked: the profile,
 * the session's harness needs, the folder, the labels a restart reads back,
 * and the timers. No daemon and no container.
 */

const REPO = join(import.meta.dirname, '../../..');
const SOURCE = './packages/computer/src/index.ts';
const FIXTURE = fileURLToPath(new URL('./fixtures/docker.mjs', import.meta.url));

/** A temporary directory removed after the test that made it. */
let loose: string | undefined;
afterEach(() => {
  vi.useRealTimers();
  // The scripted docker this file spawns is stopped behind the case and may
  // still be writing its state file, so the folder is removed with retries.
  if (loose !== undefined) rmSync(loose, { recursive: true, force: true, maxRetries: 100, retryDelay: 50 });
  loose = undefined;
  if (state !== undefined) rmSync(state, { recursive: true, force: true });
  state = undefined;
});

const temp = (): string => {
  loose = mkdtempSync(join(tmpdir(), 'ahpd-disposable-'));
  return loose;
};

/*
 * The state directory a load is given, which is a temporary one of its own.
 *
 * A load with this repository as its state directory writes into the checkout:
 * a machine made on a linked worktree leaves `computers.gitfile` at whatever
 * `configDir` names, and a test that did that put a file in the repository.
 */
let state: string | undefined;
const stateDir = (): string => (state ??= mkdtempSync(join(tmpdir(), 'ahpd-disposable-config-')));

/** The fake docker's own record. */
interface Held {
  machines: {
    name: string; image: string; mounts?: string[]; env?: Record<string, string>;
    labels?: Record<string, string>; workdir?: string; state?: string;
    /** When the machine stopped, as `docker inspect` answers it: absent while it is up. */
    stoppedAt?: string;
  }[];
  calls: string[][];
  /** Every `docker exec`, as the fixture ran it: which machine, as whom, and what. */
  commands?: { id: string; user?: string; workdir?: string; env: Record<string, string>; command: string[] }[];
  /** What one command is answered with, by the word it contains. */
  answers?: { when: string; out?: string; file?: string; err?: string; code?: number }[];
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

/**
 * Move the faked clock until a check holds, giving real work its time in between.
 *
 * What arms a disposable machine's delay is a leave, and a leave asks the
 * machine for what it committed before it lets it go - a real subprocess, which
 * a clock this file has faked has no say over. So one turn of the clock can
 * land before the timer it is meant to fire exists, and the `until` after it
 * then waits for a removal that was never scheduled. The two are spent
 * together instead: real milliseconds for the subprocess, then the clock.
 */
const advanceUntil = async (check: () => boolean, times = 400): Promise<void> => {
  for (let i = 0; i < times && !check(); i++) {
    await wait(5);
    await vi.advanceTimersByTimeAsync(1000);
  }
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

const base = (agents: Agent[], more: Partial<HostOptions> = {}): HostOptions => ({
  path: '/tmp/computer-disposable',
  agents,
  resources: fileResources(),
  ...more,
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
  more: Partial<HostOptions> = {},
  hostId?: string,
  configDir = stateDir(),
) => loadPlugins(
  [{ name: SOURCE, options: pluginOptions }],
  { base: base(agents, more), configDir, cwd: REPO, log, ...(hostId === undefined ? {} : { hostId }) },
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
    profiles: { claude: { title: 'Claude', image: 'node:22', disposable: true, sessionFolder: true } },
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
  await until(() => held(state).machines.length === 1);

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
  await advanceUntil(() => held(state).machines.length === 0);
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
  await advanceUntil(() => held(state).machines.length === 0);
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

it('names an env need in a refused run and never its value', async () => {
  const dir = temp();
  const state = join(dir, 'docker.json');
  writeFileSync(state, JSON.stringify({ machines: [], calls: [], failRun: true }));

  const { options: loaded } = await load(options(state, {
    profiles: { claude: { title: 'Claude', disposable: true } },
  }), [agentWith({
    // The value a machine is given is exactly the sort of thing a log and a
    // sentence a session is answered with have no business holding.
    token: { name: 'TOKEN', default: 'sk-x', required: true },
  })]);
  const { open } = await room(loaded);
  const refusal = await open('ahp-session:/one', { computer: 'disposable:claude' })
    .then(() => undefined, (error: Error) => error);

  // The name is what identifies the call that failed and is worth keeping.
  expect(refusal?.message).toContain('-e TOKEN');
  expect(refusal?.message).not.toContain('sk-x');
  // The flag before the value is what tells them apart, so it stays too.
  expect(refusal?.message).toMatch(/run -d .* -e TOKEN debian:bookworm-slim/);
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
  await until(() => held(state).machines.length === 1);
  const box = held(state).machines[0]?.name as string;
  expect(box).toBeDefined();

  // The last session is gone, so the delay is running: the leave asks the
  // machine for what it committed first, which is a real subprocess, so real
  // time is given for it before part of the delay is spent.
  await dispose('ahp-session:/one');
  await settle();
  await wait(300);
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
  await advanceUntil(() => held(state).machines.length === 0);
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

it('a disposable machine that refuses removal is tried again', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const dir = temp();
  const state = join(dir, 'docker.json');
  /*
   * A leftover of this daemon's with a git directory of its own, and a git that
   * will not answer: the removal reads what the machine committed out of it, and
   * a machine whose work cannot be read out is one that is kept. What is in that
   * volume is the only copy of the work there is.
   */
  writeFileSync(state, JSON.stringify({
    machines: [{
      name: 'left-behind',
      image: 'node:22',
      labels: { 'ahpd.disposable': 'claude', 'ahpd.git': 'fetch' },
      mounts: ['ahpd-git-left-behind:/workspaces/app/.git'],
    }],
    calls: [],
    answers: [{ when: 'for-each-ref', err: 'fatal: not a git repository', code: 128 }],
  }));

  const lines: string[] = [];
  await load(options(state, {
    profiles: { claude: { title: 'Claude', disposable: true, disposableDelay: 1000 } },
  }), [], (line) => { lines.push(line); });
  await until(() => lines.some((one) => one.includes('left-behind left behind')));
  const refused = (): string[] => lines.filter((one) => one.includes('still here'));

  // The delay runs out, the removal is refused, and the machine is kept - with
  // the git volume holding its work, which the removal would have taken.
  await advanceUntil(() => refused().length >= 1);
  expect(refused().some((one) => one.includes('left-behind'))).toBe(true);
  expect(held(state).machines.map((one) => one.name)).toEqual(['left-behind']);
  expect(held(state).calls.some((one) => one[0] === 'rm')).toBe(false);

  /*
   * And it is watched still. A machine the timer forgot is one that stays for
   * the rest of the daemon's life, so the delay is given again and the removal
   * is tried a second time.
   */
  await advanceUntil(() => refused().length > 1);
  expect(refused().length).toBeGreaterThan(1);
  expect(held(state).machines.map((one) => one.name)).toEqual(['left-behind']);
});

/*
 * Task 05: a session that moves away before its first turn.
 */
it('lets the machine go when the session moves to this host, and makes a new one if it asks again', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const dir = temp();
  const state = join(dir, 'docker.json');
  const folder = join(dir, 'project');
  mkdirSync(folder);

  const { options: loaded } = await load(options(state, {
    profiles: { scratch: { title: 'Scratch', disposable: true, disposableDelay: 1000 } },
  }), [agentWith()]);
  const { client, open } = await room(loaded);
  await open('ahp-session:/one', { computer: 'disposable:scratch' }, folder);
  await until(() => held(state).machines.length === 1);
  const first = held(state).machines[0]?.name as string;
  expect(first).toBeDefined();

  // The person changes their mind before the first turn: this host, no machine.
  await client.handle({
    method: 'dispatchAction',
    params: { channel: 'ahp-session:/one', action: { type: 'session/configChanged', config: { computer: '' } } },
  });
  await wait(200);
  await settle();

  // Nothing is running in it now, so the delay runs and it goes.
  await advanceUntil(() => held(state).machines.length === 0);
  expect(held(state).calls.some((one) => one[0] === 'rm' && one[2] === first)).toBe(true);

  // And asking for the same profile again is a new machine rather than the
  // one it left, whose id the host still remembered.
  await client.handle({
    method: 'dispatchAction',
    params: {
      channel: 'ahp-session:/one',
      action: { type: 'session/configChanged', config: { computer: 'disposable:scratch' } },
    },
  });
  await until(() => held(state).machines.length === 1);
  const second = held(state).machines[0]?.name as string;
  expect(second).toBeDefined();
  expect(second).not.toBe(first);
});

it('lets the machine go when the new value is refused', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const dir = temp();
  const state = join(dir, 'docker.json');
  const folder = join(dir, 'project');
  mkdirSync(folder);

  const { options: loaded } = await load(options(state, {
    profiles: {
      one: { title: 'One', disposable: true, disposableDelay: 1000 },
      two: { title: 'Two', disposable: true },
    },
  }), [agentWith()]);
  const { client, open } = await room(loaded);
  await open('ahp-session:/one', { computer: 'disposable:one' }, folder);
  await until(() => held(state).machines.length === 1);
  const box = held(state).machines[0]?.name as string;
  expect(box).toBeDefined();

  // A session already running in one machine may not switch to another before
  // its first turn, and the refusal is what it is answered with.
  await client.handle({
    method: 'dispatchAction',
    params: { channel: 'ahp-session:/one', action: { type: 'session/configChanged', config: { computer: 'disposable:two' } } },
  });
  await wait(200);
  await settle();
  // No second machine was made: the refusal is about switching, not about the
  // profile being unknown.
  expect(held(state).machines.map((one) => one.name)).toEqual([box]);

  // And the session is over, so the machine it was in waits out the delay and
  // goes rather than holding it for the rest of the daemon's life.
  await advanceUntil(() => held(state).machines.length === 0);
  expect(held(state).calls.some((one) => one[0] === 'rm' && one[2] === box)).toBe(true);
});

/*
 * Task 06: a session resumed from the list counts as a user of its machine.
 */
it('holds the machine while a session resumed from the list runs in it', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const dir = temp();
  const state = join(dir, 'docker.json');
  // What a daemon that stopped left behind: the timers died with it, so the one
  // this host finds at startup is armed with nothing running in it.
  writeFileSync(state, JSON.stringify({
    machines: [{ name: 'left-behind', image: 'node:22', labels: { 'ahpd.disposable': 'claude' } }],
    calls: [],
  }));
  const profiles = { claude: { title: 'Claude', disposable: true, disposableDelay: 1000 } };
  /*
   * One backend and one session store across both hosts, which is what a
   * restart over the same folder is: the catalogue and what was kept about
   * each row survive it, and the running sessions do not.
   */
  const agent = agentWith();
  const store = memorySessions();
  // Named by the provider, which is what a later host calls it once the
  // catalogue has said whose session it is.
  const session = 'echo:/one';
  const chat = `ahp-chat://default/${Buffer.from(session, 'utf8').toString('base64url')}`;

  const { options: first } = await load(options(state, { profiles }), [agent], () => {}, { sessions: store });
  const before = await room(first);
  await before.open(session, { computer: 'computer://left-behind' });
  // A turn, so the backend's own catalogue holds the session with something in
  // it - which is what lets a later host resume it rather than refuse it.
  await before.client.handle({ method: 'subscribe', params: { channel: chat } });
  await before.client.handle({
    method: 'dispatchAction',
    params: { channel: chat, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'first' } } },
  });
  await until(() => actions(before.peer, chat).some((one) => one.type === 'chat/turnComplete'));

  // The daemon restarts. The machine is found again and armed, and nothing has
  // told this host yet that anybody is in it.
  const lines: string[] = [];
  const { options: second } = await load(options(state, { profiles }), [agent], (line) => { lines.push(line); }, { sessions: store });
  const after = await room(second);
  await until(() => lines.some((one) => one.includes('found the disposable machine left-behind')));

  // The session is resumed from the list, in the machine it was running in.
  await after.client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } });
  await after.client.handle({ method: 'subscribe', params: { channel: chat } });
  await after.client.handle({
    method: 'dispatchAction',
    params: { channel: chat, action: { type: 'chat/turnStarted', turnId: 't2', message: { text: 'again' } } },
  });
  await wait(200);
  await settle();
  // Waited for rather than slept past: the turn cannot have run before the
  // backend was started, and a backend is started before it says it entered.
  await until(() => actions(after.peer, chat).some((one) => one.type === 'chat/turnComplete'));

  // So the delay passes and the machine is still there. It used to be removed
  // about five minutes into the run it was holding. The wait is real, so a
  // removal that was going to happen has landed in the record before it is
  // looked for.
  await vi.advanceTimersByTimeAsync(10000);
  await wait(300);
  expect(held(state).calls.some((one) => one[0] === 'rm')).toBe(false);
  expect(held(state).machines.map((one) => one.name)).toEqual(['left-behind']);

  // And disposing it really is the end of it.
  await after.dispose(session);
  await settle();
  await advanceUntil(() => held(state).machines.length === 0);
  expect(held(state).calls.some((one) => one[0] === 'rm')).toBe(true);
});

/*
 * Task 07: a daemon adopts only the leftovers whose session it keeps.
 */
it('keeps a session\'s machine across a restart, and lets it go when the session is disposed', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const dir = temp();
  const state = join(dir, 'docker.json');
  const folder = join(dir, 'project');
  mkdirSync(folder);
  const profiles = { scratch: { title: 'Scratch', disposable: true, disposableDelay: 1000 } };

  const agent = agentWith();
  const store = memorySessions();
  const { options: first } = await load(options(state, { profiles }), [agent], () => {}, { sessions: store });
  const before = await room(first);
  await before.open('echo:/one', { computer: 'disposable:scratch' }, folder);
  await until(() => held(state).machines.length === 1);
  const box = held(state).machines[0]?.name as string;
  expect(box).toBeDefined();
  // The session it was made for, as the machine itself says it.
  expect(held(state).machines[0]?.labels?.['ahpd.session']).toBe('echo:/one');

  /*
   * The config a client sends on its first turn, which is where the store
   * learns this session exists and which machine it is running in. A daemon
   * that kept nothing about a session cannot adopt the machine made for it.
   */
  await before.client.handle({
    method: 'dispatchAction',
    params: {
      channel: 'echo:/one',
      action: { type: 'session/configChanged', config: { computer: 'disposable:scratch' } },
    },
  });
  await until(() => store.config('one')?.computer !== undefined);

  // The daemon restarts, over the same Docker and the same store.
  const lines: string[] = [];
  const { options: second } = await load(options(state, { profiles }), [agent], (line) => { lines.push(line); }, { sessions: store });
  await room(second);
  await until(() => lines.some((one) => one.includes('found the disposable machine')));
  // Adopted rather than armed: the session it was made for is one this daemon
  // keeps, and nothing has to be running in it for that to be true.
  expect(lines.some((one) => one.includes('is held for echo:/one'))).toBe(true);

  // So the delay passes and the machine is still there, held by a session
  // nobody resumed. It used to be removed about five minutes into the run.
  await vi.advanceTimersByTimeAsync(10000);
  await wait(300);
  expect(held(state).calls.some((one) => one[0] === 'rm')).toBe(false);
  expect(held(state).machines.map((one) => one.name)).toEqual([box]);

  // And the session going away is what lets it go.
  await before.dispose('echo:/one');
  await settle();
  await advanceUntil(() => held(state).machines.length === 0);
  expect(held(state).calls.some((one) => one[0] === 'rm' && one[2] === box)).toBe(true);
});

it('leaves alone a leftover whose session this daemon does not keep', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const dir = temp();
  const state = join(dir, 'docker.json');
  // Another daemon's machine, up and running, with the session it was made for
  // on its label. This daemon keeps no sessions at all.
  writeFileSync(state, JSON.stringify({
    machines: [{
      name: 'theirs',
      image: 'node:22',
      labels: { 'ahpd.disposable': 'claude', 'ahpd.session': 'echo:/theirs' },
    }],
    calls: [],
  }));

  const lines: string[] = [];
  await load(options(state, {
    profiles: { claude: { title: 'Claude', disposable: true, disposableDelay: 1000 } },
  }), [], (line) => { lines.push(line); });

  await until(() => lines.some((one) => one.includes('left the disposable machine theirs alone')));
  // Said instead of the line a machine this daemon's own gets, which is what a
  // person reading the log needs to tell the two apart.
  expect(lines.some((one) => one.includes('found the disposable machine theirs'))).toBe(false);

  await vi.advanceTimersByTimeAsync(10000);
  await wait(300);
  expect(held(state).calls.some((one) => one[0] === 'rm')).toBe(false);
  expect(held(state).machines.map((one) => one.name)).toEqual(['theirs']);
});

it('labels a machine with the daemon that made it', async () => {
  const dir = temp();
  const state = join(dir, 'docker.json');
  const folder = join(dir, 'project');
  mkdirSync(folder);

  const { options: loaded } = await load(options(state, {
    profiles: { scratch: { title: 'Scratch', disposable: true } },
  }), [agentWith()], () => {}, {}, 'daemon-here');
  const { open } = await room(loaded);
  await open('echo:/one', { computer: 'disposable:scratch' }, folder);
  await until(() => held(state).machines.length === 1);

  // Beside the session, which is not enough on its own: the session id is the
  // client's to choose, so the machine has to say whose it is.
  expect(held(state).machines[0]?.labels).toMatchObject({
    'ahpd.session': 'echo:/one',
    'ahpd.host': 'daemon-here',
  });
});

it('leaves alone a leftover another daemon made, for a session this one keeps', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const dir = temp();
  const state = join(dir, 'docker.json');
  // Another daemon's machine, up, with this daemon's own session on its label.
  // The session is kept here and has the same id the other daemon kept it
  // under, because the two daemons keep sessions on one store's terms.
  writeFileSync(state, JSON.stringify({
    machines: [{
      name: 'theirs',
      image: 'node:22',
      labels: { 'ahpd.disposable': 'claude', 'ahpd.session': 'echo:/one', 'ahpd.host': 'daemon-there' },
    }],
    calls: [],
  }));

  const store = memorySessions();
  store.setProvider('one', 'echo');
  store.setConfig('one', { computer: 'computer://theirs' });

  const lines: string[] = [];
  await load(
    options(state, { profiles: { claude: { title: 'Claude', disposable: true, disposableDelay: 1000 } } }),
    [],
    (line) => { lines.push(line); },
    { sessions: store },
    'daemon-here',
  );

  await until(() => lines.some((one) => one.includes('theirs')));
  // Said as the other daemon's, which is what it is, rather than as a session
  // this daemon does not keep - it keeps that one. Adopting it would find it
  // instead, and a machine of this daemon's found at startup is one it is now
  // watching.
  expect(lines.some((one) => one.includes('left the disposable machine theirs alone'))).toBe(true);
  expect(lines.some((one) => one.includes('it is another daemon\'s machine'))).toBe(true);
  expect(lines.some((one) => one.includes('found the disposable machine theirs'))).toBe(false);

  await vi.advanceTimersByTimeAsync(10000);
  await wait(300);
  expect(held(state).calls.some((one) => one[0] === 'rm')).toBe(false);
  expect(held(state).machines.map((one) => one.name)).toEqual(['theirs']);
});

it('refuses an alone machine another daemon made, and says whose one of its own was made for', async () => {
  const dir = temp();
  const state = join(dir, 'docker.json');
  const alone = { 'ahpd.disposable': 'claude', 'ahpd.disposable.alone': 'true', 'ahpd.session': 'echo:/one', 'ahpd.owner': 'user:ana' };
  writeFileSync(state, JSON.stringify({
    machines: [
      { name: 'theirs', image: 'node:22', labels: { ...alone, 'ahpd.host': 'daemon-there' } },
      { name: 'ours', image: 'node:22', labels: { ...alone, 'ahpd.host': 'daemon-here' } },
    ],
    calls: [],
  }));

  const { options: loaded } = await load(options(state, {
    profiles: { claude: { title: 'Claude', disposable: true, disposableAlone: true } },
  }), [agentWith()], () => {}, {}, 'daemon-here');
  const port = loaded.computers;
  if (port === undefined) throw new Error('the computer plugin registered no port');

  /*
   * Said rather than said nothing: a machine another daemon made is still
   * alone for its own session, and answering nothing would let any session run
   * in a machine built for one and charged to somebody else.
   */
  expect(await port.keptFor?.('theirs')).toEqual({ session: 'echo:/one', mine: false });
  // And one of this daemon's says whose it was made for, which is the half a
  // client cannot choose for itself: the channel is the client's.
  expect(await port.keptFor?.('ours')).toEqual({ session: 'echo:/one', owner: 'user:ana' });
});

it('lets an adopted machine go when its session is pruned from the store', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const dir = temp();
  const state = join(dir, 'docker.json');
  const folder = join(dir, 'project');
  mkdirSync(folder);
  writeFileSync(state, JSON.stringify({
    machines: [{
      name: 'left-behind',
      image: 'node:22',
      labels: { 'ahpd.disposable': 'claude', 'ahpd.session': 'echo:/one' },
    }],
    calls: [],
  }));

  /*
   * What a daemon before this one kept about a session: which harness ran it,
   * and the machine it was running in.
   */
  const store = memorySessions();
  store.setProvider('one', 'echo');
  store.setConfig('one', { computer: 'computer://left-behind' });

  /*
   * The catalogue a listing reads, which the test takes away when the
   * transcript it names is deleted outside this host.
   */
  const rows = [{
    id: 'one',
    title: 'Echo session',
    createdAt: '2026-10-03T12:00:00.000Z',
    modifiedAt: '2026-10-03T12:00:00.000Z',
    workingDirectories: [`file://${folder}`],
  }];
  const agent: Agent = {
    ...echo({ path: folder, pace: 0 }),
    // Serving the folder this session ran in, which is what makes a listing
    // speak for it: one opened elsewhere is kept rather than called gone.
    list: async () => [...rows],
  };

  const lines: string[] = [];
  const { options: loaded } = await load(
    options(state, { profiles: { claude: { title: 'Claude', disposable: true, disposableDelay: 1000 } } }),
    [agent],
    (line) => { lines.push(line); },
    { sessions: store, path: folder },
  );
  const here = await room(loaded);
  await until(() => lines.some((one) => one.includes('is held for echo:/one')));

  // Listed once, so this host knows what the session was and where it ran.
  await here.client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } });
  await until(() => store.config('one') !== undefined);

  // The session is kept and nobody is running in the machine, which is what the
  // adoption is for: the delay passes over it untouched.
  await vi.advanceTimersByTimeAsync(1000);
  await wait(300);
  expect(held(state).calls.some((one) => one[0] === 'rm')).toBe(false);
  expect(held(state).machines.map((one) => one.name)).toEqual(['left-behind']);

  // The transcript is gone, so the next listing does not find it: a row no
  // backend offers any more is a row this host forgets.
  rows.length = 0;
  await here.client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } });
  await until(() => store.config('one') === undefined);

  // Which is the session leaving the machine that was adopted for it, and so
  // the only thing left that could start the delay.
  await advanceUntil(() => held(state).machines.length === 0);
  expect(held(state).calls.some((one) => one[0] === 'rm' && one[2] === 'left-behind')).toBe(true);
});

it('adopts its own leftover whatever else is still loading', async () => {
  const dir = temp();
  const state = join(dir, 'docker.json');
  writeFileSync(state, JSON.stringify({
    machines: [{
      name: 'left-behind',
      image: 'node:22',
      labels: { 'ahpd.disposable': 'claude', 'ahpd.session': 'echo:/one' },
    }],
    calls: [],
  }));

  // What a daemon before this one kept about the session its machine was made
  // for, so adoption has something true to find.
  const store = memorySessions();
  store.setProvider('one', 'echo');
  store.setConfig('one', { computer: 'computer://left-behind' });

  const lines: string[] = [];
  /*
   * The computer plugin first and a slow one after it, so the adoption runs
   * while this daemon has still not named its store: the fold that names it
   * happens after every plugin has applied. A plugin order that let the slow
   * one decide would leave the machine alone instead of holding it, which is
   * the same daemon removing its own leftover later.
   */
  const { problems } = await loadPlugins(
    [
      { name: SOURCE, options: options(state, { profiles: { claude: { title: 'Claude', disposable: true } } }) },
      { name: './packages/computer/test/fixtures/slow.mjs' },
    ],
    { base: base([], { sessions: store }), configDir: stateDir(), cwd: REPO, log: (line) => { lines.push(line); } },
  );
  expect(problems).toEqual([]);

  await until(() => lines.some((one) => one.includes('left-behind')), 400);
  expect(lines.some((one) => one.includes('is held for echo:/one'))).toBe(true);
  expect(lines.some((one) => one.includes('left the disposable machine left-behind alone'))).toBe(false);
});

it('ignores a leave for a session the machine does not hold', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const dir = temp();
  const state = join(dir, 'docker.json');
  writeFileSync(state, JSON.stringify({
    // No session in it: nobody is counting, so the machine is on its delay.
    machines: [{
      name: 'left-behind',
      image: 'node:22',
      labels: { 'ahpd.disposable': 'claude' },
    }],
    calls: [],
  }));

  const lines: string[] = [];
  const { options: loaded } = await load(
    options(state, { profiles: { claude: { title: 'Claude', disposable: true, disposableDelay: 1000 } } }),
    [],
    (line) => { lines.push(line); },
  );
  await until(() => lines.some((one) => one.includes('left-behind left behind; it goes 1000ms from now')), 400);

  /*
   * A session this machine never had, which is what a signal from another
   * daemon or a second one of the same looks like. Nothing is counting it, and
   * a leave nobody was counting must not put the machine's last minute back to
   * where it was: the timer is not restarted, so the machine still goes at the
   * 1000ms the listing gave it rather than 1000ms after this.
   */
  await vi.advanceTimersByTimeAsync(600);
  await loaded.computers?.leave?.('left-behind', 'echo:/other');
  await settle();
  await vi.advanceTimersByTimeAsync(600);
  // The removal is a subprocess, so it lands on real time whatever the clock
  // says: waited for rather than slept past, which is what makes this hold
  // when the whole suite is running beside it.
  await until(() => held(state).machines.length === 0, 400);
  expect(held(state).machines.map((one) => one.name)).toEqual([]);
});

/*
 * Task 08: an alone machine is kept for the one session it was made for.
 */
it('refuses another session the machine an alone profile made, and takes its own back', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const dir = temp();
  const state = join(dir, 'docker.json');
  const folder = join(dir, 'project');
  mkdirSync(folder);

  const { options: loaded } = await load(options(state, {
    profiles: {
      alone: { title: 'Alone', disposable: true, disposableAlone: true },
      shared: { title: 'Shared', disposable: true },
    },
  }), [agentWith()]);
  const { client, open } = await room(loaded);
  await open('echo:/one', { computer: 'disposable:alone' }, folder);
  await until(() => held(state).machines.length === 1);
  const box = held(state).machines[0]?.name as string;
  expect(box).toBeDefined();
  expect(held(state).machines[0]?.labels).toMatchObject({
    'ahpd.disposable.alone': 'true',
    'ahpd.session': 'echo:/one',
  });

  /*
   * The picker keeps the machine out of a second session's list, and a client
   * that read an older one, or a person who typed the id, is refused at its own
   * creation. Neither session is named in the sentence: what it says is that
   * the machine is not this one's.
   */
  await expect(client.handle({
    method: 'createSession',
    params: {
      channel: 'ahp-session:/two',
      provider: 'echo',
      config: { computer: `computer://${box}` },
      workingDirectories: [folder],
    },
  })).rejects.toThrow(`computer://${box} belongs to another session`);

  /*
   * And its own session sends its whole config bag on the first turn, still
   * naming the source it picked rather than the machine that came back. The
   * two are the same choice, so it is taken back rather than refused for
   * belonging to another session.
   */
  await client.handle({
    method: 'dispatchAction',
    params: {
      channel: 'echo:/one',
      action: { type: 'session/configChanged', config: { computer: 'disposable:alone' } },
    },
  });
  await wait(200);
  await settle();
  expect(held(state).machines.map((one) => one.name)).toEqual([box]);
  expect(held(state).calls.some((one) => one[0] === 'rm')).toBe(false);
});

it('refuses another session only for a machine that is alone', async () => {
  const dir = temp();
  const state = join(dir, 'docker.json');
  const folder = join(dir, 'project');
  mkdirSync(folder);

  const { options: loaded } = await load(options(state, {
    profiles: { shared: { title: 'Shared', disposable: true } },
  }), [agentWith()]);
  const { client, open } = await room(loaded);
  await open('echo:/one', { computer: 'disposable:shared' }, folder);
  await until(() => held(state).machines.length === 1);
  const box = held(state).machines[0]?.name as string;
  expect(box).toBeDefined();

  // A machine nothing says is alone is a machine any session may enter, which
  // is what picking the profile by hand means.
  await client.handle({
    method: 'createSession',
    params: {
      channel: 'ahp-session:/two',
      provider: 'echo',
      config: { computer: `computer://${box}` },
      workingDirectories: [folder],
    },
  });
  await until(() => held(state).machines.length === 1);
});

it('takes the session an alone machine was made for back into it after a restart', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const dir = temp();
  const state = join(dir, 'docker.json');
  const folder = join(dir, 'project');
  mkdirSync(folder);
  writeFileSync(state, JSON.stringify({
    machines: [{
      name: 'alone',
      image: 'node:22',
      labels: {
        'ahpd.disposable': 'alone',
        'ahpd.disposable.alone': 'true',
        'ahpd.session': 'echo:/one',
      },
    }],
    calls: [],
  }));
  const profiles = { alone: { title: 'Alone', disposable: true, disposableAlone: true, disposableDelay: 1000 } };
  const at = new Date('2026-10-03T12:00:00.000Z');
  const rows = [{
    id: 'one',
    title: 'Echo session',
    createdAt: at.toISOString(),
    modifiedAt: at.toISOString(),
    workingDirectories: [`file://${folder}`],
  }];
  const agent: Agent = {
    ...echo({ path: folder, pace: 0 }),
    list: async () => [...rows],
    // A row with a transcript behind it is one a client can open, which is
    // what the resume below needs before it sends anything.
    transcript: async () => [],
  };

  const store = memorySessions();
  store.setProvider('one', 'echo');
  store.setConfig('one', { computer: 'computer://alone' });

  const lines: string[] = [];
  const { options: loaded } = await load(options(state, { profiles }), [agent], (line) => { lines.push(line); }, { sessions: store, path: folder });
  const here = await room(loaded);
  await until(() => lines.some((one) => one.includes('is held for echo:/one')));

  // The session resumed from the list is the one the machine was made for, so
  // the refusal the port carries has nothing to say to it.
  const chat = `ahp-chat://default/${Buffer.from('echo:/one', 'utf8').toString('base64url')}`;
  await here.client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } });
  await here.client.handle({ method: 'subscribe', params: { channel: chat } });
  await here.client.handle({
    method: 'dispatchAction',
    params: { channel: chat, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'again' } } },
  });
  await until(() => actions(here.peer, chat).some((one) => one.type === 'chat/turnComplete'));

  await vi.advanceTimersByTimeAsync(10000);
  await wait(300);
  expect(held(state).calls.some((one) => one[0] === 'rm')).toBe(false);
  expect(held(state).machines.map((one) => one.name)).toEqual(['alone']);
});

/*
 * Task 09: a machine made for a session is counted like any other.
 */
it('counts a machine made for a session against max, and refuses the next one', async () => {
  const dir = temp();
  const state = join(dir, 'docker.json');
  const folder = join(dir, 'project');
  mkdirSync(folder);

  const { options: loaded } = await load(options(state, {
    max: 1,
    profiles: { claude: { title: 'Claude', disposable: true } },
  }), [agentWith()]);
  const { open } = await room(loaded);
  await open('ahp-session:/one', { computer: 'disposable:claude' }, folder);
  await until(() => held(state).machines.length === 1);

  // The host is full, so the second session is refused the sentence a write to
  // `computer://<name>` is refused with - decision
  // `a-machine-made-for-a-session-counts-against-max-and-needs-computer-write`.
  await expect(open('ahp-session:/two', { computer: 'disposable:claude' }, folder))
    .rejects.toThrow(/This host holds 1 computers already/);
  await settle();
  expect(held(state).machines).toHaveLength(1);
});

/*
 * The count and the create it allows are one thing, so a machine being made is
 * one of the machines this host holds.
 */
it('counts a machine being made against max, so two sessions at once make one', async () => {
  const dir = temp();
  const state = join(dir, 'docker.json');
  const folder = join(dir, 'project');
  mkdirSync(folder);

  const { options: loaded } = await load(options(state, {
    max: 1,
    profiles: { claude: { title: 'Claude', disposable: true } },
  }), [agentWith()]);
  const { open } = await room(loaded);

  // Two sessions naming a source in the same breath, which count the machines
  // this host holds before either of them is made.
  const asked = await Promise.allSettled([
    open('ahp-session:/one', { computer: 'disposable:claude' }, folder),
    open('ahp-session:/two', { computer: 'disposable:claude' }, folder),
  ]);
  const refused = asked.filter((one) => one.status === 'rejected');
  expect(refused).toHaveLength(1);
  expect(String((refused[0] as PromiseRejectedResult).reason)).toMatch(/This host holds 1 computers already/);
  await settle();
  expect(held(state).machines).toHaveLength(1);
});

/*
 * Task 10: the session's folder is the profile's to allow.
 */
it('leaves the folder of a session out of a machine whose profile did not ask for it', async () => {
  const dir = temp();
  const state = join(dir, 'docker.json');
  const folder = join(dir, 'project');
  mkdirSync(folder);

  const { options: loaded } = await load(options(state, {
    profiles: { claude: { title: 'Claude', image: 'node:22', disposable: true, workdir: '/ahpd' } },
  }), [agentWith()]);
  const { open } = await room(loaded);
  await open('ahp-session:/one', { computer: 'disposable:claude' }, folder);

  // Nothing of the session's folder is in the machine, and the session starts
  // where the profile said rather than in a folder it cannot see - decision
  // `a-session-folder-reaches-a-machine-only-where-its-profile-allows`.
  const box = held(state).machines[0] as NonNullable<Held['machines'][number]>;
  expect(box.mounts ?? []).toEqual([]);
  expect(box.workdir).toBe('/ahpd');
});

it('mounts the session\'s folder read-write at the same path where the profile says sessionFolder', async () => {
  const dir = temp();
  const state = join(dir, 'docker.json');
  const folder = join(dir, 'project');
  mkdirSync(folder);

  const { options: loaded } = await load(options(state, {
    profiles: { claude: { title: 'Claude', image: 'node:22', disposable: true, sessionFolder: true, workdir: '/ahpd' } },
  }), [agentWith()]);
  const { open } = await room(loaded);
  await open('ahp-session:/one', { computer: 'disposable:claude' }, folder);

  // One `-v`, the same path on both sides and no `:ro`, so a harness keys its
  // own record the same inside and out.
  const box = held(state).machines[0] as NonNullable<Held['machines'][number]>;
  expect(box.mounts).toEqual([`${folder}:${folder}`]);
  // The profile's own `workdir` is the operator's, and the folder does not
  // take it.
  expect(box.workdir).toBe('/ahpd');
});

/*
 * Task 04: the docs' own example.
 *
 * The object below is the `profiles` half of the example in `docs/COMPUTER.md`,
 * kept in step by hand, with its one host path pointed at a directory this host
 * has: an example that does not load is worse than none.
 */
it('loads the disposable example from docs/COMPUTER.md', async () => {
  const dir = temp();
  const state = join(dir, 'docker.json');
  const claudeHome = join(dir, 'claude-home');
  const folder = join(dir, 'project');
  mkdirSync(claudeHome);
  mkdirSync(folder);
  const docs = {
    profiles: {
      scratch: {
        title: 'Scratch',
        description: 'A machine of this session\'s own, with the CLI shared in.',
        image: 'node:22',
        needs: { claudeConfigDirectory: claudeHome },
        disposable: true,
        disposableDelay: 300000,
        disposableAlone: true,
        sessionFolder: true,
      },
    },
  };
  const { options: loaded, problems } = await load(options(state, docs), [
    agentWith({ claudeConfigDirectory: { directory: '~/.claude', target: '/ahpd/claude', required: true } }),
  ]);
  expect(problems).toEqual([]);

  const answerer = loaded.sessionConfigCompletions?.computer as NonNullable<typeof loaded.sessionConfigCompletions>['computer'];
  const all = await answerer({ property: 'computer', query: '' });
  expect(all.find((one) => one.value === 'disposable:scratch')).toMatchObject({ label: 'Scratch' });

  // And the machine it makes for the harness the session runs: the profile's
  // own value of the need, at the target that need declares. It used to mount
  // `/srv/claude-home:/ahpd/claude` beside that same target, which is two
  // mounts at one target and is refused.
  const { open } = await room(loaded);
  await open('ahp-session:/one', { computer: 'disposable:scratch' }, folder);
  const box = held(state).machines[0];
  expect(box?.mounts).toEqual([`${claudeHome}:/ahpd/claude`, `${folder}:${folder}`]);
  expect(box?.labels).toMatchObject({ 'ahpd.agents': 'echo', 'ahpd.disposable': 'scratch' });
});

/*
 * container/05 p7: a worktree reaches its machine with its repository.
 */

/** A real repository with one commit and two linked worktrees, every path resolved. */
const repositoryIn = (dir: string) => {
  const repo = join(dir, 'repo');
  mkdirSync(repo);
  const run = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' });
  run('init', '-q', '-b', 'main');
  run('config', 'user.email', 'test@example.com');
  run('config', 'user.name', 'Test');
  mkdirSync(join(repo, 'src'));
  writeFileSync(join(repo, 'src', 'tracked.txt'), 'tracked\n');
  run('add', '-A');
  run('commit', '-q', '-m', 'first');
  const tree = join(dir, 'tree');
  const other = join(dir, 'other');
  run('worktree', 'add', '-q', '-b', 'work', tree);
  run('worktree', 'add', '-q', '-b', 'elsewhere', other);
  const gitDir = join(repo, '.git');
  return { repo, tree, other, gitDir, entry: join(gitDir, 'worktrees', 'tree') };
};

/** A repository at `at`, with one commit, every path resolved. */
const repositoryUnder = (at: string) => {
  mkdirSync(at, { recursive: true });
  const run = (...args: string[]) => execFileSync('git', ['-C', at, ...args], { stdio: 'pipe' });
  run('init', '-q', '-b', 'main');
  run('config', 'user.email', 'test@example.com');
  run('config', 'user.name', 'Test');
  writeFileSync(join(at, 'tracked.txt'), 'tracked\n');
  run('add', '-A');
  run('commit', '-q', '-m', 'first');
  return { repo: at, gitDir: join(at, '.git') };
};

/** A second repository beside it, for a `.git` that names somebody else's. */
const elsewhereIn = (dir: string) => {
  const repo = join(dir, 'elsewhere');
  mkdirSync(repo);
  const run = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' });
  run('init', '-q', '-b', 'main');
  run('config', 'user.email', 'test@example.com');
  run('config', 'user.name', 'Test');
  writeFileSync(join(repo, 'tracked.txt'), 'tracked\n');
  run('add', '-A');
  run('commit', '-q', '-m', 'first');
  return { repo, gitDir: join(repo, '.git') };
};

const ME = `${String(process.getuid?.())}:${String(process.getgid?.())}`;

/**
 * A host with the git port and one disposable profile that brings the session's
 * folder in.
 *
 * `lines`, where given, collects the plugin's own log - the daemon's log, which
 * is where the profile's gate on the repository says what it left out.
 *
 * The daemon's own directory is the test's temporary one, which is where the
 * gitfile a linked worktree's machine needs is written.
 */
const withRepository = async (
  state: string,
  profile: Record<string, unknown> = {},
  more: Partial<HostOptions> = {},
  lines?: string[],
) => (await load(options(state, {
  profiles: { claude: { title: 'Claude', image: 'node:22', disposable: true, sessionFolder: true, disposableDelay: 1000, ...profile } },
}), [agentWith()], lines === undefined ? () => {} : (line) => { lines.push(line); }, { worktrees: gitWorktrees(), ...more }, undefined, dirname(state))).options;

const flagValue = (argv: readonly string[], flag: string): string | undefined => {
  const at = argv.indexOf(flag);
  return at === -1 ? undefined : argv[at + 1];
};

it('gives a worktree session a git directory of its own, and runs the machine as the host user', async () => {
  const dir = realpathSync(temp());
  const state = join(dir, 'docker.json');
  const { tree, gitDir } = repositoryIn(dir);

  const loaded = await withRepository(state);
  const { open } = await room(loaded);
  await open('ahp-session:/one', { computer: 'disposable:claude' }, tree);

  const box = held(state).machines[0] as NonNullable<Held['machines'][number]>;
  // The tree, the one path of the host's git directory a machine reads, and the
  // file this host wrote standing in for a `.git` a volume cannot be mounted
  // over - decision
  // `a-machine-commits-in-its-own-repository-and-the-host-fetches-it`.
  expect(box.mounts?.slice(0, 3)).toEqual([
    `${tree}:${tree}`,
    `${gitDir}/objects:${MACHINE_OBJECTS}:ro`,
    `${join(dir, 'computers.gitfile')}:${tree}/.git:ro`,
  ]);
  // And the machine's own git directory, a volume of its own, at the path the
  // file this host wrote names.
  expect(box.mounts?.at(-1)).toBe(`ahpd-git-${box.name}:/opt/ahpd/git`);
  expect(box.labels?.['ahpd.git']).toBe('fetch');
  const made = held(state).calls.find((one) => one[0] === 'run') ?? [];
  expect(flagValue(made, '--user')).toBe(ME);
  expect(box.labels?.['ahpd.user']).toBe(ME);

  // Every command into it, by a backend and by the tool, as the same user.
  const how = await loaded.computers?.how(box.name, { command: 'true' });
  expect(flagValue(how?.args ?? [], '--user')).toBe(ME);
  const tool = (loaded.tools ?? []).find((one) => one.definition.name === 'computer_exec');
  await tool?.run({ id: box.name, command: 'true' }, {} as never);
  expect((held(state) as Held & { commands?: { user?: string }[] }).commands?.at(-1)?.user).toBe(ME);

  // And after the plugin is loaded again, from the machine's own label.
  const again = await withRepository(state);
  const later = await again.computers?.how(box.name, { command: 'true' });
  expect(flagValue(later?.args ?? [], '--user')).toBe(ME);
});

it('keeps the image\'s user for a machine with no git directory', async () => {
  const dir = realpathSync(temp());
  const state = join(dir, 'docker.json');
  const folder = join(dir, 'plain');
  mkdirSync(folder);

  const loaded = await withRepository(state);
  const { open } = await room(loaded);
  await open('ahp-session:/one', { computer: 'disposable:claude' }, folder);

  const box = held(state).machines[0] as NonNullable<Held['machines'][number]>;
  expect(box.mounts).toEqual([`${folder}:${folder}`]);
  expect(held(state).calls.find((one) => one[0] === 'run')).not.toContain('--user');
  expect(box.labels?.['ahpd.user']).toBeUndefined();
  const how = await loaded.computers?.how(box.name, { command: 'true' });
  expect(how?.args).not.toContain('--user');
});

it('mounts the repository root for a session in a subfolder, and starts it in the subfolder', async () => {
  const dir = realpathSync(temp());
  const state = join(dir, 'docker.json');
  const { repo, gitDir } = repositoryIn(dir);
  const below = join(repo, 'src');

  // The profile says `sessionRepository` as well, which is what lets the root
  // the folder sits below reach the machine.
  const loaded = await withRepository(state, { sessionRepository: true });
  const { open } = await room(loaded);
  await open('ahp-session:/one', { computer: 'disposable:claude' }, below);

  const box = held(state).machines[0] as NonNullable<Held['machines'][number]>;
  // The root brings the git directory, and the host's objects come with it
  // read-only, with the machine's own git directory a volume landed over the
  // tree's `.git` - a main checkout's is a directory, so a volume mounts there.
  expect(box.mounts?.slice(0, 2)).toEqual([`${repo}:${repo}`, `${gitDir}/objects:${MACHINE_OBJECTS}:ro`]);
  expect(box.mounts?.at(-1)).toBe(`ahpd-git-${box.name}:${gitDir}`);
  expect(box.mounts).not.toContain(`${below}:${below}`);
  expect(box.workdir).toBe(below);
});

it('mounts the folder alone, with no git directory, where the profile does not say sessionRepository', async () => {
  const dir = realpathSync(temp());
  const state = join(dir, 'docker.json');
  const { repo, gitDir } = repositoryUnder(join(dir, 'home'));
  const scratch = join(repo, 'scratch');
  mkdirSync(scratch);

  const lines: string[] = [];
  const loaded = await withRepository(state, {}, {}, lines);
  const { open } = await room(loaded);
  await open('ahp-session:/one', { computer: 'disposable:claude' }, scratch);

  // The folder the session works in reaches the machine - the profile said
  // `sessionFolder` - and the repository it sits inside does not: the host's
  // whole home is not the client's folder, so it is the profile saying
  // `sessionRepository` that brings it, and without that there is no git
  // directory either, since the one beside the root is not under the folder
  // - decision `a-session-folder-reaches-a-machine-only-where-its-profile-allows`.
  const box = held(state).machines[0] as NonNullable<Held['machines'][number]>;
  expect(box.mounts).toEqual([`${scratch}:${scratch}`]);
  expect(box.mounts).not.toContain(`${repo}:${repo}`);
  expect((box.mounts ?? []).some((one) => one.includes(gitDir))).toBe(false);
  expect(held(state).calls.find((one) => one[0] === 'run')).not.toContain('--user');
  expect(box.labels?.['ahpd.user']).toBeUndefined();
  // And the line says what the profile does not allow.
  expect(lines.filter((line) => line.includes(repo) && line.includes('sessionRepository'))).toHaveLength(1);
});

it('mounts the repository root where the profile says sessionRepository as well', async () => {
  const dir = realpathSync(temp());
  const state = join(dir, 'docker.json');
  const { repo, gitDir } = repositoryUnder(join(dir, 'home'));
  const scratch = join(repo, 'scratch');
  mkdirSync(scratch);

  const lines: string[] = [];
  const loaded = await withRepository(state, { sessionRepository: true }, {}, lines);
  const { open } = await room(loaded);
  await open('ahp-session:/one', { computer: 'disposable:claude' }, scratch);

  const box = held(state).machines[0] as NonNullable<Held['machines'][number]>;
  expect(box.mounts?.slice(0, 2)).toEqual([`${repo}:${repo}`, `${gitDir}/objects:${MACHINE_OBJECTS}:ro`]);
  expect(box.mounts?.at(-1)).toBe(`ahpd-git-${box.name}:${gitDir}`);
  expect(box.mounts).not.toContain(`${scratch}:${scratch}`);
  expect(box.workdir).toBe(scratch);
  // Nothing was left out, so nothing says it was.
  expect(lines.filter((line) => line.includes('sessionRepository'))).toEqual([]);
});

/*
 * Plan host/70 task 03: the clash check folds in the path the runtime mounts.
 *
 * A session in a subfolder is given the root of the repository it sits in
 * rather than its own folder, so a profile mounting a directory at that root is
 * two mounts at one path: the manifest refuses it, which is the sentence a
 * person reads instead of the runtime's duplicate mount point. A mount at the
 * subfolder is not one - the runtime mounts no such path - and under `copy` the
 * tree the machine works in is its own, so nothing of the folder's is mounted
 * and nothing of it is folded in.
 */
it('refuses a profile mount at the repository of a session in a subfolder', async () => {
  const dir = realpathSync(temp());
  const state = join(dir, 'docker.json');
  const { repo } = repositoryIn(dir);
  const below = join(repo, 'src');
  const shared = join(dir, 'shared');
  mkdirSync(shared);

  const loaded = await withRepository(state, { sessionRepository: true, mounts: [`${shared}:${repo}`] });
  const { open } = await room(loaded);
  await expect(open('ahp-session:/one', { computer: 'disposable:claude' }, below))
    .rejects.toThrow(`the profile's mount ${shared}:${repo} and the session's repository ${repo} both land at ${repo}`);
  expect(held(state).machines).toEqual([]);
});

it('accepts a profile mount at the subfolder, which the runtime does not mount', async () => {
  const dir = realpathSync(temp());
  const state = join(dir, 'docker.json');
  const { repo } = repositoryIn(dir);
  const below = join(repo, 'src');
  const shared = join(dir, 'shared');
  mkdirSync(shared);

  const loaded = await withRepository(state, { sessionRepository: true, mounts: [`${shared}:${below}`] });
  const { open } = await room(loaded);
  await open('ahp-session:/one', { computer: 'disposable:claude' }, below);

  const box = held(state).machines[0] as NonNullable<Held['machines'][number]>;
  expect(box.mounts).toContain(`${shared}:${below}`);
  // The root, which the runtime mounts in place of the folder, is the only
  // other mount at a path of this host's.
  expect(box.mounts).toContain(`${repo}:${repo}`);
  expect(box.mounts).not.toContain(`${below}:${below}`);
});

it('folds in no folder mount under copy', async () => {
  const dir = realpathSync(temp());
  const state = join(dir, 'docker.json');
  const { repo } = repositoryIn(dir);
  const below = join(repo, 'src');
  const shared = join(dir, 'shared');
  mkdirSync(shared);

  const loaded = await withRepository(state, { sessionRepository: true, sessionTree: 'copy', mounts: [`${shared}:${below}`] });
  const { open } = await room(loaded);
  await open('ahp-session:/one', { computer: 'disposable:claude' }, below);

  const box = held(state).machines[0] as NonNullable<Held['machines'][number]>;
  expect(box.mounts).toContain(`${shared}:${below}`);
  // The tree the machine copies is the repository, and it is the machine's own
  // volume there rather than a bind of this host's folder.
  expect(box.mounts).toContain(`ahpd-git-${box.name}:${repo}`);
  expect(box.mounts).not.toContain(`${repo}:${repo}`);
  expect(box.mounts).not.toContain(`${below}:${below}`);
});

it('brings no git directory into a machine whose profile leaves the session folder out', async () => {
  const dir = realpathSync(temp());
  const state = join(dir, 'docker.json');
  const { tree } = repositoryIn(dir);

  const loaded = await withRepository(state, { sessionFolder: false, workdir: '/ahpd' });
  const { open } = await room(loaded);
  await open('ahp-session:/one', { computer: 'disposable:claude' }, tree);

  const box = held(state).machines[0] as NonNullable<Held['machines'][number]>;
  expect(box.mounts ?? []).toEqual([]);
  expect(held(state).calls.find((one) => one[0] === 'run')).not.toContain('--user');
});

it('mounts only the host\'s objects read-only, and gives the machine a git directory of its own', async () => {
  const dir = realpathSync(temp());
  const state = join(dir, 'docker.json');
  const { tree, gitDir } = repositoryIn(dir);
  const before = readdirSync(gitDir).sort();

  const loaded = await withRepository(state);
  const { open } = await room(loaded);
  await open('ahp-session:/one', { computer: 'disposable:claude' }, tree);

  const box = held(state).machines[0] as NonNullable<Held['machines'][number]>;
  // Everything the machine sees: the tree it works in, the one path of the
  // host's git directory it reads - read-only - the file this host wrote for
  // its `.git`, and a volume of its own for the git directory it commits into.
  expect(box.mounts).toEqual([
    `${tree}:${tree}`,
    `${gitDir}/objects:${MACHINE_OBJECTS}:ro`,
    `${join(dir, 'computers.gitfile')}:${tree}/.git:ro`,
    `ahpd-git-${box.name}:/opt/ahpd/git`,
  ]);
  // The tree is the only writable thing of the host's, and nothing of its git
  // directory is writable anywhere in the machine - the volume is the
  // machine's own, and it is the only thing mounted that the host did not name.
  expect((box.mounts ?? []).filter((one) => !one.endsWith(':ro') && one.includes(dir))).toEqual([`${tree}:${tree}`]);
  // And the host's git directory is what it was: nothing was made in it for a
  // machine that has one of its own, not even `modules/`.
  expect(readdirSync(gitDir).sort()).toEqual(before);
  expect(box.labels?.['ahpd.worktree']).toBeUndefined();
});

it('refuses a data directory of the git directory that is a link, which git never makes', async () => {
  const dir = realpathSync(temp());
  const state = join(dir, 'docker.json');
  const { repo, tree, gitDir } = repositoryIn(dir);
  rmSync(join(gitDir, 'logs'), { recursive: true, force: true });
  mkdirSync(join(repo, 'elsewhere'));
  symlinkSync(join(repo, 'elsewhere'), join(gitDir, 'logs'));

  const loaded = await withRepository(state);
  const { open } = await room(loaded);
  await expect(open('ahp-session:/one', { computer: 'disposable:claude' }, tree))
    .rejects.toThrow(/holds .*logs, a symbolic link to .*elsewhere, which git never makes/);
  expect(held(state).machines).toEqual([]);
});

it('refuses a git directory whose hooks are a link, which git never makes', async () => {
  const dir = realpathSync(temp());
  const state = join(dir, 'docker.json');
  const { repo, tree, gitDir } = repositoryIn(dir);
  rmSync(join(gitDir, 'hooks'), { recursive: true, force: true });
  mkdirSync(join(repo, 'githooks'));
  symlinkSync(join(repo, 'githooks'), join(gitDir, 'hooks'));

  const loaded = await withRepository(state);
  const { open } = await room(loaded);
  await expect(open('ahp-session:/one', { computer: 'disposable:claude' }, tree))
    .rejects.toThrow(/holds .*hooks, a symbolic link to .*githooks, which git never makes/);
  expect(held(state).machines).toEqual([]);
});

/*
 * host/65 p2: a machine is given the folder's own git directory, or none.
 */

it('refuses a folder whose own .git names another repository, and makes nothing in it', async () => {
  const dir = realpathSync(temp());
  const state = join(dir, 'docker.json');
  const { repo } = repositoryIn(dir);
  const { gitDir: elsewhere } = elsewhereIn(dir);
  // The folder's own `.git` names another repository's git directory, and that
  // is what git then answers as this folder's common directory: the machine
  // would be mounted somebody else's history, writable over it.
  const commondir = join(repo, '.git', 'commondir');
  writeFileSync(commondir, `${elsewhere}\n`);
  const before = readdirSync(elsewhere).sort();

  const lines: string[] = [];
  const loaded = await withRepository(state, {}, { onEvent: (line) => lines.push(line) });
  const { open } = await room(loaded);
  await open('ahp-session:/one', { computer: 'disposable:claude' }, repo);

  const box = held(state).machines[0] as NonNullable<Held['machines'][number]>;
  expect(box.mounts).toEqual([`${repo}:${repo}`]);
  expect(held(state).calls.find((one) => one[0] === 'run')).not.toContain('--user');
  // The line names the file that sent it there, and nothing was made in the
  // repository it named.
  expect(lines.filter((line) => line.includes(commondir))).toHaveLength(1);
  expect(readdirSync(elsewhere).sort()).toEqual(before);
});

it('refuses a folder holding only a .git naming another repository, and makes nothing in it', async () => {
  const dir = realpathSync(temp());
  const state = join(dir, 'docker.json');
  const { gitDir: elsewhere } = elsewhereIn(dir);
  const folder = join(dir, 'borrowed');
  mkdirSync(join(folder, '.git'), { recursive: true });
  const commondir = join(folder, '.git', 'commondir');
  writeFileSync(commondir, `${elsewhere}\n`);
  const before = readdirSync(elsewhere).sort();

  const lines: string[] = [];
  const loaded = await withRepository(state, {}, { onEvent: (line) => lines.push(line) });
  const { open } = await room(loaded);
  await open('ahp-session:/one', { computer: 'disposable:claude' }, folder);

  const box = held(state).machines[0] as NonNullable<Held['machines'][number]>;
  expect(box.mounts).toEqual([`${folder}:${folder}`]);
  expect(lines.filter((line) => line.includes(commondir))).toHaveLength(1);
  expect(readdirSync(elsewhere).sort()).toEqual(before);
});

it('writes a gitfile over a worktree session\'s .git, and mounts no path of the host\'s git directory', async () => {
  const dir = realpathSync(temp());
  const state = join(dir, 'docker.json');
  const { tree, gitDir } = repositoryIn(dir);

  const loaded = await withRepository(state);
  const { open } = await room(loaded);
  await open('ahp-session:/one', { computer: 'disposable:claude' }, tree);

  const box = held(state).machines[0] as NonNullable<Held['machines'][number]>;
  // A linked worktree's `.git` is a file, and a volume cannot be mounted over
  // one, so the file this host wrote names where the volume is: one file serves
  // every machine, since what it says is the same for all of them.
  expect(box.mounts?.[2]).toBe(`${join(dir, 'computers.gitfile')}:${tree}/.git:ro`);
  expect(readFileSync(join(dir, 'computers.gitfile'), 'utf8')).toBe('gitdir: /opt/ahpd/git\n');
  // And the host's own git directory is nowhere in the machine but its objects.
  expect((box.mounts ?? []).some((one) => one.startsWith(`${gitDir}:`))).toBe(false);
});

it('makes a main checkout\'s git directory a mount point, with the machine\'s own volume over it', async () => {
  const dir = realpathSync(temp());
  const state = join(dir, 'docker.json');
  const { repo, gitDir } = repositoryIn(dir);
  // A fresh repository has no `packed-refs` until something packs it.
  expect(existsSync(join(gitDir, 'packed-refs'))).toBe(false);

  const loaded = await withRepository(state);
  const { open } = await room(loaded);
  await open('ahp-session:/one', { computer: 'disposable:claude' }, repo);

  /*
   * A main checkout's `.git` is a directory, so the machine's own git directory
   * is a volume landed over it: the path stays a mount point, so `mv .git .old`
   * is refused rather than replacing it, and what is at it in there is the
   * machine's own, empty until the seed fills it, never the host's.
   */
  const box = held(state).machines[0] as NonNullable<Held['machines'][number]>;
  expect(box.mounts).toEqual([
    `${repo}:${repo}`,
    `${gitDir}/objects:${MACHINE_OBJECTS}:ro`,
    `ahpd-git-${box.name}:${gitDir}`,
  ]);
  // Nothing was pinned on the host and nothing was made in its git directory.
  expect(existsSync(join(gitDir, 'packed-refs'))).toBe(false);
  expect(existsSync(join(gitDir, 'commondir'))).toBe(false);
  expect(flagValue(held(state).calls.find((one) => one[0] === 'run') ?? [], '--user')).toBe(ME);
  expect(box.labels?.['ahpd.user']).toBe(ME);
  expect(box.labels?.['ahpd.git']).toBe('fetch');
});

it('binds a root session\'s git directory where its folder is reached, not where it really is', async () => {
  const dir = realpathSync(temp());
  const state = join(dir, 'docker.json');
  const { repo } = repositoryIn(dir);
  // The session's folder is a link to the repository. git answers real paths,
  // and the machine mounts the tree at the link, so every mount has to land
  // there: the volume at the real path is a second directory in the machine,
  // and the machine's own `<link>/.git` is left as the host's.
  const link = join(dir, 'link');
  symlinkSync(repo, link);

  const loaded = await withRepository(state);
  const { open } = await room(loaded);
  await open('ahp-session:/one', { computer: 'disposable:claude' }, link);

  const box = held(state).machines[0] as NonNullable<Held['machines'][number]>;
  const mounts = box.mounts ?? [];
  expect(mounts[0]).toBe(`${link}:${link}`);
  expect(mounts[1]).toBe(`${link}/.git/objects:${MACHINE_OBJECTS}:ro`);
  expect(mounts.at(-1)).toBe(`ahpd-git-${box.name}:${link}/.git`);
  expect(mounts.some((one) => one.includes(`${repo}/.git`) && !one.includes(`${link}/.git`))).toBe(false);
});

it('binds a worktree session\'s git directory through the link its folder is reached by', async () => {
  const dir = realpathSync(temp());
  const state = join(dir, 'docker.json');
  const { tree, gitDir } = repositoryIn(dir);
  const link = join(dir, 'link');
  symlinkSync(tree, link);

  const loaded = await withRepository(state);
  const { open } = await room(loaded);
  await open('ahp-session:/one', { computer: 'disposable:claude' }, link);

  const box = held(state).machines[0] as NonNullable<Held['machines'][number]>;
  const mounts = box.mounts ?? [];
  // The git directory is not inside the tree, so it is mounted where it is;
  // the gitfile stands in for the worktree's own `.git` at the folder's
  // spelling.
  expect(mounts[0]).toBe(`${link}:${link}`);
  expect(mounts[1]).toBe(`${gitDir}/objects:${MACHINE_OBJECTS}:ro`);
  expect(mounts[2]).toBe(`${join(dir, 'computers.gitfile')}:${link}/.git:ro`);
  expect(mounts.at(-1)).toBe(`ahpd-git-${box.name}:/opt/ahpd/git`);
});

it('leaves a root session\'s git directory open where the profile says gitGuard open', async () => {
  const dir = realpathSync(temp());
  const state = join(dir, 'docker.json');
  const { repo } = repositoryIn(dir);

  const loaded = await withRepository(state, { gitGuard: 'open' });
  const { open } = await room(loaded);
  await open('ahp-session:/one', { computer: 'disposable:claude' }, repo);

  const box = held(state).machines[0] as NonNullable<Held['machines'][number]>;
  expect(box.mounts).toEqual([`${repo}:${repo}`]);
  expect(box.labels?.['ahpd.git']).toBe('open');
  expect(held(state).calls.find((one) => one[0] === 'run')).not.toContain('--user');
});

it('mounts a worktree\'s git directory with no read-only binds where the profile says gitGuard open', async () => {
  const dir = realpathSync(temp());
  const state = join(dir, 'docker.json');
  const { tree, gitDir } = repositoryIn(dir);

  const loaded = await withRepository(state, { gitGuard: 'open' });
  const { open } = await room(loaded);
  await open('ahp-session:/one', { computer: 'disposable:claude' }, tree);

  const box = held(state).machines[0] as NonNullable<Held['machines'][number]>;
  expect(box.mounts).toEqual([`${tree}:${tree}`, `${gitDir}:${gitDir}`]);
  // Mounted on its own, so still the host user's.
  expect(flagValue(held(state).calls.find((one) => one[0] === 'run') ?? [], '--user')).toBe(ME);
  expect(box.labels?.['ahpd.git']).toBe('open');
});

it('takes the machine\'s own git volume with it, and asks for none where the profile leaves it open', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  /**
   * One machine made and disposed, and what became of it.
   *
   * The plugin's own line is what says the removal is finished: the machine
   * leaves the state file at `docker rm`, and the volume goes after it.
   */
  const gone = async (profile: Record<string, unknown>) => {
    const dir = realpathSync(temp());
    const state = join(dir, 'docker.json');
    const { repo } = repositoryIn(dir);
    const lines: string[] = [];
    const loaded = await withRepository(state, profile, {}, lines);
    const { open, dispose } = await room(loaded);
    await open('ahp-session:/one', { computer: 'disposable:claude' }, repo);
    const name = (held(state).machines[0] as NonNullable<Held['machines'][number]>).name;
    await dispose('ahp-session:/one');
    await settle();
    await advanceUntil(() => lines.some((line) => line.includes('removed the disposable machine')));
    await settle();
    return { state, name };
  };

  // The machine's own git directory is a volume nobody else would ever mount,
  // so it goes with the machine.
  const fetched = await gone({});
  expect(held(fetched.state).calls.some((one) => one[0] === 'volume' && one[1] === 'rm' && one[2] === `ahpd-git-${fetched.name}`)).toBe(true);

  // A machine the profile leaves the host's git directory open in has none, so
  // there is nothing to remove and nothing is asked for.
  const opened = await gone({ gitGuard: 'open' });
  expect(held(opened.state).calls.some((one) => one[0] === 'volume' && one[1] === 'rm')).toBe(false);
});

/*
 * Bringing a machine's work back.
 *
 * The scripted docker answers a machine's git the way one would - which branch
 * it is on, and then a bundle of it, written to stdout as the bytes git writes
 * - and the host's own git then fetches that bundle for real. What is under
 * test is both halves of the decision
 * `a-machine-commits-in-its-own-repository-and-the-host-fetches-it`: what the
 * machine's git was asked, and that the host's git is handed a file of this
 * host's own and nothing of the machine.
 */

/**
 * A machine's own repository, standing in for the one inside it, and a bundle of it.
 *
 * A scripted docker cannot make a repository, so this is a real one: a copy of
 * the history the host gave the machine, with one commit of the machine's own
 * on `branch`. `bundled` is the ref git in the machine is asked for - the branch
 * it is on, or `HEAD` where it is on none - and the bundle is the one it would
 * write to stdout for it.
 */
const machineRepository = (dir: string, repo: string, branch: string, bundled: string) => {
  const seed = execFileSync('git', ['-C', repo, 'rev-parse', branch], { stdio: 'pipe' }).toString().trim();
  const machine = join(dir, 'machine');
  mkdirSync(machine);
  const run = (...args: string[]) => execFileSync('git', ['-C', machine, ...args], { stdio: 'pipe' });
  run('init', '-q', '-b', branch);
  run('config', 'user.email', 'agent@example.com');
  run('config', 'user.name', 'Agent');
  run('fetch', '-q', repo, seed);
  run('reset', '-q', '--hard', seed);
  writeFileSync(join(machine, 'agent.txt'), 'from the machine\n');
  run('add', 'agent.txt');
  run('commit', '-q', '-m', 'from the machine');
  const made = run('rev-parse', 'HEAD').toString().trim();
  // On no branch, as the seed leaves a machine whose tree is on none.
  if (bundled === 'HEAD') run('checkout', '-q', '--detach');
  const bundle = join(dir, 'machine.bundle');
  run('bundle', 'create', bundle, bundled, '--not', seed);
  return { machine, made, bundle, seed };
};

/**
 * A `git` in front of the real one, so a test can read what this host's git was asked.
 *
 * The fetch that brings a machine's work back is this host's git reading a file
 * on this host's disk, which no scripted docker sees, so the one thing the plan
 * says about it - that it names that file and no path of the machine's - is a
 * claim about an argv. A program named `git`, first on PATH for the length of
 * one call, writes each argv down as one line and runs the real git behind it.
 */
const spyingOnGit = (dir: string): { log: string; bin: string } => {
  const real = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  const log = join(dir, 'git.log');
  writeFileSync(log, '');
  writeFileSync(join(bin, 'git'), `#!/bin/sh\nprintf '%s\\n' "$*" >> ${log}\nexec ${real} "$@"\n`, { mode: 0o755 });
  return { log, bin };
};

/** What ahpd left behind in the temporary directory, by the prefix it makes its own. */
const leftOver = (): string[] => readdirSync(tmpdir()).filter((one) => one.startsWith('ahpd-bringback-'));

/** The commit a ref is at, as the host's own git answers it, and nothing where there is no such ref. */
const refOf = (repo: string, ref: string): string =>
  execFileSync('git', ['-C', repo, 'for-each-ref', '--format=%(objectname)', ref], { stdio: 'pipe' }).toString().trim();

/** What the machine's git was asked for its bundle, as the scripted docker recorded it. */
const bundleAsked = (state: string): string[] | undefined =>
  (held(state).commands ?? []).find((one) => one.command.join(' ').includes('bundle create'))?.command;

it('brings a machine\'s commit back through a bundle, and the host\'s git reads only the file', async () => {
  const dir = realpathSync(temp());
  const state = join(dir, 'docker.json');
  const { repo, tree, gitDir } = repositoryIn(dir);
  const { made, bundle, seed } = machineRepository(dir, repo, 'work', 'refs/heads/work');
  // The agent's file is in the tree the machine shares with the host, where it
  // is a change nobody has committed until the fetch brings the commit back.
  writeFileSync(join(tree, 'agent.txt'), 'from the machine\n');
  // What the machine's git answers: the branch it is on, where that branch is,
  // and a bundle of it.
  writeFileSync(state, JSON.stringify({
    machines: [],
    calls: [],
    answers: [
      { when: '--short', out: 'work\n' },
      { when: 'rev-parse', out: `${made}\n` },
      { when: 'bundle create', file: bundle },
    ],
  }));

  const loaded = await withRepository(state);
  const { open } = await room(loaded);
  await open('ahp-session:/one', { computer: 'disposable:claude' }, tree);
  const box = held(state).machines[0] as NonNullable<Held['machines'][number]>;

  const spied = spyingOnGit(dir);
  const was = process.env.PATH;
  process.env.PATH = `${spied.bin}:${was ?? ''}`;
  try {
    expect(await loaded.computers?.bringBack?.(box.name)).toEqual({ moved: true });
  }
  finally {
    process.env.PATH = was;
  }

  // The branch is at the machine's commit and the host's index agrees: the
  // agent's file reads as committed work and not as a change nobody made.
  expect(execFileSync('git', ['-C', repo, 'rev-parse', 'work'], { stdio: 'pipe' }).toString().trim()).toBe(made);
  expect(execFileSync('git', ['-C', tree, 'status', '--porcelain'], { stdio: 'pipe' }).toString()).toBe('');
  // What the machine's git was asked: its branch, bundled to stdout - which is
  // what the `-` says - and nothing but what the host does not have already.
  expect(bundleAsked(state)).toEqual(['git', '-C', tree, 'bundle', 'create', '-', 'refs/heads/work', '--not', seed]);
  /*
   * And what the host's git was asked: the fetch names the file ahpd wrote and
   * the ref the work lands in, and no path of the machine's. That it succeeded
   * is the rest of the proof - the only bundle on this host is that file, and
   * the machine's own git directory is a volume at a path this host does not
   * have at all.
   */
  const said = readFileSync(spied.log, 'utf8').split('\n').filter((one) => one !== '');
  const fetched = said.find((one) => one.includes(' fetch '));
  expect(fetched).toContain(`+refs/heads/work:refs/ahpd/machines/${box.name}/work`);
  expect(fetched).toMatch(/fetch --no-tags --no-write-fetch-head \S+\.bundle /);
  expect(said.some((one) => one.includes('/opt/ahpd/git') || one.includes(gitDir))).toBe(false);
  // Nothing is left behind: not the file, and not the ref that held work which
  // is on the branch now.
  expect(leftOver()).toEqual([]);
  expect(refOf(repo, `refs/ahpd/machines/${box.name}/work`)).toBe('');
});

it('fetches a machine on no branch to the hidden ref, and moves no branch of the host\'s', async () => {
  const dir = realpathSync(temp());
  const state = join(dir, 'docker.json');
  const { repo, tree } = repositoryIn(dir);
  const before = execFileSync('git', ['-C', repo, 'rev-parse', 'work'], { stdio: 'pipe' }).toString().trim();
  const { made, bundle } = machineRepository(dir, repo, 'work', 'HEAD');
  writeFileSync(join(tree, 'agent.txt'), 'from the machine\n');
  writeFileSync(state, JSON.stringify({
    machines: [],
    calls: [],
    answers: [
      // A machine on no branch has nothing to answer for `HEAD`.
      { when: '--short', code: 1 },
      { when: 'rev-parse', out: `${made}\n` },
      { when: 'bundle create', file: bundle },
    ],
  }));

  const loaded = await withRepository(state);
  const { open } = await room(loaded);
  await open('ahp-session:/one', { computer: 'disposable:claude' }, tree);
  const box = held(state).machines[0] as NonNullable<Held['machines'][number]>;
  const hidden = `refs/ahpd/machines/${box.name}/HEAD`;

  expect(await loaded.computers?.bringBack?.(box.name)).toEqual({ moved: false, waiting: hidden });

  // The work is under the hidden ref and the branch is where it was: a machine
  // on no branch has no branch of the host's to move.
  expect(refOf(repo, hidden)).toBe(made);
  expect(execFileSync('git', ['-C', repo, 'rev-parse', 'work'], { stdio: 'pipe' }).toString().trim()).toBe(before);
  // And what was bundled is what the machine's HEAD was, since that is the only
  // name a repository with no branch checked out has for it.
  expect(bundleAsked(state)).toEqual(['git', '-C', tree, 'bundle', 'create', '-', 'HEAD', '--not', before]);
  expect(leftOver()).toEqual([]);
});

it('fetches what a machine committed before the machine goes', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const dir = realpathSync(temp());
  const state = join(dir, 'docker.json');
  const { repo, gitDir } = repositoryIn(dir);
  const { made, bundle, seed } = machineRepository(dir, repo, 'work', 'refs/heads/work');
  writeFileSync(join(repo, 'agent.txt'), 'from the machine\n');
  /*
   * A machine a daemon before this one left up, with its own git directory and
   * the session that was in it gone. Nothing in this daemon's life fetches for
   * it - no turn ran in it, and no session leaves it - so the removal is the one
   * moment left, and the volume holding its commits goes with the container.
   */
  writeFileSync(state, JSON.stringify({
    machines: [{
      name: 'leftover',
      image: 'node:22',
      state: 'running',
      mounts: [`${repo}:${repo}`, `${gitDir}/objects:${MACHINE_OBJECTS}:ro`, `ahpd-git-leftover:${gitDir}`],
      labels: { 'ahpd.computer': '1', 'ahpd.disposable': 'claude', 'ahpd.git': 'fetch', 'ahpd.user': ME },
    }],
    calls: [],
    answers: [
      { when: '--short', out: 'work\n' },
      { when: 'rev-parse', out: `${made}\n` },
      { when: 'bundle create', file: bundle },
    ],
  }));

  const lines: string[] = [];
  await load(options(state, {
    profiles: { claude: { title: 'Claude', disposable: true, disposableDelay: 1000 } },
  }), [], (line) => { lines.push(line); });
  await until(() => lines.some((one) => one.includes('left behind')));
  await advanceUntil(() => held(state).machines.length === 0);
  // The volume goes after the container, so the whole removal is waited for
  // rather than only the `rm -f` the state file moves on.
  await until(() => held(state).calls.some((one) => one[0] === 'volume' && one[1] === 'rm'));

  /*
   * What it committed was asked for before the container went. The order of the
   * two calls is the whole of what this case is about: the volume holding the
   * machine's commits is removed with the machine, so an `rm -f` that came first
   * is work thrown away.
   */
  const calls = held(state).calls;
  const bundled = calls.findIndex((one) => one.join(' ').includes('bundle create'));
  const removed = calls.findIndex((one) => one[0] === 'rm' && one.includes('-f'));
  expect(bundled).toBeGreaterThanOrEqual(0);
  expect(removed).toBeGreaterThan(bundled);
  // Asked of the machine that is going, and for the branch it is on.
  expect(calls[bundled]).toEqual(['exec', '-i', '--user', ME, 'leftover', 'git', '-C', repo, 'bundle', 'create', '-', 'refs/heads/work', '--not', seed]);
  // And its own git directory goes with it, as it does for any machine of this
  // host's own.
  expect(calls.some((one) => one[0] === 'volume' && one[1] === 'rm' && one[2] === 'ahpd-git-leftover')).toBe(true);
  // The host has the work: a commit that was only in a volume the removal has
  // since taken away is on the branch.
  expect(execFileSync('git', ['-C', repo, 'rev-parse', 'work'], { stdio: 'pipe' }).toString().trim()).toBe(made);
  expect(leftOver()).toEqual([]);
});

/*
 * Task 07: a machine made with the host's git directory writable.
 *
 * Before this plan every guard mounted part of the host's git directory in the
 * machine, so a machine a daemon before this one left up wrote its commits
 * straight into the host's repository: there is nothing to bring back, and it is
 * a machine the `fetch` guard would never make - decision
 * `a-machine-commits-in-its-own-repository-and-the-host-fetches-it`. Such a
 * machine is removed rather than adopted or entered, and the session is told,
 * in the one sentence `underBindSaid` spells.
 *
 * What says a machine is one of these is `madeUnderBind`: no `ahpd.git` label,
 * which every machine made since carries, and a read-only bind of a path in a
 * git directory - the mount point the old guard's writable binds were laid over,
 * and the pins a main checkout's guard put on the files git writes. The
 * read-only bind rather than the writable one, because the old `open` guard
 * mounted the git directory writable and nothing else - so a writable bind alone
 * would remove every `open` machine a daemon before this one left up.
 */

/** The mounts of a machine made under the old guard's main-checkout allowlist. */
const underBindMounts = (tree: string, gitDir: string): string[] => [
  `${tree}:${tree}`,
  `${gitDir}:${gitDir}:ro`,
  `${gitDir}/logs:${gitDir}/logs`,
];

it('removes a machine made with the host\'s git directory writable, and makes a fetch machine next', async () => {
  const dir = realpathSync(temp());
  const state = join(dir, 'docker.json');
  const { tree, gitDir } = repositoryIn(dir);
  writeFileSync(state, JSON.stringify({
    machines: [{
      name: 'under-bind',
      image: 'node:22',
      state: 'running',
      mounts: underBindMounts(tree, gitDir),
      labels: { 'ahpd.computer': '1', 'ahpd.disposable': 'claude' },
    }],
    calls: [],
  }));

  const lines: string[] = [];
  const loaded = await withRepository(state, {}, {}, lines);
  // The sentence is said before the removal is asked for, so the removal is
  // waited for on its own: `rm` is a real subprocess, and the state file moves
  // when it lands.
  await until(() => lines.some((one) => one.includes('git directory writable')));
  await until(() => held(state).machines.length === 0);

  // Removed, in the one sentence that says which machine and why: this is a
  // machine nobody was watching, so the log is where the daemon says it.
  const said = lines.filter((one) => one.includes('under-bind'));
  expect(said).toHaveLength(1);
  expect(said[0]).toContain('computer://under-bind was made with the host\'s git directory writable, so it was removed; the next turn makes a new one');
  expect(held(state).machines).toEqual([]);
  expect(held(state).calls.find((one) => one[0] === 'rm')).toEqual(['rm', '-f', 'under-bind']);
  /*
   * And it was not adopted on the way out: the line a machine left up for a
   * session nobody kept gets is not said, its delay is not armed, and what it
   * committed is not asked for - its commits are already in the host's
   * repository, because it wrote there.
   */
  expect(lines.some((one) => one.includes('left behind'))).toBe(false);
  expect((held(state).commands ?? []).some((one) => one.command.join(' ').includes('bundle create'))).toBe(false);
  expect(held(state).calls.some((one) => one[0] === 'volume' && one[1] === 'rm')).toBe(false);

  // The session it was made for starts again and asks for the same profile: the
  // machine it gets is one this daemon's guard made.
  const { open } = await room(loaded);
  await open('ahp-session:/one', { computer: 'disposable:claude' }, tree);
  const box = held(state).machines[0] as NonNullable<Held['machines'][number]>;
  expect(held(state).machines).toHaveLength(1);
  expect(box.name).not.toBe('under-bind');
  expect(box.labels?.['ahpd.git']).toBe('fetch');
});

it('leaves a labelled fetch machine and an open machine of the old guard alone', async () => {
  const dir = realpathSync(temp());
  const state = join(dir, 'docker.json');
  const { repo, tree, gitDir } = repositoryIn(dir);
  writeFileSync(state, JSON.stringify({
    machines: [
      /*
       * A machine this guard made: it carries the label, and its read-only
       * mount of the host's objects is exactly what the label excuses. The
       * label is what decides, not the mount.
       */
      {
        name: 'fetched',
        image: 'node:22',
        state: 'running',
        mounts: [`${tree}:${tree}`, `${gitDir}/objects:${MACHINE_OBJECTS}:ro`, `ahpd-git-fetched:/opt/ahpd/git`],
        labels: { 'ahpd.computer': '1', 'ahpd.git': 'fetch' },
      },
      /*
       * A machine the old `open` guard made, on a session in a linked worktree:
       * the tree and the host's git directory, both writable, and no read-only
       * bind anywhere - which is what a daemon before this one left, since the
       * label is what it could not carry.
       */
      {
        name: 'opened',
        image: 'node:22',
        state: 'running',
        mounts: [`${tree}:${tree}`, `${gitDir}:${gitDir}`],
        labels: { 'ahpd.computer': '1' },
      },
      // And one the old guard made with the host's git directory pinned
      // read-only under the tree it wrote in, which is what does go. The
      // session label is what a daemon before this one wrote for a machine it
      // made for a session, and the labels are what say the machine is ahpd's.
      {
        name: 'bound',
        image: 'node:22',
        state: 'running',
        mounts: underBindMounts(repo, gitDir),
        labels: { 'ahpd.computer': '1', 'ahpd.session': 'ahp-session:/one' },
      },
    ],
    calls: [],
  }));

  const lines: string[] = [];
  const loaded = await withRepository(state, {}, {}, lines);
  // The listing is what would remove one of these, and `enter` is a call that
  // waits for it - the port cannot count a session into a machine it has not
  // found yet - so asking for it is how a test knows the listing is over.
  await loaded.computers?.enter?.('opened', 'ahp-session:/one');

  expect(held(state).machines.map((one) => one.name).sort()).toEqual(['fetched', 'opened']);
  const said = lines.filter((one) => one.includes('git directory writable'));
  expect(said).toHaveLength(1);
  expect(said[0]).toContain('computer://bound was made with the host\'s git directory writable, so it was removed; the next turn makes a new one');
  // And both of the others are reached as before, which is the whole of what the
  // label and the read-only bind are read for.
  const fetched = await loaded.computers?.how('fetched', { command: 'true' });
  const opened = await loaded.computers?.how('opened', { command: 'true' });
  expect(fetched?.args).toContain('exec');
  expect(opened?.args).toContain('exec');
});

it('tells a session the sentence when it asks for such a machine', async () => {
  const dir = realpathSync(temp());
  const state = join(dir, 'docker.json');
  const { tree, gitDir } = repositoryIn(dir);
  writeFileSync(state, JSON.stringify({ machines: [], calls: [] }));

  const lines: string[] = [];
  const loaded = await withRepository(state, {}, {}, lines);
  // The listing of a daemon that found no machine at all, waited out.
  await until(() => held(state).calls.some((one) => one[0] === 'ps'));
  await settle();
  /*
   * A machine this daemon's listing never saw: one made by a daemon still
   * running under the guard this one no longer uses, after this one started.
   * The session that was in it is the one that meets it.
   */
  writeFileSync(state, JSON.stringify({
    machines: [{
      name: 'under-bind',
      image: 'node:22',
      state: 'running',
      mounts: underBindMounts(tree, gitDir),
      labels: { 'ahpd.computer': '1', 'ahpd.session': 'ahp-session:/one' },
    }],
    calls: [],
  }));

  /*
   * The sentence reaches the session on this road and no other: the port's
   * `enter` is a call the host makes in the background and swallows, and this is
   * the one answer a session start reads - `There is no computer called <id>`
   * would be the truth about a machine the session asked for and would not be
   * the truth about this one.
   */
  await expect(loaded.computers?.how('under-bind', { command: 'true' }))
    .rejects.toThrow('computer://under-bind was made with the host\'s git directory writable, so it was removed; the next turn makes a new one');
  expect(held(state).machines).toEqual([]);
  expect(lines.some((one) => one.includes('git directory writable'))).toBe(true);
});

/*
 * host/70 task 02: the labels say whose a machine is, before its mounts are read.
 *
 * A mount alone does not say who made a container. A person's own dev container
 * is made by the CLI, which writes the provider's label and the folder's and no
 * other, and its definition may bind any path read-only - a path in a git
 * directory among them, which is the mount the old guard left. So the labels
 * ahpd writes for a machine of its own are what a machine is judged by, and a
 * container without one of them is left exactly where it is.
 */
it('does not judge an adopted dev container that mounts a .git path read-only', async () => {
  const dir = realpathSync(temp());
  const state = join(dir, 'docker.json');
  const { tree, gitDir } = repositoryIn(dir);
  writeFileSync(state, JSON.stringify({
    machines: [{
      name: 'a-folders-own-container',
      image: 'devcontainer',
      state: 'running',
      /*
       * The mounts its own definition asks for: the folder, and the hooks of the
       * repository in it pinned read-only, which is the mount the old guard's
       * machine carried and the only one this judgement reads.
       */
      mounts: [`${tree}:${tree}`, `${gitDir}/hooks:${gitDir}/hooks:ro`],
      labels: { 'ahpd.computer': '1', 'ahpd.devcontainer.folder': tree },
    }],
    calls: [],
  }));

  const lines: string[] = [];
  const loaded = await withRepository(state, {}, {}, lines);
  // The startup listing is what would remove one, and `enter` waits for it:
  // the port cannot count a session into a machine it has not found yet.
  await loaded.computers?.enter?.('a-folders-own-container', 'ahp-session:/one');

  expect(held(state).machines.map((one) => one.name)).toEqual(['a-folders-own-container']);
  expect(held(state).calls.some((one) => one[0] === 'rm')).toBe(false);
  expect(lines.some((one) => one.includes('git directory writable'))).toBe(false);
});

it('still removes a machine a 0.9 daemon made with the git directory bound', async () => {
  const dir = realpathSync(temp());
  const state = join(dir, 'docker.json');
  const { tree, gitDir } = repositoryIn(dir);
  writeFileSync(state, JSON.stringify({
    machines: [{
      name: 'from-0-9',
      image: 'node:22',
      state: 'running',
      mounts: underBindMounts(tree, gitDir),
      // A machine that daemon made for a session: the one label of the six a
      // machine of that daemon's carried without a profile or a disposable key.
      labels: { 'ahpd.computer': '1', 'ahpd.session': 'ahp-session:/one' },
    }],
    calls: [],
  }));

  const lines: string[] = [];
  await withRepository(state, {}, {}, lines);
  // The sentence is said before the removal is asked for, so the removal is
  // waited for on its own: `rm` is a real subprocess, and the state file moves
  // when it lands.
  await until(() => lines.some((one) => one.includes('git directory writable')));
  await until(() => held(state).machines.length === 0);

  expect(held(state).calls.find((one) => one[0] === 'rm')).toEqual(['rm', '-f', 'from-0-9']);
  expect(lines.some((one) => one.includes('computer://from-0-9 was made with the host\'s git directory writable, so it was removed; the next turn makes a new one'))).toBe(true);
  // And nothing of it is asked for: its commits went into the host's repository
  // as it made them, so there is nothing left in it to bring back.
  expect((held(state).commands ?? []).some((one) => one.command.join(' ').includes('bundle create'))).toBe(false);
});

/*
 * Task 09: a profile that gives a machine a copy of the folder.
 *
 * `shared`, the default, binds the host's tree at its own path and puts the
 * machine's git directory in a volume over the tree's own `.git`, so the agent
 * works in the host's folder and the host sees its edits as it makes them.
 * Under `copy` the volume is mounted at the tree's own path instead and holds
 * the working tree and the git directory together: nothing of the host's tree
 * reaches the machine, and its work reaches the host as the commits ahpd
 * fetches - decision
 * `a-machine-commits-in-its-own-repository-and-the-host-fetches-it`.
 */

it('gives a machine a copy of the tree where the profile says sessionTree copy', async () => {
  const dir = realpathSync(temp());
  const { repo, gitDir } = repositoryUnder(join(dir, 'project'));

  // The tree as `shared` gives it: bound at its own path, with the machine's
  // git directory in a volume over the tree's own `.git`.
  const boundState = join(dir, 'bound.json');
  const bound = await room(await withRepository(boundState));
  await bound.open('ahp-session:/one', { computer: 'disposable:claude' }, repo);
  expect((held(boundState).machines[0] as NonNullable<Held['machines'][number]>).mounts).toContain(`${repo}:${repo}`);

  // Under `copy` the machine works in its own checkout: the host's tree is
  // mounted nowhere, and the volume it commits into is mounted at the tree's
  // own path instead.
  const state = join(dir, 'docker.json');
  const copied = await room(await withRepository(state, { sessionTree: 'copy' }));
  const branches = (): string => execFileSync('git', ['-C', repo, 'for-each-ref', '--format=%(refname) %(objectname)'], { encoding: 'utf8' });
  const before = branches();
  await copied.open('ahp-session:/two', { computer: 'disposable:claude' }, repo);

  const box = held(state).machines[0] as NonNullable<Held['machines'][number]>;
  expect(box.mounts).toEqual([
    `${gitDir}/objects:${MACHINE_OBJECTS}:ro`,
    `ahpd-git-${box.name}:${repo}`,
  ]);
  // Nothing of the host's is mounted writable anywhere in the machine - what
  // the host lends it is the objects of its git directory, read-only - and the
  // host's git directory is what it was: the volume is the machine's own.
  expect((box.mounts ?? []).filter((one) => (one.split(':')[0] ?? '').startsWith(dir))).toEqual([`${gitDir}/objects:${MACHINE_OBJECTS}:ro`]);
  // And the host's repository answers what it did: the machine commits into a
  // git directory of its own rather than into this one.
  expect(branches()).toBe(before);
  // And the guard is recorded as `fetch`: the machine commits in a git
  // directory of its own, which is what brings its work back to the host.
  expect(box.labels?.['ahpd.git']).toBe('fetch');

  // The seed makes that git directory inside the volume, at the tree's own
  // `.git`, with the tree's own branch, commit and identity - and checks the
  // working tree out with `reset --hard`, since the tree in there is the
  // volume's own and holds nothing yet.
  const seeded = (held(state).commands ?? []).map((one) => one.command.join(' '));
  expect(seeded).toContain(`git --git-dir=${repo}/.git --work-tree=${repo} reset --hard -q`);
  expect(seeded).toContain(`git --git-dir=${repo}/.git --work-tree=${repo} config user.email test@example.com`);
  // Which `shared` never does: the tree there is the host's own folder.
  const boundSeeded = (held(boundState).commands ?? []).map((one) => one.command.join(' '));
  expect(boundSeeded.some((one) => one.includes('reset --hard'))).toBe(false);
});
