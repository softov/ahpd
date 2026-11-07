/**
 * `ahpd doctor`: the checks that say what is wrong on this machine, and how to
 * fix it.
 *
 * Each check reads one part of what a start needs - the runtime, the
 * configuration, the daemon, the service, the plugins, the agents and the
 * update - and gives one result: `ok`, `warn` or `fail`, one line, and the fix
 * for a warn or a fail. Every check is a lookup this repository already has:
 * `found.ts` for the runtimes and the agents, `loadConfig` for the files,
 * `running` for the record, `service.ts` for the unit, `describePlugin` for a
 * plugin without applying it, and `updateLine` for the newer release. Nothing
 * here starts a daemon or imports a plugin.
 *
 * A check has five seconds. The daemon check is the one that waits: it opens
 * the record's connect URL, which carries the token, so the URL is given to the
 * socket and is never put in a result. The same rule holds for a plugin: a spec
 * may carry a credential in its URL, so its line has the userinfo replaced.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { installLine, reason } from '@ahpd/sdk';
import type { PluginSpec, StoredRecord } from '@ahpd/sdk';
import { withoutUserinfoIn } from './commands/config.js';
import { asSpec, configDir, loadConfig } from './config.js';
import type { LoadedConfig } from './config.js';
import { running } from './daemon.js';
import type { Running } from './daemon.js';
import { configuredAgents, findAgents, findRuntimes, nodeRuns } from './found.js';
import { run as runProgram } from './install.js';
import type { Runner } from './install.js';
import type { OnPathLookup } from './onpath.js';
import { describePlugin } from './plugins.js';
import type { PluginRow } from './plugins.js';
import { fileRecords } from './records.js';
import { installFile, serviceOn } from './service.js';
import { updateLine } from './update.js';
import { manifest } from './version.js';

/** How long any one check may take, in milliseconds. */
export const CHECK_TIMEOUT_MS = 5000;

/** The checks, in the order `checks` runs them. */
const ORDER = ['Runtime', 'Config', 'Daemon', 'Service', 'Plugins', 'Agents', 'Update'] as const;

/** The name of one check. */
export type CheckName = (typeof ORDER)[number];

/** What one check found: one line, and the fix when something is wrong. */
export interface Check {
  /** Which check this is. */
  name: CheckName;
  /** Whether the thing it read is right, is a state a person may want to change, or is wrong. */
  result: 'ok' | 'warn' | 'fail';
  /** One line saying what was found. */
  line: string;
  /** What to do about it. Present on every `warn` and `fail`. */
  fix?: string;
}

/**
 * What a check is given.
 *
 * Every field has a real answer set by `realFacts`, and a test replaces the
 * ones it needs: a fake runner, a PATH under a temporary folder, a record, or a
 * socket that never opens. `version` is the runtime this process runs on, which
 * a test can name to show a runtime ahpd does not support.
 */
export interface DoctorFacts {
  /** How a program is run. */
  run: Runner;
  /** The PATH text to search. */
  path: string;
  /** The system the checks are for. Defaults to this one. */
  platform?: NodeJS.Platform;
  /** The version of the runtime running ahpd. Defaults to this process's. */
  version?: string;
  /** The daemon's record. Defaults to `running`. */
  record?(): Running | undefined;
  /** Open a WebSocket and settle when it opened. Defaults to `openSocket`. */
  open?(url: string): Promise<void>;
  /** Whether a file is there. Defaults to `existsSync`. */
  exists?(file: string): boolean;
  /** The configuration as it was read. Defaults to `loadConfig`. */
  config?(): LoadedConfig;
  /** This ahpd's name and version. Defaults to `manifest`. */
  self?(): { name: string; version: string };
}

/** The part of the WebSocket API the daemon check uses. */
interface Socket {
  onopen: (() => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
  close(): void;
}

/** The runtime's WebSocket client, which the types this project compiles against do not name. */
const socketClient = (): (new (url: string) => Socket) | undefined =>
  (globalThis as { WebSocket?: new (url: string) => Socket }).WebSocket;

/**
 * Wait for a WebSocket to open, and close it whether it did or not.
 *
 * The URL a daemon records carries the token, so it is given to the socket and
 * to nothing else. A socket that has not opened within `limitMs` is closed and
 * refused, because a check that left a connection behind would keep the
 * command running after the report.
 */
export const openSocket = (url: string, limitMs: number = CHECK_TIMEOUT_MS): Promise<void> => new Promise((done, fail) => {
  const Client = socketClient();
  if (Client === undefined) {
    fail(new Error('this runtime has no WebSocket client'));
    return;
  }
  const socket = new Client(url);
  let settled = false;
  let timer: NodeJS.Timeout | undefined;
  const finish = (error?: Error): void => {
    if (settled) return;
    settled = true;
    if (timer !== undefined) clearTimeout(timer);
    try {
      socket.close();
    }
    catch {
      // It was never open, which is what a close says too.
    }
    if (error === undefined) done();
    else fail(error);
  };
  timer = setTimeout(() => { finish(new Error(`it did not open within ${String(limitMs / 1000)} s`)); }, limitMs);
  socket.onopen = () => { finish(); };
  socket.onerror = () => { finish(new Error('the socket did not open')); };
  socket.onclose = () => { finish(new Error('the socket did not open')); };
});

/** Wait for `work`, or refuse after `limitMs`. The work is left running when it loses. */
const until = async (work: Promise<void>, limitMs: number, what: string): Promise<void> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      work,
      new Promise<void>((_done, fail) => {
        timer = setTimeout(() => { fail(new Error(`${what} did not finish within ${String(limitMs / 1000)} s`)); }, limitMs);
      }),
    ]);
  }
  finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

/** The configuration, read the way the daemon reads it. */
const configOf = (facts: DoctorFacts): LoadedConfig => (facts.config ?? loadConfig)();

/** The runtime ahpd runs on, and the other runtimes on PATH. */
export const runtimeCheck = async (facts: DoctorFacts): Promise<Check> => {
  const platform = facts.platform ?? process.platform;
  const version = facts.version ?? process.version;
  let lookup: OnPathLookup | undefined;
  try {
    lookup = configOf(facts).values.onPath;
  }
  catch {
    // A configuration that does not load is the Configuration check's line,
    // and the runtimes are looked up the default way meanwhile.
  }
  const runtimes = await findRuntimes({ run: facts.run, path: facts.path, platform, ...(lookup === undefined ? {} : { onPath: lookup }) });
  if (!nodeRuns(version)) {
    return {
      name: 'Runtime',
      result: 'fail',
      line: `Node ${version} does not run ahpd, which needs Node 22.18 or newer`,
      fix: 'install Node 22.18 or newer, and run ahpd with it',
    };
  }
  const node = runtimes.find((one) => one.name === 'node');
  if (node?.path !== undefined && node.version === undefined) {
    return {
      name: 'Runtime',
      result: 'warn',
      line: `Node ${version} runs ahpd, and ${node.path} did not answer --version`,
      fix: `run "${node.path} --version", and reinstall Node if it fails`,
    };
  }
  const others = runtimes
    .filter((one) => one.name !== 'node' && one.path !== undefined)
    .map((one) => `${one.name === 'bun' ? 'Bun' : 'Deno'} ${one.version ?? `at ${one.path}`}`);
  const also = others.length === 0 ? '' : `, and ${others.join(' and ')} ${others.length === 1 ? 'is' : 'are'} on PATH`;
  return { name: 'Runtime', result: 'ok', line: `Node ${version} runs ahpd${also}` };
};

/** The configuration files, and whether they parse. */
export const configCheck = (facts: DoctorFacts): Check => {
  try {
    const held = configOf(facts);
    if (held.warnings.length > 0) {
      return {
        name: 'Config',
        result: 'warn',
        line: held.warnings.join('; '),
        fix: 'rename the key the line names in the file it names',
      };
    }
    return {
      name: 'Config',
      result: 'ok',
      line: held.files.length === 0 ? 'no file is there, so the defaults are used' : `read ${held.files.join(', ')}`,
    };
  }
  catch (error) {
    return {
      name: 'Config',
      result: 'fail',
      line: reason(error),
      fix: 'fix the file the line names, or remove it to use the defaults',
    };
  }
};

/** The daemon the record names, and whether it answers. */
export const daemonCheck = async (facts: DoctorFacts): Promise<Check> => {
  const record = (facts.record ?? running)();
  if (record === undefined) {
    return { name: 'Daemon', result: 'warn', line: 'no daemon is running', fix: 'ahpd start' };
  }
  try {
    await until((facts.open ?? openSocket)(record.connectUrl), CHECK_TIMEOUT_MS, 'the daemon');
  }
  catch {
    return {
      name: 'Daemon',
      result: 'fail',
      line: `a daemon is recorded at ${record.url}, and it does not answer`,
      fix: 'ahpd restart',
    };
  }
  return { name: 'Daemon', result: 'ok', line: `a daemon answers at ${record.url}` };
};

/**
 * The service file for this system's manager, or nothing when it has none.
 *
 * The file of the service the configuration names, for a daemon that runs
 * beside another. A configuration that does not load names none, and the
 * plugin check is the one that says why.
 */
export const serviceCheck = (facts: DoctorFacts): Check | undefined => {
  const service = serviceOn(facts.platform ?? process.platform);
  if (service === undefined) return undefined;
  let name: string | undefined;
  try {
    name = configOf(facts).values.service?.name;
  }
  catch {
    name = undefined;
  }
  const file = installFile(service, name);
  const exists = facts.exists ?? existsSync;
  if (!exists(file)) {
    return { name: 'Service', result: 'warn', line: `no ${service} file is at ${file}`, fix: 'ahpd service install' };
  }
  return { name: 'Service', result: 'ok', line: `the ${service} file is at ${file}` };
};

/** Every plugin the configuration names, and whether it would load. */
export const pluginCheck = async (facts: DoctorFacts): Promise<Check> => {
  let plugins: PluginSpec[];
  try {
    plugins = configOf(facts).values.plugins ?? [];
  }
  catch (error) {
    return {
      name: 'Plugins',
      result: 'fail',
      line: `the configuration does not load: ${reason(error)}`,
      fix: 'fix the configuration, then run ahpd doctor again',
    };
  }
  if (plugins.length === 0) {
    return { name: 'Plugins', result: 'ok', line: 'no plugin is configured' };
  }
  const where = { configDir: configDir(), cwd: process.cwd() };
  const rows: PluginRow[] = [];
  for (const [index, entry] of plugins.entries()) {
    const spec = asSpec(entry);
    if (spec === undefined) {
      return {
        name: 'Plugins',
        result: 'fail',
        line: `plugin entry ${String(index + 1)} is not a package name or a path`,
        fix: 'write the entry as a string, or as an object with a source, in the configuration',
      };
    }
    rows.push(await describePlugin(spec, where));
  }
  const bad = rows.filter((row) => row.state !== 'ready' && row.state !== 'disabled');
  if (bad.length > 0) {
    return {
      name: 'Plugins',
      result: 'fail',
      line: withoutUserinfoIn(bad.map((row) => `${row.name}: ${row.problem ?? row.state}`).join('; ')),
      fix: 'install the plugin the line names, or remove it from the configuration',
    };
  }
  const off = rows.filter((row) => row.state === 'disabled').length;
  const live = rows.length - off;
  return {
    name: 'Plugins',
    result: 'ok',
    line: `${String(live)} ${live === 1 ? 'plugin loads' : 'plugins load'}${off === 0 ? '' : `, ${String(off)} turned off`}`,
  };
};

/** The agent records the daemon serves, from the folder and format `configure` writes. */
const agentRecords = async (): Promise<StoredRecord[]> => {
  const folder = join(configDir(), 'agents');
  // Opening a collection makes its folder, and a check must not write to the
  // configuration just because somebody asked what is wrong with it.
  if (!existsSync(folder)) return [];
  return (await fileRecords(configDir()).collection('agents', { format: 'json' })).list();
};

/** The agent commands on PATH, against the agents the configuration names. */
export const agentCheck = async (facts: DoctorFacts): Promise<Check> => {
  const platform = facts.platform ?? process.platform;
  let configured: Map<string, Record<string, unknown>>;
  let lookup: OnPathLookup | undefined;
  try {
    const values = configOf(facts).values;
    configured = configuredAgents(values.plugins, await agentRecords());
    lookup = values.onPath;
  }
  catch (error) {
    return {
      name: 'Agents',
      result: 'fail',
      line: `the configuration does not load: ${reason(error)}`,
      fix: 'fix the configuration, then run ahpd doctor again',
    };
  }
  // No version is asked: the line names none, and one probe per agent on PATH
  // takes longer than the check's limit.
  const found = await findAgents({ run: facts.run, path: facts.path, platform, versions: false, ...(lookup === undefined ? {} : { onPath: lookup }) }, configured);
  const missing = found.missing.filter((agent) => configured.has(agent.id));
  if (missing.length > 0) {
    return {
      name: 'Agents',
      result: 'fail',
      line: `configured and not on PATH: ${missing.map((agent) => agent.name).join(', ')}`,
      fix: missing.map((agent) => installLine(agent, platform) ?? agent.page ?? agent.site).join('; '),
    };
  }
  const loose = found.agents.filter((agent) => !agent.configured);
  if (loose.length > 0) {
    return {
      name: 'Agents',
      result: 'warn',
      line: `on PATH and not configured: ${loose.map((one) => one.agent.name).join(', ')}`,
      fix: 'ahpd configure',
    };
  }
  return {
    name: 'Agents',
    result: 'ok',
    line: found.agents.length === 0 ? 'no agent command was found on PATH' : 'every agent command on PATH is configured',
  };
};

/** The newer release the update file records, if there is one. */
export const updateCheck = (facts: DoctorFacts): Check => {
  const self = (facts.self ?? manifest)();
  const line = updateLine(self);
  if (line === undefined) {
    return { name: 'Update', result: 'ok', line: `no newer ${self.name} is on record` };
  }
  return { name: 'Update', result: 'warn', line: line.replace(/^update: /u, '').trim(), fix: 'ahpd update' };
};

/** One check under its limit. A check that is too slow is a `fail`, as one that stops is. */
const timed = async (name: CheckName, work: Promise<Check | undefined>): Promise<Check | undefined> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<Check>((done) => {
        timer = setTimeout(() => {
          done({
            name,
            result: 'fail',
            line: `the check did not finish within ${String(CHECK_TIMEOUT_MS / 1000)} s`,
            fix: 'run ahpd doctor again, and report it if the check is still slow',
          });
        }, CHECK_TIMEOUT_MS);
      }),
    ]);
  }
  catch (error) {
    return {
      name,
      result: 'fail',
      line: withoutUserinfoIn(`the check stopped: ${reason(error)}`),
      fix: 'run ahpd doctor again, and report it if the check stops again',
    };
  }
  finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

/** Every check, in the plan's order, each under its own limit. */
export const checks = async (facts: DoctorFacts = realFacts()): Promise<Check[]> => {
  const work: readonly (readonly [CheckName, () => Promise<Check | undefined>])[] = [
    ['Runtime', () => runtimeCheck(facts)],
    ['Config', () => Promise.resolve(configCheck(facts))],
    ['Daemon', () => daemonCheck(facts)],
    ['Service', () => Promise.resolve(serviceCheck(facts))],
    ['Plugins', () => pluginCheck(facts)],
    ['Agents', () => agentCheck(facts)],
    ['Update', () => Promise.resolve(updateCheck(facts))],
  ];
  const said: Check[] = [];
  for (const [name, one] of work) {
    // The check is started before its limit, so a socket it opens has its own
    // five seconds before the outer limit would take the result away.
    const check = await timed(name, one());
    if (check !== undefined) said.push(check);
  }
  return said;
};

/** What a real run is given: this process, this PATH and this configuration. */
export const realFacts = (): DoctorFacts => ({
  run: runProgram,
  path: process.env['PATH'] ?? '',
  platform: process.platform,
  version: process.version,
  record: running,
  open: openSocket,
  exists: existsSync,
  config: loadConfig,
  self: manifest,
});
