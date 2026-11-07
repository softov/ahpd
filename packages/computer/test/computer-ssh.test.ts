import { posix } from '../../../tools/posix.ts';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { machineRefusal } from '../../sdk/src/machines/computers.js';
import { fileResources } from '../../sdk/src/resources/resources.js';
import { loadPlugins } from '../../server/src/plugins.js';
import { raise } from '../../sdk/src/plugins/plugins.js';
import { echo } from '../../../examples/echo/agent.js';
import { hostCall } from './support/calls.js';
import { closeAll, keeping } from './support/closing.js';
import { isRunning } from '../src/runtime.js';
import { routed } from '../src/router.js';
import { forgetHost, keygenWith, machineKey } from '../src/keys.js';
import { STATS, quote, sshReach, sshRuntime, statsFrom } from '../src/ssh.js';
import type { SshMachine } from '../src/ssh.js';
import type { Agent } from '../../sdk/src/types/agent.js';
import type { HostOptions, HostTool } from '../../sdk/src/types/host.js';
import type { MachineNeed } from '../../sdk/src/types/machine.js';
import type { Usage, UsageEntry, UsageTotal } from '../../sdk/src/types/usage.js';
import type { Vault } from '../../sdk/src/types/vault.js';

/*
 * A machine on another box, reached over a scripted `ssh`.
 *
 * This is the fixture's own case: what it records, what it refuses and what it
 * runs. Tasks 02 and 03 add the runtime's calls and one nested session end to
 * end, both through this same script, so a test needs no network, no key and
 * no `ssh` installed.
 */

const REPO = join(import.meta.dirname, '../../..');
const SOURCE = './packages/computer/src/index.ts';
const FIXTURE = fileURLToPath(new URL('./fixtures/ssh.mjs', import.meta.url));
const DOCKER_FIXTURE = fileURLToPath(new URL('./fixtures/docker.mjs', import.meta.url));
const KEYGEN_FIXTURE = fileURLToPath(new URL('./fixtures/ssh-keygen.mjs', import.meta.url));

/** A temporary directory removed after the test that made it. */
let loose: string | undefined;
afterEach(async () => {
  // Real timers first, then everything the test started: a close waits for
  // work that the faked clock above would never let finish.
  vi.useRealTimers();
  await closeAll();
  if (loose !== undefined) rmSync(loose, { recursive: true, force: true });
  loose = undefined;
  if (home !== undefined) rmSync(home, { recursive: true, force: true });
  home = undefined;
});

/*
 * The state directory a load is given, which is a temporary one of its own.
 *
 * A load with this repository as its state directory writes into the checkout:
 * a machine made on a linked worktree leaves `computers.gitfile` at whatever
 * `configDir` names, and a test that did that put a file in the repository.
 */
let home: string | undefined;
const stateDir = (): string => (home ??= mkdtempSync(join(tmpdir(), 'ahpd-ssh-config-')));

/** The file the fixture records its calls in, made with the directory. */
const log = (): string => join((loose ??= mkdtempSync(join(tmpdir(), 'ahpd-ssh-'))), 'ssh.jsonl');

/** One run of the scripted ssh, with the environment a test wants it to read. */
const ssh = (args: string[], env: Record<string, string> = {}) => spawnSync(
  process.execPath,
  [FIXTURE, ...args],
  { encoding: 'utf8', env: { ...process.env, SSH_FAKE_LOG: log(), ...env } },
);

/** Every call recorded, in the order the fixture was run. */
const recorded = (): string[][] => (existsSync(log())
  ? readFileSync(log(), 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as string[])
  // A test whose box is never reached has no file, which is no calls.
  : []);

// POSIX-only: the scripted ssh stands in for a Linux box by running the
// remote string with `/bin/sh` on this host.
it.skipIf(!posix)('runs the remote string on this host, and records the call as ssh was given it', () => {
  const one = ssh(['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', '-p', '2222', '-i', '/keys/dev02', 'dev02', '--', 'echo nested; exit 3']);

  // The command is a real one, and its output and code are this process's own.
  expect(one.stdout).toBe('nested\n');
  expect(one.status).toBe(3);
  // The whole call, so a test can assert the flags the runtime writes rather
  // than the sentence a program happened to print.
  expect(recorded()).toEqual([
    ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', '-p', '2222', '-i', '/keys/dev02', 'dev02', '--', 'echo nested; exit 3'],
  ]);
});

// POSIX-only: the scripted ssh stands in for a Linux box by running the
// remote string with `/bin/sh` on this host.
it.skipIf(!posix)('keeps the remote string whole, so what the caller wrote is what runs', () => {
  // One string to `sh -c` and never this program's own word splitting: the
  // quoting the runtime did survives to the shell that reads it.
  const one = ssh(['dev02', '--', 'printf "%s\\n" "a b" "c"']);
  expect(one.stdout).toBe('a b\nc\n');
  expect(one.status).toBe(0);
});

it('refuses a destination it is told is unreachable, as ssh does', () => {
  const one = ssh(['-T', '-p', '2222', 'dev02', '--', 'echo never'], { SSH_FAKE_UNREACHABLE: 'dev02,web1' });

  // ssh's own last line, which a listing reports as why the box is not up, and
  // ssh's own exit code for not connecting.
  expect(one.status).toBe(255);
  expect(one.stdout).toBe('');
  expect(one.stderr).toBe('ssh: connect to host dev02 port 2222: No route to host\n');
  // Recorded before it refused: the call was made, whatever came of it.
  expect(recorded()).toHaveLength(1);
});

it('records every call, so calls that overlap are all there', () => {
  // A listing asks each configured box at once, so the file is appended to
  // rather than rewritten: one line per call, none dropped.
  ssh(['dev02', '--', 'true']);
  ssh(['web1', '--', 'true']);
  ssh(['dev02', '--', 'true']);
  expect(recorded().map((one) => one[0])).toEqual(['dev02', 'web1', 'dev02']);
});

it('refuses a call with no destination, rather than running it here', () => {
  const one = ssh(['-T', '--', 'echo never']);
  expect(one.status).toBe(255);
  expect(one.stdout).toBe('');
  expect(one.stderr).toContain('ssh: connect to host  port 22');
});

/*
 * The runtime: one `ssh` per verb, and the two verbs a box does not have.
 *
 * The `ssh` is the scripted one, so what is under test is the call the runtime
 * builds and what it makes of the answer, not ssh itself.
 */

/** The runtime over the scripted ssh, with the boxes and the environment given. */
const boxes = (machines: Record<string, SshMachine>, env: Record<string, string> = {}) => sshRuntime({
  command: process.execPath,
  args: [FIXTURE],
  env: { SSH_FAKE_LOG: log(), ...env },
  machines,
});

/** A temporary directory this test owns, which the fixture's log lives in. */
const temp = (): string => (loose = mkdtempSync(join(tmpdir(), 'ahpd-ssh-')));

/**
 * Real milliseconds, even under a faked clock.
 *
 * The interval tests move `setInterval` and `Date`; a subprocess still takes
 * real time to start, so the wait is the one this module captured first.
 */
const realSetTimeout = setTimeout;
const wait = (ms: number): Promise<void> => new Promise((resolve) => { realSetTimeout(resolve, ms); });
const until = async (check: () => boolean, times = 1000): Promise<void> => {
  for (let i = 0; i < times; i++) {
    if (check()) return;
    await wait(5);
  }
  throw new Error(`still waiting after ${times} tries`);
};

// POSIX-only: the scripted ssh stands in for a Linux box by running the
// remote string with `/bin/sh` on this host.
it.skipIf(!posix)('lists the boxes the options name, and says why one of them is not up', async () => {
  const one = boxes(
    {
      dev02: { destination: 'dev02', port: '2229', identity: '/keys/dev02' },
      web1: { destination: 'web1', port: '2222' },
    },
    { SSH_FAKE_UNREACHABLE: 'web1' },
  );

  const rows = await one.list();
  expect(rows.map((row) => row.id)).toEqual(['dev02', 'web1']);
  expect(rows.map((row) => row.status)).toEqual([
    'running',
    // ssh's own sentence, which is the only thing that says which box went and
    // why: a box that is not up is not one this host can say more about.
    'unreachable: ssh: connect to host web1 port 2222: No route to host',
  ]);
  // The statuses are the ones the plugin reads a machine's state from, and only
  // one of these boxes is up.
  expect(rows.map((row) => isRunning(row))).toEqual([true, false]);

  // Every box was asked once with the flags the operator's own machines are
  // reached through: no terminal, no prompt, and the connect bound.
  expect(recorded().map((one) => one.join(' ')).sort()).toEqual([
    '-T -o BatchMode=yes -o ConnectTimeout=30 -p 2222 web1 -- true',
    '-T -o BatchMode=yes -o ConnectTimeout=30 -p 2229 -i /keys/dev02 dev02 -- true',
  ].sort());
});

// POSIX-only: the scripted ssh stands in for a Linux box by running the
// remote string with `/bin/sh` on this host.
it.skipIf(!posix)('runs a command on the box in its own directory, and answers what it printed', async () => {
  // A directory that is there, because the scripted ssh runs the remote string
  // on this host: a `cd` to a path no box here has is a command that failed.
  const work = join(temp(), 'srv-app');
  mkdirSync(work);
  const one = boxes({ dev02: { destination: 'dev02', port: '2229', workdir: work } });

  // A word with a quote in it and one with a space, run where the box's own
  // work directory is: what reaches the login shell is what the caller meant.
  expect(await one.exec('dev02', ['printf', '%s\\n', "it's here"])).toEqual({ output: "it's here", code: 0 });
  // The last word of the call is the remote string, which is where the
  // directory and the quoting are: everything before it is the box's address.
  expect(recorded()[0]?.at(-1)).toBe(`cd '${work}' && 'printf' '%s\\n' 'it'\\''s here'`);

  // The box's exit code is the answer, not a failure: `sh -c` is a command
  // like any other, and a session reads its code to know what happened.
  expect(await one.exec('dev02', ['sh', '-c', 'exit 3'])).toEqual({ output: '', code: 3 });

  // A box that is not configured is a sentence rather than a command run
  // somewhere else.
  await expect(one.exec('web1', ['true'])).rejects.toThrow(/there is no ssh machine called web1/);
  expect(await one.inspect('web1')).toBeUndefined();
});

// POSIX-only: the scripted ssh stands in for a Linux box by running the
// remote string with `/bin/sh` on this host.
it.skipIf(!posix)('answers what a box is, what it is doing and who prepared and owns it', async () => {
  const one = boxes({
    dev02: { destination: 'dev02', port: '2229', workdir: '/srv/app', agents: ['claude'] },
    web1: { destination: 'web1' },
  }, { SSH_FAKE_UNREACHABLE: 'web1' });

  /*
   * The record is the operator's own line, and never Docker's shape: a box has
   * no image, no label and no moment this host saw it made, so a runtime that
   * answered those would be inventing a fact about a machine it never made.
   * Nothing was reached to write it, which is the whole difference from
   * `state`.
   */
  expect(await one.inspect('dev02')).toEqual({
    id: 'dev02', destination: 'dev02', port: '2229', workdir: '/srv/app', agents: ['claude'],
  });
  expect(existsSync(log())).toBe(false);

  // What it is doing is the one thing the options do not hold, so it is the one
  // thing reached for: a box that answered is running, and one that did not is
  // stopped rather than the longer word its listing carries.
  expect(await one.state('dev02')).toBe('running');
  expect(await one.state('web1')).toBe('stopped');
  expect(recorded().map((one) => one.at(-1))).toEqual(['true', 'true']);

  // A box prepared for nobody answers an empty list, which is not the same
  // answer as a box this host does not have.
  expect(await one.agents('dev02')).toEqual(['claude']);
  expect(await one.agents('web1')).toEqual([]);

  // Nobody here made the box, so there is no owner it can answer, and the host
  // is where the plugin's own record ends.
  expect(await one.owner('dev02')).toEqual({});

  // A box is listed rather than made, so no part was mounted into it: its ahpd
  // and its agents are the ones installed on it, and there is nothing to check.
  expect(await one.parts('dev02')).toBeUndefined();

  // A name this host does not serve is not a machine, which is the answer every
  // one of the four gives.
  expect(await one.inspect('nope')).toBeUndefined();
  expect(await one.state('nope')).toBeUndefined();
  expect(await one.agents('nope')).toBeUndefined();
  expect(await one.owner('nope')).toBeUndefined();
});

// POSIX-only: the scripted ssh stands in for a Linux box by running the
// remote string with `/bin/sh` on this host.
it.skipIf(!posix)('reads what a box is using from its own /proc, and nothing when it cannot', async () => {
  /*
   * Fixed text, so the two readings and the sums between them are this test's
   * own: two cores' worth of jiffies, then the memory, then the count.
   */
  const fixed = [
    STATS.marks.cpu, 'cpu  0 0 0 0 0 0 0 0 0 0',
    STATS.marks.cpu, 'cpu  100 0 100 200 0 0 0 0 0 0',
    STATS.marks.mem, 'MemTotal:       1000000 kB', 'MemAvailable:    250000 kB', 'MemFree:         100000 kB',
    STATS.marks.cores, '2',
  ].join('\n');

  // Half the box's time between the two readings was not idle, and three
  // quarters of its memory is not available.
  expect(statsFrom(fixed)).toEqual({
    cpu: { percent: 50, cores: 2 },
    memory: { used: 768000000, limit: 1024000000, percent: 75 },
  });

  // A box with no `/proc` answers a command that failed, and a reading of
  // nothing is not the same as a box that is idle.
  expect(statsFrom('sh: head: not found')).toBeUndefined();
  expect(statsFrom(`${STATS.marks.cpu}\ncpu  0 0 0 0 0 0 0 0 0 0`)).toBeUndefined();

  /*
   * The whole road, where this host is a box the probe can read: the scripted
   * ssh runs the probe here, so what comes back is this host's own `/proc`.
   * What is compared is the reading the probe itself gives, because a usage
   * percentage is a difference between two moments and the memory and the core
   * count are not - and where there is no `/proc` at all, neither road has a
   * reading and there is nothing to compare.
   */
  const one = boxes({ dev02: { destination: 'dev02' } });
  const mine = statsFrom(spawnSync('/bin/sh', ['-c', STATS.probe], { encoding: 'utf8' }).stdout);
  const held = await one.stats('dev02');
  expect(held?.memory.limit).toBe(mine?.memory.limit);
  expect(held?.cpu.cores).toBe(mine?.cpu.cores);
  // And the command that ran is the probe, so a box is asked its own numbers
  // rather than anything this host already knew.
  expect(recorded()[0]?.at(-1)).toBe(STATS.probe);
  // A box that did not answer has no reading at all.
  expect(await boxes({ web1: { destination: 'web1' } }, { SSH_FAKE_UNREACHABLE: 'web1' }).stats('web1')).toBeUndefined();
});

// POSIX-only: the scripted ssh stands in for a Linux box by running the
// remote string with `/bin/sh` on this host.
it.skipIf(!posix)('quotes a remote word so the box reads back what the caller wrote', () => {
  /*
   * The remote command is one string the box's login shell parses, so a word
   * that is not quoted is a word the box runs. Each of these is read back by a
   * real shell rather than compared to a string this test wrote.
   */
  const words = ['plain', 'a b', "it's", '$(echo pwned)', '`date`', 'a; b', 'two\nlines', 'x"y', '#no', ''];
  for (const word of words) {
    const read = spawnSync('/bin/sh', ['-c', `printf '%s' ${quote(word)}`], { encoding: 'utf8' });
    expect(read.stdout).toBe(word);
  }

  // And the quoting itself, for the one character that has to leave its quotes:
  // a quote inside is closed, escaped and opened again.
  expect(quote(`it's`)).toBe(`'it'\\''s'`);
  expect(quote('a b')).toBe(`'a b'`);
  expect(quote('')).toBe(`''`);
  // Nothing of the shell is left standing in an unquoted word, which is what
  // the quotes above are for.
  expect(spawnSync('/bin/sh', ['-c', 'printf %s $(echo pwned); printf %s `date`'], { encoding: 'utf8' }).stdout)
    .not.toContain('$(echo pwned)');
});

it('refuses to make, start, stop or remove a box, and says what it can do', async () => {
  const one = boxes({ dev02: { destination: 'dev02' } });
  const said = /listed in this host's options, not made by this host/;

  await expect(one.run({ name: 'dev02', image: '', label: 'ahpd.computer=1' })).rejects.toThrow(said);
  await expect(one.start('dev02')).rejects.toThrow(said);
  await expect(one.stop('dev02')).rejects.toThrow(said);
  await expect(one.restart('dev02')).rejects.toThrow(said);
  await expect(one.remove('dev02')).rejects.toThrow(said);
  // Nothing was run to find that out: not starting a box is not a command.
  expect(existsSync(log())).toBe(false);

  expect(one.capabilities()).toEqual({ runtime: 'ssh', actions: ['exec'], resources: ['status', 'capabilities', 'stats', 'server'] });
  expect(one.kind).toBe('ssh');
  // A box is another host, so a backend's process there is reached over a
  // connection rather than by a command on this one.
  expect(one.remote).toBe(true);

  // And the verbs that would mean this host had made the machine: nothing to
  // fetch back, and an image is not something a box is built from.
  expect(await one.bringBack('dev02')).toBeUndefined();
  await one.follow('dev02');
  expect(await one.hasImage('dev02')).toBe(false);
  await expect(one.putIn('dev02', ['/tmp/a'])).rejects.toThrow(/not written onto it/);
  await expect(one.takeOut('dev02', ['/tmp/a', '/tmp/b'])).rejects.toThrow(/not removed from it/);
});

/*
 * The plugin: the box in the `computer:` scheme, and the up time it is charged
 * for. The `docker` is scripted too, so a listing is this plugin's own runtimes
 * and nothing else on this host.
 */

/** The store in memory, so a test can read what the plugin wrote. */
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

/** What a load is given: the meter, the fixture's environment, and a vault. */
interface Given {
  usage?: Usage;
  env?: Record<string, string>;
  /** The agents this host serves, when the case needs an agent of its own. */
  agents?: Agent[];
  /** The vault a machine's vault-named needs are read from. */
  vault?: Vault;
}

const base = (given: Given = {}): HostOptions => ({
  path: '/tmp/computer-ssh',
  hostName: 'box.local',
  agents: given.agents ?? [{ ...echo({ path: '/tmp/computer-ssh', pace: 0 }), provider: 'base', displayName: 'Base backend' }],
  resources: fileResources(),
  ...(given.usage === undefined ? {} : { usage: given.usage }),
  ...(given.vault === undefined ? {} : { vault: given.vault }),
});

/**
 * The plugin as loaded, over the two scripted programs.
 *
 * The ssh option names the program the same way the plugin's own does, so both
 * fixtures are reached without a `docker` or an `ssh` installed.
 */
const load = async (more: Record<string, unknown>, given: Given = {}) => {
  const dir = temp();
  const result = await loadPlugins(
    [{
      name: SOURCE,
      options: {
        command: process.execPath,
        args: [DOCKER_FIXTURE],
        env: { DOCKER_FAKE_STATE: join(dir, 'docker.json'), SSH_FAKE_LOG: log(), ...(given.env ?? {}) },
        ssh: { command: process.execPath, args: [FIXTURE], ...more },
      },
    }],
    { base: base(given), configDir: stateDir(), cwd: REPO, log: () => {} },
  );
  keeping(result.options);
  return result;
};

/** The provider as this host serves it, which is where a listing and a state write go. */
const providerOf = (options: HostOptions) => options.resourceProviders?.computer as {
  list(uri: string): Promise<{ name: string; type: string }[]>;
  write(uri: string, content: { data: string; encoding: string }, owner?: string): Promise<void>;
};

const said = (body: string) => ({ data: body, encoding: 'utf-8' });

/** When these tests' listings happen. */
const at = new Date('2026-10-02T12:00:00.000Z');

it('serves a box in the computer: scheme, and refuses to put it in a state', async () => {
  const { options, problems } = await load({ machines: { dev02: { destination: 'dev02', port: '2229' } } });
  expect(problems).toEqual([]);

  // The id is the one the ssh runtime spells, so a session naming this box
  // names it the way the runtime listing it does.
  const provider = providerOf(options);
  expect(await provider.list('computer://')).toEqual([{ name: 'ssh.dev02', type: 'directory' }]);

  // A box is not this host's to start, stop or remove, and the write says so
  // in the runtime's own sentence rather than doing something else.
  await expect(provider.write('computer://ssh.dev02/state', said('stopped'))).rejects
    .toThrow(/an ssh machine is listed in this host's options, not made by this host/);

  // A machine that is not configured is not in the scheme at all.
  await expect(provider.list('computer://ssh.web1')).rejects.toThrow(/No computer resource at computer:\/\/ssh.web1/);
});

it('lists a server leaf under a box, and answers the check there with its fixes', async () => {
  const check = join(temp(), 'check.txt');
  writeFileSync(check, 'os_id=debian\nos_name=Debian GNU/Linux 13 (trixie)\narch=x86_64\nuser=softov\n');
  const { options, problems } = await load(
    { machines: { dev02: { destination: 'dev02' } } },
    { env: { SSH_FAKE_CHECK: check } },
  );
  expect(problems).toEqual([]);
  const provider = providerOf(options) as ReturnType<typeof providerOf> & {
    read(uri: string): Promise<{ data: string }>;
  };

  expect((await provider.list('computer://ssh.dev02')).map((one) => one.name)).toContain('server');
  const report = JSON.parse((await provider.read('computer://ssh.dev02/server')).data) as {
    items: Record<string, { ok: boolean; fix: string[] }>;
  };
  expect(report.items.os?.ok).toBe(true);
  expect(report.items.docker).toEqual({ ok: false, found: 'not installed', fix: [
    'sudo apt install docker.io',
    'sudo usermod -aG docker softov',
    '# log in to the box again, so the new group applies',
  ] });
});

it('lists no server leaf for a machine of a runtime that has no check', () => {
  // A runtime whose machines are made here, which has neither verb.
  const made = boxes({});
  delete made.check;
  delete made.checks;
  const runtime = routed({
    docker: made,
    ssh: boxes({ dev02: { destination: 'dev02' } }),
  }, 'docker');
  expect(runtime.checks?.('ssh.dev02')).toBe(true);
  expect(runtime.checks?.('box')).toBe(false);
  expect(runtime.checks?.('ssh.web1')).toBe(false);
});

it('refuses the check of a box that never answers once the bound is past', async () => {
  // A program that takes the ssh call and never ends, which is a box that
  // accepted the connection and then hung.
  const runtime = sshRuntime({
    command: process.execPath,
    args: ['-e', 'setTimeout(() => {}, 1e9)'],
    machines: { dev02: { destination: 'dev02' } },
    connectTimeout: 0,
  });
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const asked = runtime.check?.('dev02');
  const failed = expect(asked).rejects.toThrow('dev02 did not answer the server check within 20000ms');
  await vi.advanceTimersByTimeAsync(20_001);
  await failed;
});

// POSIX-only: the scripted ssh stands in for a Linux box by running the
// remote string with `/bin/sh` on this host.
it.skipIf(!posix)('charges the host for a box a listing found up and a later one found gone', async () => {
  const gone = join(temp(), 'gone');
  // The box is not reachable to begin with: a listing that finds nothing up
  // opens no stretch and writes nothing.
  writeFileSync(gone, 'dev02\n');
  const usage = meter();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at);
  const { options, problems } = await load(
    { machines: { dev02: { destination: 'dev02', port: '2229' } } },
    { usage, env: { SSH_FAKE_UNREACHABLE_FILE: gone } },
  );
  expect(problems).toEqual([]);

  /*
   * The startup listing is the one listing a test cannot await, and it is the
   * port's `enter` that waits for it - which is what leaves the two listings
   * below as the only ones that move the meter.
   */
  await options.computers?.enter?.('ssh.dev02', 'session://probe');
  expect(usage.entries).toEqual([]);

  // The listing that finds the box up opens the stretch, and the one that finds
  // it gone writes it: nobody here made the box, so the host pays.
  const provider = providerOf(options);
  const up = new Date(at.getTime() + 300_000);
  vi.setSystemTime(up);
  writeFileSync(gone, '');
  expect(await provider.list('computer://')).toEqual([{ name: 'ssh.dev02', type: 'directory' }]);
  expect(usage.entries).toEqual([]);

  vi.setSystemTime(new Date(at.getTime() + 600_000));
  writeFileSync(gone, 'dev02\n');
  await provider.list('computer://');
  expect(usage.entries).toEqual([{
    kind: 'computer',
    source: 'computer',
    at: up.toISOString(),
    seconds: 300,
    computer: 'ssh.dev02',
    owner: 'root:box.local',
    pools: ['root:box.local'],
  }]);
  // One stretch, not one per listing: the box was up the whole time between the
  // two, and a third listing that finds it gone writes nothing more.
  await provider.list('computer://');
  expect(usage.entries).toHaveLength(1);
});

/*
 * The interval the boxes are checked on, which the plugin owns rather than the
 * runtime: set, every box is reached that often, and unset, only a listing
 * reaches one.
 */

// POSIX-only: the scripted ssh stands in for a Linux box by running the
// remote string with `/bin/sh` on this host.
it.skipIf(!posix)('checks a box on a timer when the operator asked for an interval', async () => {
  const gone = join(temp(), 'gone');
  writeFileSync(gone, 'dev02\n');
  const usage = meter();
  /*
   * Both the clock and the interval, so the moments a check happened at are
   * this test's own rather than however long a subprocess took. `setTimeout` is
   * left real, which is what waits for one.
   */
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(at);
  const { options, contributions, problems } = await load(
    { machines: { dev02: { destination: 'dev02', port: '2229' } }, pollSeconds: 300 },
    { usage, env: { SSH_FAKE_UNREACHABLE_FILE: gone } },
  );
  expect(problems).toEqual([]);

  // The startup listing is the one listing a test cannot await, and the port's
  // `enter` is what waits for it. The box was down, so nothing is open.
  await options.computers?.enter?.('ssh.dev02', 'session://probe');
  const startup = recorded().length;
  expect(startup).toBe(1);
  expect(usage.entries).toEqual([]);

  /*
   * The box comes up, and the check an interval later is the one that finds it:
   * no client listed in between, so the meter moves only because the operator
   * asked for an interval. The clock is moved by the interval itself, which is
   * what puts the check's own moment at the far end of it: the plugin reads the
   * clock when the answer to a check arrives, and a subprocess answers long
   * after the step that asked for it.
   */
  writeFileSync(gone, '');
  vi.advanceTimersByTime(300_000);
  await until(() => recorded().length > startup);
  // A check is a real `ssh`, and this waits for its answer to arrive.
  await wait(400);
  expect(recorded().length).toBe(startup + 1);
  expect(recorded().at(-1)?.at(-1)).toBe('true');

  // What the check opened is what the daemon reads on its way down: one
  // stretch, under the id a caller holds rather than the box's own name, as
  // long as the interval, and charged to the host.
  const up = new Date(at.getTime() + 300_000);
  vi.setSystemTime(new Date(at.getTime() + 600_000));
  await raise(contributions[0]?.events, { type: 'stopping' });
  expect(usage.entries.map((one) => [one.computer, one.at, one.kind === 'computer' ? one.seconds : -1, one.owner])).toEqual([
    ['ssh.dev02', up.toISOString(), 300, 'root:box.local'],
  ]);
});

it('reaches no box between two listings when no interval was asked for', async () => {
  const usage = meter();
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(at);
  const { options, problems } = await load(
    { machines: { dev02: { destination: 'dev02', port: '2229' } } },
    { usage },
  );
  expect(problems).toEqual([]);
  await options.computers?.enter?.('ssh.dev02', 'session://probe');

  /*
   * The startup listing is the whole of what has been reached, and an hour of
   * the clock goes by with nothing reaching the box: a box's up time is what the
   * moments a client listed saw, and a host that reached one on its own would be
   * charging for time nobody asked it to watch.
   */
  const startup = recorded().length;
  expect(startup).toBeGreaterThan(0);
  vi.advanceTimersByTime(3_600_000);
  await wait(200);
  expect(recorded().length).toBe(startup);
  expect(usage.entries).toEqual([]);
});

it('stops checking the boxes when the plugin is closed', async () => {
  const usage = meter();
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(at);
  const { options, problems } = await load(
    { machines: { dev02: { destination: 'dev02', port: '2229' } }, pollSeconds: 300 },
    { usage },
  );
  expect(problems).toEqual([]);
  await options.computers?.enter?.('ssh.dev02', 'session://probe');
  const startup = recorded().length;

  // One check, which is what says the timer was armed at all.
  vi.advanceTimersByTime(300_000);
  await until(() => recorded().length > startup);
  await wait(400);
  const before = recorded().length;

  /*
   * Closed, and no check follows: a timer left armed reaches every box for the
   * rest of the process's life, which is the work this close exists to stop.
   * The closer is the plugin's own, and it is what the daemon runs on its way
   * down, so what is closed here is the same thing a stopped daemon closes.
   */
  await closeAll();
  vi.advanceTimersByTime(3_600_000);
  await wait(200);
  expect(recorded().length).toBe(before);
});

/*
 * A command, a session and a secret: what reaches a box, and what does not.
 */

it('writes the box own directory and the variables into the remote command, and never this host path', async () => {
  // A directory that is there, because the scripted ssh runs the remote string
  // on this host.
  const work = join(temp(), 'srv-app');
  mkdirSync(work);
  const one = boxes({ dev02: { destination: 'dev02', port: '2229', workdir: work } });

  const spawn = await one.how('dev02', {
    command: 'echo',
    args: ['hi'],
    // A path on this host, which is not one on the box: the box's own directory
    // is what its command starts in.
    cwd: '/home/me/repo',
    env: { A: '1', B: 'two words' },
  });

  // One string is the whole of what the box runs, and the box's address is
  // everything before it, as ssh spells it.
  expect(spawn?.args.at(-1)).toBe(`cd '${work}' && env 'A=1' 'B=two words' 'echo' 'hi'`);
  expect(spawn?.args.slice(1, -1)).toEqual(['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=30', '-p', '2229', 'dev02', '--']);
  expect(spawn?.args.join(' ')).not.toContain('/home/me/repo');

  // A box with no directory of its own keeps the login directory, and a name
  // this host does not serve is nothing to run anywhere.
  const bare = boxes({ web1: { destination: 'web1' } });
  expect((await bare.how('web1', { command: 'pwd' }))?.args.at(-1)).toBe(`'pwd'`);
  expect(await one.how('nope', { command: 'pwd' })).toBeUndefined();
});

/** The variable one of these agents needs, and the secret its value is read from. */
const BOX_TOKEN = 'BOX_TOKEN';
const HOST_TOKEN = 'host:box-token';
const SECRET = 'sekrit-value';

/** An agent that declares one environment need, whose value is the vault's. */
const vaultedAgent = {
  provider: 'vaulted',
  displayName: 'Vaulted backend',
  schema: () => ({}),
  defaults: () => ({}),
  machine: (): Record<string, MachineNeed> => ({ boxToken: { name: BOX_TOKEN, default: { $secret: HOST_TOKEN } } }),
  create: () => { throw new Error('not started in this test'); },
} as unknown as Agent;

/** A vault holding `values` and nothing else. */
const holding = (values: Record<string, string>): Vault => ({
  get: async (name) => values[name],
  set: async () => {},
  delete: async () => false,
  list: async () => Object.keys(values),
});

/** A load with one box, which starts the ahpd on its PATH, and an agent whose need is the vault's. */
const vaultedLoad = () => load(
  { machines: { dev02: { destination: 'dev02', agents: ['vaulted'], host: ['ahpd'] } } },
  { agents: [vaultedAgent], vault: holding({ [HOST_TOKEN]: SECRET }) },
);

it('starts a host in the box with the plugins it was asked for, and nothing of this host vault', async () => {
  const { options, problems } = await vaultedLoad();
  expect(problems).toEqual([]);

  const spawn = await options.computers?.nested?.('ssh.dev02', { plugins: ['@ahpd/agent-cofold'] });
  expect(spawn?.args.at(-1)).toBe(`'ahpd' '--stdio' '--no-plugins' '--plugin' '@ahpd/agent-cofold'`);
  // No environment at all: the ahpd on the box holds what it was given by hand
  // there, and a value from the vault would be written into this very command.
  expect(spawn?.env).toBeUndefined();
  expect(spawn?.workingDirectory).toBeUndefined();
  expect(JSON.stringify(recorded())).not.toContain(SECRET);
});

it('hands a box the record of a record agent without its secret fields', async () => {
  const { options } = await vaultedLoad();
  const whole = { id: 'cofold', engine: 'cofold', owner: 'host' as const, name: 'Cofold', config: { endpoint: 'https://or.example', apiKey: SECRET } };
  const bare = { ...whole, config: { endpoint: 'https://or.example' } };

  const spawn = await options.computers?.nested?.('ssh.dev02', { plugins: ['@ahpd/agent-cofold'], record: { whole, bare } });
  // The remote command is the box's whole environment, so it carries the
  // copy with no secret field, and the box's ahpd holds its own key.
  expect(spawn?.args.at(-1)).toContain(`'AHPD_AGENT_RECORD=${JSON.stringify(bare)}'`);
  expect(spawn?.args.join(' ')).not.toContain(SECRET);
  expect(JSON.stringify(spawn)).not.toContain('apiKey');
});

it('says which machines are off this host, so a session in one runs nested', async () => {
  const { options } = await load({ machines: { dev02: { destination: 'dev02' } } });

  // The runtime that serves the id answers: a box is off this host, and a
  // machine this host makes machines on is not.
  expect(options.computers?.remote?.('ssh.dev02')).toBe(true);
  expect(options.computers?.remote?.('box')).toBe(false);
});

/** An agent that needs the ahpd part, the way cofold and pi do in a machine of ours. */
const partAgent = {
  provider: 'parted',
  displayName: 'Parted backend',
  schema: () => ({}),
  defaults: () => ({}),
  machine: (): Record<string, MachineNeed> => ({ ahpd: { part: 'ahpd', required: true } }),
  create: () => { throw new Error('not started in this test'); },
} as unknown as Agent;

it('lets an agent that needs a part into a box, which brings its own ahpd', async () => {
  const { options, problems } = await load(
    { machines: { dev02: { destination: 'dev02' } } },
    { agents: [partAgent] },
  );
  expect(problems).toEqual([]);

  // A part is an image mounted when a machine is made, and a box is never made,
  // so reading its missing parts from a record it does not have would refuse
  // every such agent on every box.
  expect(await options.computers?.partsMissing?.('ssh.dev02', 'parted')).toBeUndefined();
  expect(await machineRefusal(options.computers, 'ssh.dev02', 'parted', 'parted:/one')).toBeUndefined();
});

it('refuses a command in the box when a value there is the vault own, and writes none of it', async () => {
  const { options, problems } = await vaultedLoad();
  expect(problems).toEqual([]);

  // The one check both roads go through: a command a tool runs, and the
  // descriptor a terminal or a backend spawning into the machine is given.
  const tool = (options.tools ?? []).find((one) => one.definition.name === 'run_in_computer') as HostTool;
  await expect(tool.run({ id: 'ssh.dev02', command: 'env' }, hostCall({ provider: 'vaulted' })))
    .rejects.toThrow(new RegExp(`ssh.dev02 is off this host, and ${BOX_TOKEN} comes from the vault`));
  await expect(options.computers?.how('ssh.dev02', { command: 'env', provider: 'vaulted' }))
    .rejects.toThrow(/a command over ssh carries its variables in the remote command/);

  // The sentence names the need and not what it holds, and nothing was written:
  // every call the box was given is the question whether it is up.
  expect(recorded().length).toBeGreaterThan(0);
  expect(recorded().every((one) => one.at(-1) === 'true')).toBe(true);
  expect(JSON.stringify(recorded())).not.toContain(SECRET);
});

it('reaches a made machine through a jump, with a known-hosts file of its own', () => {
  const reach = sshReach({}, {
    destination: 'ahpd@192.168.122.40',
    identity: '/config/computer-ssh/id_ed25519',
    jump: 'dev02',
    knownHosts: '/config/computer-ssh/known_hosts',
  });

  // A new host key is accepted into the file of its own, unhashed so its
  // address can be removed again; the jump is reached with the person's own
  // configuration.
  expect(reach.argv('true')).toEqual([
    '-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=30',
    '-o', 'StrictHostKeyChecking=accept-new', '-o', 'UserKnownHostsFile=/config/computer-ssh/known_hosts', '-o', 'HashKnownHosts=no',
    '-J', 'dev02',
    '-i', '/config/computer-ssh/id_ed25519',
    'ahpd@192.168.122.40', '--', 'true',
  ]);
  // A box an operator wrote has neither.
  expect(sshReach({}, { destination: 'dev02', port: '2229' }).argv('true'))
    .toEqual(['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=30', '-p', '2229', 'dev02', '--', 'true']);
});

it('makes the machine key once, however many machines ask for it at once', async () => {
  const config = (home ??= mkdtempSync(join(tmpdir(), 'ahpd-ssh-config-')));
  const calls = join(config, 'keygen.jsonl');
  const keygen = keygenWith(process.execPath, [KEYGEN_FIXTURE]);
  process.env.SSH_KEYGEN_FAKE_LOG = calls;
  try {
    const [one, two] = await Promise.all([machineKey(config, keygen), machineKey(config, keygen)]);
    const three = await machineKey(config, keygen);

    expect(one).toEqual({
      private: join(config, 'computer-ssh', 'id_ed25519'),
      public: join(config, 'computer-ssh', 'id_ed25519.pub'),
      knownHosts: join(config, 'computer-ssh', 'known_hosts'),
    });
    expect(two).toEqual(one);
    expect(three).toEqual(one);
    expect(readFileSync(one.public, 'utf8')).toMatch(/^ssh-ed25519 /);
    // One run, with no passphrase: a daemon has nobody to type one.
    expect(readFileSync(calls, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as string[])).toEqual([
      ['-q', '-t', 'ed25519', '-N', '', '-C', 'ahpd-computer', '-f', one.private],
    ]);
  } finally {
    delete process.env.SSH_KEYGEN_FAKE_LOG;
  }
});

it('forgets a removed machine address, so the next machine given it is not refused', async () => {
  const config = (home ??= mkdtempSync(join(tmpdir(), 'ahpd-ssh-config-')));
  const keygen = keygenWith(process.execPath, [KEYGEN_FIXTURE]);
  // No file yet is no address to forget, and nothing is run.
  await forgetHost(config, '192.168.122.40', async () => { throw new Error('run with no file'); });

  const { knownHosts } = await machineKey(config, keygen);
  writeFileSync(knownHosts, '192.168.122.40 ssh-ed25519 AAAAold\n192.168.122.41 ssh-ed25519 AAAAother\n');
  await forgetHost(config, '192.168.122.40', keygen);

  expect(readFileSync(knownHosts, 'utf8')).toBe('192.168.122.41 ssh-ed25519 AAAAother\n');
});
