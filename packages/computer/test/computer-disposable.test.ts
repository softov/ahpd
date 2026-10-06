import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
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
) => loadPlugins(
  [{ name: SOURCE, options: pluginOptions }],
  { base: base(agents, more), configDir: REPO, cwd: REPO, log, ...(hostId === undefined ? {} : { hostId }) },
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
  await vi.advanceTimersByTimeAsync(1000);
  await until(() => held(state).machines.length === 0);
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
  await vi.advanceTimersByTimeAsync(1000);
  await until(() => held(state).machines.length === 0);
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
  await vi.advanceTimersByTimeAsync(1000);
  await until(() => held(state).machines.length === 0);
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
  await vi.advanceTimersByTimeAsync(1000);
  await until(() => held(state).machines.length === 0);
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
  await vi.advanceTimersByTimeAsync(1000);
  await until(() => held(state).machines.length === 0);
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
    { base: base([], { sessions: store }), configDir: REPO, cwd: REPO, log: (line) => { lines.push(line); } },
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

const ME = `${String(process.getuid?.())}:${String(process.getgid?.())}`;

/** A host with the git port and one disposable profile that brings the session's folder in. */
const withRepository = async (state: string, profile: Record<string, unknown> = {}) => (await load(options(state, {
  profiles: { claude: { title: 'Claude', image: 'node:22', disposable: true, sessionFolder: true, disposableDelay: 1000, ...profile } },
}), [agentWith()], () => {}, { worktrees: gitWorktrees() })).options;

const flagValue = (argv: readonly string[], flag: string): string | undefined => {
  const at = argv.indexOf(flag);
  return at === -1 ? undefined : argv[at + 1];
};

it('mounts a worktree session\'s git directory beside its folder, and runs the machine as the host user', async () => {
  const dir = realpathSync(temp());
  const state = join(dir, 'docker.json');
  const { tree, gitDir } = repositoryIn(dir);

  const loaded = await withRepository(state);
  const { open } = await room(loaded);
  await open('ahp-session:/one', { computer: 'disposable:claude' }, tree);

  const box = held(state).machines[0] as NonNullable<Held['machines'][number]>;
  expect(box.mounts?.slice(0, 2)).toEqual([`${tree}:${tree}`, `${gitDir}:${gitDir}`]);
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

  const loaded = await withRepository(state);
  const { open } = await room(loaded);
  await open('ahp-session:/one', { computer: 'disposable:claude' }, below);

  const box = held(state).machines[0] as NonNullable<Held['machines'][number]>;
  // The root brings the git directory, so it has no mount of its own; the
  // read-only binds follow.
  expect(box.mounts?.slice(0, 2)).toEqual([`${repo}:${repo}`, `${gitDir}/hooks:${gitDir}/hooks:ro`]);
  expect(box.mounts).not.toContain(`${below}:${below}`);
  expect(box.mounts).not.toContain(`${gitDir}:${gitDir}`);
  expect(box.workdir).toBe(below);
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

it('binds what git runs on the host read-only over the git directory, in order', async () => {
  const dir = realpathSync(temp());
  const state = join(dir, 'docker.json');
  const { tree, gitDir, entry } = repositoryIn(dir);
  // Neither is there: no hooks here, and no `config.worktree` in a fresh entry.
  rmSync(join(gitDir, 'hooks'), { recursive: true, force: true });
  expect(existsSync(join(entry, 'config.worktree'))).toBe(false);

  const loaded = await withRepository(state);
  const { open } = await room(loaded);
  await open('ahp-session:/one', { computer: 'disposable:claude' }, tree);

  const box = held(state).machines[0] as NonNullable<Held['machines'][number]>;
  expect(box.mounts).toEqual([
    `${tree}:${tree}`,
    `${gitDir}:${gitDir}`,
    `${gitDir}/hooks:${gitDir}/hooks:ro`,
    `${gitDir}/config:${gitDir}/config:ro`,
    `${gitDir}/worktrees:${gitDir}/worktrees:ro`,
    `${entry}:${entry}`,
    `${entry}/config.worktree:${entry}/config.worktree:ro`,
    `${entry}/commondir:${entry}/commondir:ro`,
    `${entry}/gitdir:${entry}/gitdir:ro`,
    `${gitDir}/modules:${gitDir}/modules:ro`,
    `${tree}/.git:${tree}/.git:ro`,
  ]);
  // No bind names the other worktree's entry: the read-only `worktrees/` covers it.
  expect((box.mounts ?? []).some((one) => one.includes('/worktrees/other'))).toBe(false);
  // Every source was there before the machine was made, made empty on the host.
  expect(readFileSync(join(entry, 'config.worktree'), 'utf8')).toBe('');
  expect(readdirSync(join(gitDir, 'hooks'))).toEqual([]);
  // And `modules/`, which the repository did not have, so nothing in the
  // machine can make one there.
  expect(readdirSync(join(gitDir, 'modules'))).toEqual([]);
  expect(box.labels?.['ahpd.worktree']).toBe(entry);
});

it('binds the repository\'s own modules read-only, leaving what is in them', async () => {
  const dir = realpathSync(temp());
  const state = join(dir, 'docker.json');
  const { tree, gitDir, entry } = repositoryIn(dir);
  mkdirSync(join(gitDir, 'modules', 'lib'), { recursive: true });

  const loaded = await withRepository(state);
  const { open } = await room(loaded);
  await open('ahp-session:/one', { computer: 'disposable:claude' }, tree);

  const mounts = held(state).machines[0]?.mounts ?? [];
  const modules = mounts.indexOf(`${gitDir}/modules:${gitDir}/modules:ro`);
  expect(modules).toBeGreaterThan(0);
  expect(modules).toBe(mounts.indexOf(`${entry}/gitdir:${entry}/gitdir:ro`) + 1);
  expect(mounts.at(-1)).toBe(`${tree}/.git:${tree}/.git:ro`);
});

it('refuses a git directory whose hooks are a link, which the machine could replace', async () => {
  const dir = realpathSync(temp());
  const state = join(dir, 'docker.json');
  const { repo, tree, gitDir } = repositoryIn(dir);
  rmSync(join(gitDir, 'hooks'), { recursive: true, force: true });
  mkdirSync(join(repo, 'githooks'));
  symlinkSync(join(repo, 'githooks'), join(gitDir, 'hooks'));

  const loaded = await withRepository(state);
  const { open } = await room(loaded);
  await expect(open('ahp-session:/one', { computer: 'disposable:claude' }, tree)).rejects.toThrow(/hooks is a symbolic link/);
  expect(held(state).machines).toEqual([]);
});

it('removes the session\'s own index.lock once its machine is gone, and not before', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const dir = realpathSync(temp());
  const state = join(dir, 'docker.json');
  const { tree, gitDir, entry } = repositoryIn(dir);

  const loaded = await withRepository(state);
  const { open, dispose } = await room(loaded);
  await open('ahp-session:/one', { computer: 'disposable:claude' }, tree);
  await until(() => held(state).machines.length === 1);
  // A crashed agent's lock in its own entry, and one in the main index.
  writeFileSync(join(entry, 'index.lock'), '');
  writeFileSync(join(gitDir, 'index.lock'), '');

  await dispose('ahp-session:/one');
  await settle();
  await vi.advanceTimersByTimeAsync(600);
  await settle();
  expect(held(state).machines).toHaveLength(1);
  expect(existsSync(join(entry, 'index.lock'))).toBe(true);

  await vi.advanceTimersByTimeAsync(1000);
  await until(() => !existsSync(join(entry, 'index.lock')));
  expect(existsSync(join(entry, 'index.lock'))).toBe(false);
  expect(held(state).calls.some((one) => one[0] === 'rm')).toBe(true);
  expect(held(state).machines).toEqual([]);
  // The main index's lock is never this machine's to take.
  expect(existsSync(join(gitDir, 'index.lock'))).toBe(true);
});

it('guards a session at the repository root, whose git directory is inside its folder', async () => {
  const dir = realpathSync(temp());
  const state = join(dir, 'docker.json');
  const { repo, gitDir } = repositoryIn(dir);

  const loaded = await withRepository(state);
  const { open } = await room(loaded);
  await open('ahp-session:/one', { computer: 'disposable:claude' }, repo);

  // No second mount of the git directory, which the folder brings; the same
  // read-only binds over it, and the host user.
  const box = held(state).machines[0] as NonNullable<Held['machines'][number]>;
  expect(box.mounts).toEqual([
    `${repo}:${repo}`,
    `${gitDir}/hooks:${gitDir}/hooks:ro`,
    `${gitDir}/config:${gitDir}/config:ro`,
    `${gitDir}/worktrees:${gitDir}/worktrees:ro`,
    `${gitDir}/modules:${gitDir}/modules:ro`,
  ]);
  expect(flagValue(held(state).calls.find((one) => one[0] === 'run') ?? [], '--user')).toBe(ME);
  expect(box.labels?.['ahpd.user']).toBe(ME);
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
  expect(box.labels?.['ahpd.worktree']).toBeUndefined();
});
