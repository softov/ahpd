import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { createHost } from '../../sdk/src/host.js';
import { fileResources } from '../../sdk/src/resources.js';
import { loadPlugins } from '../../server/src/plugins.js';
import { echo } from '../../../examples/echo/agent.js';
import { closeAll, keeping } from './support/closing.js';
import type { Agent } from '../../sdk/src/types/agent.js';
import type { HostOptions } from '../../sdk/src/types/host.js';
import type { Peer } from '../../sdk/src/types/rpc.js';

/*
 * What the computer plugin stops when the daemon stops.
 *
 * A disposal timer and a nested host child are this plugin's own work, and
 * nothing else knows about them: left running they run for the rest of the
 * process's life, which is a machine removed into a folder somebody has since
 * removed, and a command still writing a file a test has finished with. The
 * `docker` the runtime spawns is the scripted fixture, so what is under test is
 * what this package asked Docker for once the host had closed: nothing.
 */

const REPO = join(import.meta.dirname, '../../..');
const SOURCE = './packages/computer/src/index.ts';
const FIXTURE = fileURLToPath(new URL('./fixtures/docker.mjs', import.meta.url));

/** A temporary directory removed after the test that made it. */
let loose: string | undefined;
/** The state directory a load is given, which is a temporary one of its own. */
let state: string | undefined;
afterEach(async () => {
  // Real timers first, then whatever this case left open - a case that failed
  // part way through its own close still has its folders removed behind a
  // host that is closed.
  vi.useRealTimers();
  await closeAll();
  if (loose !== undefined) rmSync(loose, { recursive: true, force: true });
  loose = undefined;
  if (state !== undefined) rmSync(state, { recursive: true, force: true });
  state = undefined;
});

const temp = (): string => {
  loose = mkdtempSync(join(tmpdir(), 'ahpd-close-'));
  return loose;
};

const stateDir = (): string => (state ??= mkdtempSync(join(tmpdir(), 'ahpd-close-config-')));

/** The fake docker's own record, as much of it as this file reads. */
interface Held {
  machines: { name: string }[];
  calls: string[][];
}

const held = (at: string): Held => (existsSync(at)
  ? JSON.parse(readFileSync(at, 'utf8')) as Held
  : { machines: [], calls: [] });

/**
 * Every path under a folder, with what it was last written at.
 *
 * What a test folder is asked after a close: not only that no call was made,
 * but that nothing at all was written where a timer that outlived the host
 * would have written it.
 */
const tree = (dir: string): string[] => readdirSync(dir, { recursive: true })
  .map(String)
  .sort()
  .map((one) => `${one}:${statSync(join(dir, one)).mtimeMs}`);

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
 * Wait until the record has stopped growing.
 *
 * A session's end runs behind the call that asked for it - what the machine
 * committed is read back, and the machine read again - so a close landing
 * straight after a dispose is a close in the middle of that work rather than
 * after it. Five quiet polls of 50ms is longer than any one call to Docker
 * takes, so nothing is in flight when this answers.
 */
const quiet = async (at: string): Promise<void> => {
  let last = -1;
  let still = 0;
  while (still < 5) {
    const now = held(at).calls.length;
    still = now === last ? still + 1 : 0;
    last = now;
    await wait(50);
  }
};

const peer = (): Peer => ({
  send: () => {},
  notify: () => {},
  request: async () => ({}),
  answered: () => {},
  close: () => {},
});

const base = (agents: Agent[]): HostOptions => ({
  path: '/tmp/computer-close',
  agents,
  resources: fileResources(),
});

/** The echo backend, declaring what a machine needs for it to run. */
const agentWith = (): Agent => ({
  ...echo({ path: '/tmp/computer-close', pace: 0 }),
  machine: () => ({}),
});

const load = async (
  pluginOptions: Record<string, unknown>,
  agents: Agent[] = [],
  log: (message: string) => void = () => {},
) => {
  const result = await loadPlugins(
    [{ name: SOURCE, options: pluginOptions }],
    { base: base(agents), configDir: stateDir(), cwd: REPO, log },
  );
  keeping(result.options);
  return result;
};

/** The options every test starts from: the fixture as the runtime. */
const options = (state: string, more: Record<string, unknown> = {}): Record<string, unknown> => ({
  command: process.execPath,
  args: [FIXTURE],
  env: { DOCKER_FAKE_STATE: state },
  ...more,
});

/** One host, its client, and the close this file is about. */
async function room(hostOptions: HostOptions) {
  const p = peer();
  const host = createHost(hostOptions);
  keeping(hostOptions, host);
  const client = host.accept(p);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  });
  return {
    client,
    close: (): Promise<void> => host.close(),
    open: async (uri: string, config: Record<string, unknown>, folder: string): Promise<void> => {
      await client.handle({
        method: 'createSession',
        params: { channel: uri, provider: 'echo', config, workingDirectories: [folder] },
      });
      await client.handle({ method: 'subscribe', params: { channel: uri } });
    },
    dispose: (uri: string): Promise<unknown> => client.handle({ method: 'disposeSession', params: { channel: uri } }),
  };
}

it('removes no machine and writes nothing once the host has closed', async () => {
  const dir = temp();
  const state = join(dir, 'docker.json');
  const folder = join(dir, 'project');
  mkdirSync(folder);

  const { options: loaded } = await load(options(state, {
    profiles: { scratch: { title: 'Scratch', disposable: true, disposableDelay: 1000 } },
  }), [agentWith()]);
  const { open, dispose, close } = await room(loaded);
  await open('ahp-session:/one', { computer: 'disposable:scratch' }, folder);
  await until(() => held(state).machines.length === 1);
  const box = held(state).machines[0]?.name as string;
  expect(box).toBeDefined();

  // The session is gone, so the machine is on its delay rather than removed.
  await dispose('ahp-session:/one');
  await settle();
  await quiet(state);
  await close();

  // The delay passes with the daemon gone: the machine is still there, and
  // neither the record nor the folder says anything happened.
  const before = tree(dir);
  await wait(1500);
  expect(held(state).calls.some((one) => one[0] === 'rm')).toBe(false);
  expect(held(state).machines.map((one) => one.name)).toEqual([box]);
  expect(tree(dir)).toEqual(before);
});

it('waits for a removal that is running before it answers', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const dir = temp();
  const state = join(dir, 'docker.json');
  // What a daemon that stopped left behind: a labelled machine nobody is in,
  // which the startup scan gives the delay again.
  writeFileSync(state, JSON.stringify({
    machines: [{ name: 'left-behind', image: 'node:22', labels: { 'ahpd.disposable': 'claude' } }],
    calls: [],
  }));

  const lines: string[] = [];
  const { options: loaded } = await load(options(state, {
    profiles: { claude: { title: 'Claude', disposable: true, disposableDelay: 1000 } },
  }), [agentWith()], (line) => { lines.push(line); });
  const { close } = await room(loaded);
  await until(() => lines.some((one) => one.includes('left behind')));

  // The delay runs out, so a removal has started and has not finished.
  await vi.advanceTimersByTimeAsync(1000);
  await close();

  // Answered once the removal is done rather than once it was started, which
  // is what the machine being gone from the record says.
  expect(held(state).calls.some((one) => one[0] === 'rm')).toBe(true);
  expect(held(state).machines).toEqual([]);
  expect(lines.some((one) => one.includes('removed the disposable machine left-behind'))).toBe(true);
});

it('does not give a refused removal the delay again once the host has closed', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const dir = temp();
  const state = join(dir, 'docker.json');
  /*
   * A leftover of this daemon's whose work cannot be read out of it, so the
   * removal is refused and the machine is kept - which is the case that gives
   * the delay again, and the one that must not once the daemon is going.
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
  const { options: loaded } = await load(options(state, {
    profiles: { claude: { title: 'Claude', disposable: true, disposableDelay: 1000 } },
  }), [agentWith()], (line) => { lines.push(line); });
  const { close } = await room(loaded);
  await until(() => lines.some((one) => one.includes('left-behind left behind')));

  await vi.advanceTimersByTimeAsync(1000);
  await close();
  // The removal ran while the daemon was going, and was refused.
  expect(lines.some((one) => one.includes('still here'))).toBe(true);

  // And nothing arms again: the machine is left for whoever starts next,
  // rather than being read out and taken apart after this daemon is gone.
  await vi.advanceTimersByTimeAsync(10000);
  await wait(300);
  expect(lines.filter((one) => one.includes('still here'))).toHaveLength(1);
  expect(held(state).calls.some((one) => one[0] === 'rm')).toBe(false);
});
