/**
 * What a setup finds on this machine: the runtimes and the agent commands.
 *
 * A command is looked up on PATH and then asked its version, so a person reads
 * what is there rather than what the documentation says should be. The same
 * lookup answers a machine that has none of them, which is why nothing here
 * throws on a missing command: an absent runtime or agent is a line to print,
 * not a reason to stop.
 *
 * Every program is run through the caller's `Runner`, which is what lets a test
 * answer versions without a single process. The version probe is asked to stop
 * after three seconds: some agents check for updates as they start, and one
 * that hangs must not hold up the setup. The real runner kills it; the caller's
 * runner is trusted to honour the same options.
 *
 * The agents a person already has are read here as plain data: an `acp` record
 * keeps the command and install lines a row is found by, and a preset a file
 * still holds is read by the plugin's package name. This file does not import
 * that package: the server may import `@ahpd/sdk` and not a package that runs an
 * agent, which is also why the rows themselves live in the sdk.
 */

import { installLine, knownAgents, type KnownAgent } from '@ahpd/sdk';
import type { StoredRecord } from '@ahpd/sdk';
import { asSpec } from './config.js';
import type { Runner } from './install.js';
import { onPath, type OnPathLookup } from './onpath.js';
import { isNamed } from './plugins.js';

/** The plugin every ACP agent runs through, which is what registers the engine they are records of. */
export const AGENT_PLUGIN = '@ahpd/agent-acp';

/** How long a `--version` may take before the process is stopped. */
export const VERSION_TIMEOUT_MS = 3000;

/** The runtimes a setup reports, in the order it reports them. */
const RUNTIMES = ['node', 'bun', 'deno'] as const;

/** One runtime, as this machine has it. */
export interface RuntimeFound {
  /** The program's name: `node`, `bun` or `deno`. */
  name: string;
  /** The full path on PATH, absent when it is not there. */
  path?: string;
  /** The first line of `--version`, absent when it could not be read. */
  version?: string;
}

/** One agent found on PATH. */
export interface AgentFound {
  /** The shipped row, with this agent's own command, install and page over it. */
  agent: KnownAgent;
  /** The full path on PATH. */
  path: string;
  /** The first line of `--version`, absent when it failed or timed out. */
  version?: string;
  /** Whether this host already has an agent of this id, as a record or a preset. */
  configured: boolean;
}

/** A `claude` or `pi` found beside the ACP agents, shown as information. */
export interface AlsoFound {
  /** The command's name, which is what was looked up. */
  name: string;
  /** The full path on PATH. */
  path: string;
  /** The first line of `--version`, absent when it could not be read. */
  version?: string;
}

/** What one search of PATH found. */
export interface AgentsFound {
  /** The known agents whose commands are on PATH. */
  agents: AgentFound[];
  /** The known agents whose commands are not, with the lines that install them. */
  missing: KnownAgent[];
}

/** What a search is given. */
export interface Search {
  /** How a program is run. */
  run: Runner;
  /** The PATH text to search. */
  path: string;
  /** The system the extensions and install lines are for. Defaults to this one. */
  platform?: NodeJS.Platform;
  /** Whether each agent command found is asked its `--version`. Defaults to true. */
  versions?: boolean;
  /** Which lookup finds a command, as the daemon's `onPath` setting names it. Defaults to `runnable`. */
  onPath?: OnPathLookup;
}

/** The first non-empty line of a program's output. */
const firstLine = (text: string): string | undefined => {
  const line = (text.split(/\r?\n/u)[0] ?? '').trim();
  return line === '' ? undefined : line;
};

/** A program's version, or nothing when it failed or was stopped. */
const versionOf = async (program: string, run: Runner): Promise<string | undefined> => {
  try {
    const done = await run(program, ['--version'], { timeoutMs: VERSION_TIMEOUT_MS, capture: true });
    return done.code === 0 ? firstLine(done.stdout) : undefined;
  }
  catch {
    // A runner that could not start the program is the same answer as one
    // whose program said nothing: the row shows the path instead.
    return undefined;
  }
};

/** Whether a Node version is one ahpd runs on. A version that cannot be read is not. */
export const nodeRuns = (version: string | undefined): boolean => {
  const read = /^v?(\d+)\.(\d+)/u.exec(version ?? '');
  if (read === null) return false;
  const major = Number(read[1]);
  const minor = Number(read[2]);
  return major > 22 || (major === 22 && minor >= 18);
};

/** The runtime lines a setup prints, in the order `findRuntimes` answers them. */
export const runtimeLines = (runtimes: readonly RuntimeFound[]): string[] => runtimes.map((runtime) => {
  const name = runtime.name === 'node' ? 'Node' : runtime.name === 'bun' ? 'Bun' : 'Deno';
  if (runtime.path === undefined) return `${name} not found`;
  if (runtime.version === undefined) return `${name} at ${runtime.path} (could not read its version)`;
  if (runtime.name === 'node') {
    return nodeRuns(runtime.version)
      ? `${name} ${runtime.version} (runs ahpd)`
      : `${name} ${runtime.version} (ahpd does not run on it; it needs Node 22.18 or newer)`;
  }
  if (runtime.name === 'deno') return `${name} ${runtime.version} (runs ahpd; each plugin it loads needs an npm: spec)`;
  return `${name} ${runtime.version} (runs ahpd)`;
});

/** The version of `node`, `bun` and `deno`, each with its path when it is there. */
export const findRuntimes = async (search: Search): Promise<RuntimeFound[]> => {
  const platform = search.platform ?? process.platform;
  const found: RuntimeFound[] = [];
  for (const name of RUNTIMES) {
    const path = onPath(name, search.path, platform, process.env, search.onPath);
    if (path === undefined) {
      found.push({ name });
      continue;
    }
    const version = await versionOf(path, search.run);
    found.push({ name, path, ...(version === undefined ? {} : { version }) });
  }
  return found;
};

/** A person's `install` block, with only the keys that hold a line. */
const installOf = (held: unknown): KnownAgent['install'] | undefined => {
  if (typeof held !== 'object' || held === null || Array.isArray(held)) return undefined;
  const block = held as Record<string, unknown>;
  const install: NonNullable<KnownAgent['install']> = {};
  for (const key of ['all', 'linux', 'darwin', 'win32'] as const) {
    const line = block[key];
    if (typeof line === 'string' && line !== '') install[key] = line;
  }
  return Object.keys(install).length === 0 ? undefined : install;
};

/** One agent's own command, install lines and page, over the row's. */
const withRecord = (agent: KnownAgent, config: Record<string, unknown>): KnownAgent => {
  const command = typeof config['command'] === 'string' && config['command'] !== '' ? config['command'] : agent.command;
  const install = installOf(config['install']) ?? agent.install;
  const page = typeof config['page'] === 'string' && config['page'] !== '' ? config['page'] : agent.page;
  return {
    ...agent,
    command,
    ...(install === undefined ? {} : { install }),
    ...(page === undefined ? {} : { page }),
  };
};

/** Whether a file's plugin list names this package, however it is written. */
const namesPlugin = (plugins: unknown, name: string): boolean => Array.isArray(plugins)
  && plugins.map(asSpec).some((spec) => spec !== undefined && isNamed(spec, name));

/** The presets a file still holds for `@ahpd/agent-acp`, by id. */
const presetsIn = (plugins: unknown): Map<string, Record<string, unknown>> => {
  const presets = new Map<string, Record<string, unknown>>();
  if (!Array.isArray(plugins)) return presets;
  const entry = plugins
    .map(asSpec)
    .find((spec) => spec !== undefined && isNamed(spec, AGENT_PLUGIN));
  if (typeof entry !== 'object') return presets;
  const held = entry.options?.['presets'];
  if (typeof held !== 'object' || held === null || Array.isArray(held)) return presets;
  for (const [id, value] of Object.entries(held)) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) presets.set(id, value as Record<string, unknown>);
  }
  return presets;
};

/**
 * The agents this host already has, by id: every `acp` record, and a preset the
 * file still holds for an id no record names.
 *
 * The record wins, because it is what the daemon serves. A preset is read only
 * until the start that moves it to a record, so a setup run between an upgrade
 * and that start shows the agents the file says it has rather than offering
 * every one of them again.
 *
 * A record is only served when the plugin that registers its engine is in the
 * list, so a record left behind by a setup that stopped before writing the file
 * is not shown as configured: the question that adds the plugin is asked again.
 */
export const configuredAgents = (
  plugins: unknown,
  records: readonly StoredRecord[],
): Map<string, Record<string, unknown>> => {
  const found = presetsIn(plugins);
  if (!namesPlugin(plugins, AGENT_PLUGIN)) return found;
  for (const one of records) {
    if (one.engine !== 'acp') continue;
    const config = one.config;
    found.set(one.id, typeof config === 'object' && config !== null && !Array.isArray(config) ? config as Record<string, unknown> : {});
  }
  return found;
};

/**
 * Every known agent, with the ones on PATH and the ones that are not.
 *
 * `configured` is `configuredAgents`, read before any question so an agent this
 * host already has is shown as configured rather than offered again.
 */
export const findAgents = async (search: Search, configured: ReadonlyMap<string, Record<string, unknown>>): Promise<AgentsFound> => {
  const platform = search.platform ?? process.platform;
  const agents: AgentFound[] = [];
  const missing: KnownAgent[] = [];
  for (const row of Object.values(knownAgents)) {
    const config = configured.get(row.id);
    const agent = config === undefined ? row : withRecord(row, config);
    const path = onPath(agent.command, search.path, platform, process.env, search.onPath);
    if (path === undefined) {
      missing.push(agent);
      continue;
    }
    const version = search.versions === false ? undefined : await versionOf(path, search.run);
    agents.push({
      agent,
      path,
      configured: config !== undefined,
      ...(version === undefined ? {} : { version }),
    });
  }
  return { agents, missing };
};

/** A `claude` or a `pi` on PATH, which is information rather than an ACP agent. */
export const findAlso = async (search: Search): Promise<AlsoFound[]> => {
  const platform = search.platform ?? process.platform;
  const found: AlsoFound[] = [];
  for (const name of ['claude', 'pi'] as const) {
    const path = onPath(name, search.path, platform, process.env, search.onPath);
    if (path === undefined) continue;
    const version = await versionOf(path, search.run);
    found.push({ name, path, ...(version === undefined ? {} : { version }) });
  }
  return found;
};

/** The table of agents found, with the version or the path and whether each is configured. */
export const agentLines = (agents: readonly AgentFound[]): string[] => {
  if (agents.length === 0) return [];
  const width = Math.max(...agents.map((one) => one.agent.name.length));
  return [
    'Agents found:',
    ...agents.map((one) => {
      const where = one.version ?? `at ${one.path}`;
      const state = one.configured ? 'configured' : 'not configured';
      return `  ${one.agent.name.padEnd(width)} ${where} (${state}, ${AGENT_PLUGIN})`;
    }),
  ];
};

/** The `claude` and `pi` lines, which change no question. */
export const alsoLines = (also: readonly AlsoFound[]): string[] => {
  if (also.length === 0) return [];
  return ['Also found:', ...also.map((one) => `  ${one.name} ${one.version ?? `at ${one.path}`}`)];
};

/** Each agent that is not installed, with the line for this system, its page, or its site. */
export const missingLines = (missing: readonly KnownAgent[], platform: NodeJS.Platform): string[] => {
  if (missing.length === 0) return [];
  return [
    'Agents not found:',
    ...missing.map((agent) => {
      const line = installLine(agent, platform) ?? agent.page ?? agent.site;
      return `  ${agent.name}: ${line}`;
    }),
  ];
};
